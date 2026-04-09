// src/store/chatStore.ts
// 聊天状态管理 - Zustand

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Message, ChatSession, isValidChatSession } from '../types';

// 限制最大会话数
const MAX_SESSIONS = 50;

function generateId(): string {
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

interface ChatStore {
  // 状态
  sessions: ChatSession[];
  activeSessionId: string | null;
  streaming: boolean;
  error: string | null;
  tokPerSec: number;
  tokenCount: number;

  // Computed
  activeSession: ChatSession | null;
  messages: Message[];

  // Actions
  createSession: () => void;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;
  addMessage: (message: Message) => void;
  updateLastMessage: (content: string) => void;
  clearMessages: () => void;
  setStreaming: (streaming: boolean) => void;
  setError: (error: string | null) => void;
  setTokPerSec: (speed: number) => void;
  setTokenCount: (count: number) => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      // 初始状态
      sessions: [],
      activeSessionId: null,
      streaming: false,
      error: null,
      tokPerSec: 0,
      tokenCount: 0,

      // 计算属性
      get activeSession() {
        const { sessions, activeSessionId } = get();
        return sessions.find((s) => s.id === activeSessionId) || null;
      },

      get messages() {
        return get().activeSession?.messages || [];
      },

      // 创建新会话
      createSession: () =>
        set((state) => {
          const newSession: ChatSession = {
            id: generateId(),
            name: '新对话',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          const updatedSessions = [...state.sessions, newSession];

          // 限制会话数量
          const limitedSessions = updatedSessions.slice(-MAX_SESSIONS);

          return {
            sessions: limitedSessions,
            activeSessionId: newSession.id,
          };
        }),

      // 切换会话
      switchSession: (sessionId) =>
        set({
          activeSessionId: sessionId,
          streaming: false,
          error: null,
        }),

      // 删除会话
      deleteSession: (sessionId) =>
        set((state) => {
          const updatedSessions = state.sessions.filter((s) => s.id !== sessionId);

          // 如果删除的是当前会话，需要切换到其他会话
          let newActiveSessionId = state.activeSessionId;
          if (sessionId === state.activeSessionId) {
            if (updatedSessions.length > 0) {
              newActiveSessionId = updatedSessions[updatedSessions.length - 1].id;
            } else {
              newActiveSessionId = null;
            }
          }

          return {
            sessions: updatedSessions,
            activeSessionId: newActiveSessionId,
          };
        }),

      // 重命名会话
      renameSession: (sessionId, name) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, name, updatedAt: Date.now() } : s
          ),
        })),

      // 添加消息
      addMessage: (message) =>
        set((state) => {
          if (!state.activeSessionId) return state;

          return {
            sessions: state.sessions.map((s) => {
              if (s.id === state.activeSessionId) {
                const newMessages = [...s.messages, { ...message, id: message.id || generateId() }];

                // 如果当前标题是"新对话"且添加的是用户消息，生成新标题
                const newTitle = s.name === '新对话' && message.role === 'user'
                  ? generateTitle(newMessages)
                  : s.name;

                return {
                  ...s,
                  messages: newMessages,
                  name: newTitle,
                  updatedAt: Date.now(),
                };
              }
              return s;
            }),
          };
        }),

      // 更新最后一条消息（用于流式输出）
      updateLastMessage: (content) =>
        set((state) => {
          if (!state.activeSessionId) return state;

          return {
            sessions: state.sessions.map((s) => {
              if (s.id === state.activeSessionId && s.messages.length > 0) {
                const lastMessage = s.messages[s.messages.length - 1];
                return {
                  ...s,
                  messages: [
                    ...s.messages.slice(0, -1),
                    { ...lastMessage, content },
                  ],
                  updatedAt: Date.now(),
                };
              }
              return s;
            }),
          };
        }),

      // 清空当前会话消息
      clearMessages: () =>
        set((state) => {
          if (!state.activeSessionId) return state;

          return {
            sessions: state.sessions.map((s) =>
              s.id === state.activeSessionId
                ? { ...s, messages: [], updatedAt: Date.now() }
                : s
            ),
          };
        }),

      // 设置流式状态
      setStreaming: (streaming) => set({ streaming }),

      // 设置错误
      setError: (error) => set({ error }),

      // 设置速度
      setTokPerSec: (tokPerSec) => set({ tokPerSec }),

      // 设置 token 数量
      setTokenCount: (tokenCount) => set({ tokenCount }),
    }),
    {
      name: 'localmind-chat',
      storage: createJSONStorage(() => localStorage),
      // 只持久化必要的状态
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    }
  )
);

