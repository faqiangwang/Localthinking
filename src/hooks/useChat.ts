// src/hooks/useChat.ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useEffect, useCallback, useRef } from "react";
import { Message, ChatSession, STORAGE_KEYS, isValidChatSession, DEFAULT_APP_SETTINGS } from "../types";
import { useDebounce } from "../utils/performance";

// 限制最大会话数
const MAX_SESSIONS = 50;

// 会话存储键（内部使用）
const SESSIONS_KEY = STORAGE_KEYS.SESSIONS;
const ACTIVE_SESSION_KEY = STORAGE_KEYS.ACTIVE_SESSION;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 生成对话标题
function generateTitle(messages: Message[]): string {
  // 过滤出用户消息
  const userMessages = messages.filter(m => m.role === 'user');

  if (userMessages.length === 0) {
    return '新对话';
  }

  // 使用第一条用户消息生成标题
  const firstMessage = userMessages[0].content;

  // 清理消息内容（移除多余的空白字符）
  const cleanedMessage = firstMessage.trim().replace(/\s+/g, ' ');

  // 如果消息很短，直接使用
  if (cleanedMessage.length <= 30) {
    return cleanedMessage;
  }

  // 截取前30个字符并添加省略号
  return cleanedMessage.substring(0, 30) + '...';
}

function loadSessions(): ChatSession[] {
  try {
    const saved = localStorage.getItem(SESSIONS_KEY);
    if (!saved) return [];

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const validSessions: ChatSession[] = [];
    for (const session of parsed) {
      if (isValidChatSession(session)) {
        validSessions.push(session);
      }
    }
    return validSessions;
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  // 限制会话数量，保留最新的 MAX_SESSIONS 个
  const limitedSessions = sessions.slice(-MAX_SESSIONS);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(limitedSessions));
}