// 重写 persist 以支持数据验证
const useChatStoreWithValidation = create<ChatStore>()(
  persist(
    (set, get) => ({
      // ... 与上面相同的实现 ...
      sessions: [],
      activeSessionId: null,
      streaming: false,
      error: null,
      tokPerSec: 0,
      tokenCount: 0,

      get activeSession() {
        const { sessions, activeSessionId } = get();
        return sessions.find((s) => s.id === activeSessionId) || null;
      },

      get messages() {
        return get().activeSession?.messages || [];
      },

      createSession: () =>
        set((state) => {
          const newSession: ChatSession = {
            id: generateId(),
            name: '新对话',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          const updatedSessions = [...state.sessions, newSession];
          const limitedSessions = updatedSessions.slice(-MAX_SESSIONS);

          return {
            sessions: limitedSessions,
            activeSessionId: newSession.id,
          };
        }),

      switchSession: (sessionId) =>
        set({
          activeSessionId: sessionId,
          streaming: false,
          error: null,
        }),

      deleteSession: (sessionId) =>
        set((state) => {
          const updatedSessions = state.sessions.filter((s) => s.id !== sessionId);

          let newActiveSessionId = state.activeSessionId;
          if (sessionId === state.activeSessionId) {
            if (updatedSessions.length > 0) {
              newActiveSessionId = updatedSessions[updatedSessions.length - 1].id;
            } else {
              newActiveSessionId = null;
            }
          }

          return {
            sessions: updatedSessions,
            activeSessionId: newActiveSessionId,
          };
        }),

      renameSession: (sessionId, name) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, name, updatedAt: Date.now() } : s
          ),
        })),

      addMessage: (message) =>
        set((state) => {
          if (!state.activeSessionId) return state;

          return {
            sessions: state.sessions.map((s) => {
              if (s.id === state.activeSessionId) {
                const newMessages = [...s.messages, { ...message, id: message.id || generateId() }];

                // 如果当前标题是"新对话"且添加的是用户消息，生成新标题
                const newTitle = s.name === '新对话' && message.role === 'user'
                  ? generateTitle(newMessages)
                  : s.name;

                return {
                  ...s,
                  messages: newMessages,
                  name: newTitle,
                  updatedAt: Date.now(),
                };
              }
              return s;
            }),
          };
        }),

      updateLastMessage: (content) =>
        set((state) => {
          if (!state.activeSessionId) return state;

          return {
            sessions: state.sessions.map((s) => {
              if (s.id === state.activeSessionId && s.messages.length > 0) {
                const lastMessage = s.messages[s.messages.length - 1];
                return {
                  ...s,
                  messages: [
                    ...s.messages.slice(0, -1),
                    { ...lastMessage, content },
                  ],
                  updatedAt: Date.now(),
                };
              }
              return s;
            }),
          };
        }),

      clearMessages: () =>
        set((state) => {
          if (!state.activeSessionId) return state;

          return {
            sessions: state.sessions.map((s) =>
              s.id === state.activeSessionId
                ? { ...s, messages: [], updatedAt: Date.now() }
                : s
            ),
          };
        }),

      setStreaming: (streaming) => set({ streaming }),
      setError: (error) => set({ error }),
      setTokPerSec: (tokPerSec) => set({ tokPerSec }),
      setTokenCount: (tokenCount) => set({ tokenCount }),
    }),
    {
      name: 'localmind-chat',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
      // 数据验证和清理
      onRehydrateStorage: () => (state) => {
        if (state) {
          // 验证和清理会话数据
          const validSessions = state.sessions.filter((s) => isValidChatSession(s));
          state.sessions = validSessions;

          // 确保 activeSessionId 指向的会话存在
          if (state.activeSessionId) {
            const exists = validSessions.some((s) => s.id === state.activeSessionId);
            if (!exists) {
              state.activeSessionId = validSessions.length > 0 ? validSessions[0].id : null;
            }
          }
        }
      },
    }
  )
);

// Export the validated store
export { useChatStoreWithValidation };