export function useChat(systemPrompt: string = DEFAULT_APP_SETTINGS.system_prompt) {
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokPerSec, setTokPerSec] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const initializedRef = useRef(false);
  const createSessionRef = useRef<(() => string) | null>(null);
  const streamingContentRef = useRef(""); // 累积token内容
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 节流定时器

  // 使用 ref 保存防抖保存函数，避免依赖变化导致无限循环
  const debouncedSaveSessionsRef = useRef<(sessions: ChatSession[]) => void>(
    (sessions: ChatSession[]) => {
      saveSessions(sessions);
    }
  );

  // 更新防抖函数的引用
  const debouncedSaveFn = useDebounce((sessionsToSave: ChatSession[]) => {
    saveSessions(sessionsToSave);
  }, 1000);
  debouncedSaveSessionsRef.current = debouncedSaveFn;

  // 获取当前会话
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // 创建新会话的内部函数
  const createNewSession = useCallback(() => {
    const newSession: ChatSession = {
      id: generateId(),
      name: '新对话',
      messages: [{ id: generateId(), role: "system", content: systemPrompt }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions((prev) => {
      const updated = [...prev, newSession];
      saveSessions(updated);
      return updated;
    });
    setActiveSessionId(newSession.id);
    localStorage.setItem(ACTIVE_SESSION_KEY, newSession.id);
    setMessages(newSession.messages);
    return newSession.id;
  }, [systemPrompt]);

  // 保存 createSession 的引用供 useEffect 使用
  useEffect(() => {
    createSessionRef.current = createNewSession;
  }, [createNewSession]);

  // 初始化：加载当前会话的消息
  useEffect(() => {
    if (!initializedRef.current) {
      if (activeSessionId) {
        const session = sessions.find(s => s.id === activeSessionId);
        if (session) {
          // 更新系统提示词为最新值
          const messagesWithUpdatedPrompt = session.messages.map((msg, index) => {
            if (index === 0 && msg.role === "system") {
              return { ...msg, content: systemPrompt };
            }
            return msg;
          });
          setMessages(messagesWithUpdatedPrompt);

          // 同时更新会话存储
          setSessions((prev) => prev.map((s) => {
            if (s.id === activeSessionId) {
              return { ...s, messages: messagesWithUpdatedPrompt };
            }
            return s;
          }));
        }
      }
      initializedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在组件挂载时执行一次

  // 监听系统提示词变化，自动更新当前会话
  useEffect(() => {
    if (activeSessionId && messages.length > 0) {
      setMessages((prev) => {
        const messagesWithUpdatedPrompt = prev.map((msg, index) => {
          if (index === 0 && msg.role === "system") {
            return { ...msg, content: systemPrompt };
          }
          return msg;
        });

        // 只有当系统提示词真正改变时才更新
        if (prev[0]?.content !== systemPrompt && prev[0]?.role === "system") {
          // 更新会话存储
          setSessions((sessionsPrev) => {
            const updated = sessionsPrev.map((s) => {
              if (s.id === activeSessionId) {
                return { ...s, messages: messagesWithUpdatedPrompt };
              }
              return s;
            });
            saveSessions(updated);
            return updated;
          });
        }

        return messagesWithUpdatedPrompt;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemPrompt, activeSessionId]);

  // 监听 token 事件 - 简化版
  useEffect(() => {
    // 过滤token内容
    const processTokenContent = (text: string) => {
      return text
        .replace(/<content>/g, '')
        .replace(/<\/content>/g, '')
        .replace(/<start_of_turn>/g, '')
        .replace(/<end_of_turn>/g, '')
        .replace(/<im_end>/g, '')
        .replace(/<\|im_end\|>/g, '');
    };

    // 更新UI
    const updateUI = () => {
      const content = streamingContentRef.current;
      if (!content) return;

      setMessages(prev => {
        const last = prev[prev.length - 1];

        // 如果最后一条是assistant消息，更新它
        if (last?.role === "assistant") {
          return [...prev.slice(0, -1), { ...last, content }];
        }

        // 否则创建新的assistant消息
        return [...prev, { id: generateId(), role: "assistant", content }];
      });
    };

    // Token事件
    const unToken = listen<string>("chat://token", (e) => {
      try {
        const payload = JSON.parse(e.payload);
        setTokPerSec(payload.tok_per_sec || 0);
        setTokenCount(payload.n_tokens || 0);

        let text = payload.text || payload.content || "";
        text = processTokenContent(text);

        streamingContentRef.current += text;

        // 节流更新
        if (updateTimerRef.current) {
          clearTimeout(updateTimerRef.current);
        }
        updateTimerRef.current = setTimeout(updateUI, 50);

      } catch {
        const text = processTokenContent(e.payload);
        streamingContentRef.current += text;

        if (updateTimerRef.current) {
          clearTimeout(updateTimerRef.current);
        }
        updateTimerRef.current = setTimeout(updateUI, 50);
      }
    });

    // Done事件
    const unDone = listen("chat://done", () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }

      // 最终更新
      if (streamingContentRef.current) {
        updateUI();
      }

      streamingContentRef.current = "";
      setStreaming(false);
      setTokPerSec(0);
      setTokenCount(0);
    });

    // Error事件
    const unError = listen<string>("chat://error", (e) => {
      setError(e.payload);
      setStreaming(false);
      setTokPerSec(0);

      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
      streamingContentRef.current = "";
    });

    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
      unToken.then(f => f()).catch(() => {});
      unDone.then(f => f()).catch(() => {});
      unError.then(f => f()).catch(() => {});
    };
  }, []);

  // 更新当前会话的消息（防抖保存到localStorage）
  useEffect(() => {
    if (activeSessionId && initializedRef.current && !streaming) {
      // 只在非流式状态下保存到localStorage，避免频繁写入
      setSessions((prev) => {
        // 检查当前会话是否存在，避免删除会话时的错误更新
        const currentSession = prev.find(s => s.id === activeSessionId);
        if (!currentSession) {
          return prev; // 如果当前会话不存在（正在删除），跳过更新
        }

        // 检查消息内容是否真正改变了（避免在切换会话时更新 updatedAt）
        const messagesChanged = JSON.stringify(currentSession.messages) !== JSON.stringify(messages);
        const needsTitleUpdate = currentSession.name === '新对话';

        // 只有在消息改变或需要更新标题时才更新
        if (!messagesChanged && !needsTitleUpdate) {
          return prev;
        }

        const updated = prev.map((s) => {
          if (s.id === activeSessionId) {
            // 生成或更新标题
            const title = s.name === '新对话' ? generateTitle(messages) : s.name;

            return {
              ...s,
              messages,
              name: title,
              // 只有在消息真正改变时才更新时间
              ...(messagesChanged ? { updatedAt: Date.now() } : {})
            };
          }
          return s;
        });
        // 使用防抖保存，减少写入频率
        debouncedSaveSessionsRef.current?.(updated);
        return updated;
      });
    }
  }, [messages, activeSessionId, streaming]);

  // 清理函数：组件卸载时执行所有待处理的防抖保存
  useEffect(() => {
    return () => {
      // 组件卸载时立即保存所有待处理的会话数据
      saveSessions(sessions);
    };
  }, [sessions]);

  // 创建新会话
  const createSession = useCallback(() => {
    return createNewSession();
  }, [createNewSession]);

  // 切换会话
  const switchSession = useCallback(async (sessionId: string) => {
    // 如果正在流式输出，先停止
    if (streaming) {
      await invoke("stop_generation").catch(() => {});
      setStreaming(false);
      setTokPerSec(0);
      setTokenCount(0);
    }

    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      setActiveSessionId(sessionId);
      localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
      setMessages(session.messages);
    }
  }, [sessions, streaming]);

  // 删除会话
  const deleteSession = useCallback(async (sessionId: string) => {
    // 如果正在流式输出，先停止
    if (streaming) {
      await invoke("stop_generation").catch(() => {});
      setStreaming(false);
      setTokPerSec(0);
      setTokenCount(0);
    }

    setSessions((prev) => {
      const updated = prev.filter((s) => s.id !== sessionId);
      saveSessions(updated);

      // 如果删除的是当前会话，需要切换到其他会话或清空
      if (sessionId === activeSessionId) {
        if (updated.length > 0) {
          const lastSession = updated[updated.length - 1];
          setMessages([]);
          setTimeout(() => {
            setActiveSessionId(lastSession.id);
            localStorage.setItem(ACTIVE_SESSION_KEY, lastSession.id);
            setMessages(lastSession.messages);
          }, 0);
        } else {
          setActiveSessionId(null);
          localStorage.removeItem(ACTIVE_SESSION_KEY);
          setMessages([]);
        }
      }

      return updated;
    });
  }, [activeSessionId, streaming]);

  // 重命名会话
  const renameSession = useCallback((sessionId: string, name: string) => {
    setSessions((prev) => {
      const updated = prev.map((s) =>
        s.id === sessionId ? { ...s, name } : s
      );
      saveSessions(updated);
      return updated;
    });
  }, []);

  // 发送消息
  const send = useCallback(
    async (content: string) => {
      // 如果没有会话，先创建一个
      if (!activeSessionId) {
        createNewSession();
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // 清理状态
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }
      streamingContentRef.current = "";

      const userMsg: Message = { id: generateId(), role: "user", content };

      // 添加用户消息
      setMessages((prev) => {
        const newMessages = [...prev, userMsg];

        if (activeSessionId) {
          setSessions((sessionsPrev) => {
            const updated = sessionsPrev.map((s) => {
              if (s.id === activeSessionId) {
                // 生成或更新标题
                const title = s.name === '新对话' ? generateTitle(newMessages) : s.name;

                return {
                  ...s,
                  messages: newMessages,
                  name: title,
                  updatedAt: Date.now()
                };
              }
              return s;
            });
            saveSessions(updated);
            return updated;
          });
        }
        return newMessages;
      });

      setStreaming(true);
      setError(null);
      setTokPerSec(0);
      setTokenCount(0);

      await new Promise(resolve => setTimeout(resolve, 0));

      // 调用后端 - 确保使用最新的系统提示词
      setMessages((prev) => {
        // 更新系统提示词为最新值
        const messagesWithUpdatedPrompt = prev.map((msg, index) => {
          if (index === 0 && msg.role === "system") {
            return { ...msg, content: systemPrompt };
          }
          return msg;
        });

        invoke("chat_stream", { messages: messagesWithUpdatedPrompt }).catch((e) => {
          setError(String(e));
          setStreaming(false);
          setTokPerSec(0);
        });
        return messagesWithUpdatedPrompt;
      });
    },
    [activeSessionId, createNewSession, systemPrompt]
  );

  // 清空当前会话消息（保留系统提示词）
  const reset = useCallback(() => {
    const systemMsg: Message = { id: generateId(), role: "system", content: systemPrompt };
    setMessages([systemMsg]);
    if (activeSessionId) {
      setSessions((prev) => {
        const updated = prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: [systemMsg], updatedAt: Date.now() }
            : s
        );
        saveSessions(updated);
        return updated;
      });
    }
  }, [activeSessionId, systemPrompt]);

  // 停止生成
  const stop = useCallback(() => {
    invoke("stop_generation").catch(() => {});
  }, []);

  return {
    messages,
    sessions,
    activeSession,
    streaming,
    error,
    tokPerSec,
    tokenCount,
    send,
    stop,
    reset,
    createSession,
    switchSession,
    deleteSession,
    renameSession,
  };
}
