import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type ChatDoneEvent,
  type ChatErrorEvent,
  type ChatStartEvent,
  type ModelParams,
  type ChatTokenEvent,
  type Message,
  DEFAULT_MODEL_PARAMS,
  DEFAULT_APP_SETTINGS,
} from '../types';
import { useChatStore } from '../store';
import { generateId } from '../utils';

const RAW_REASONING_USER_CUES = [
  '用户',
  '请求',
  '需求',
  '输入',
  '问题',
  '对话历史',
  '回应',
  '回答',
  '具体服务',
  '能力',
  '服务',
];

const RAW_REASONING_PLANNING_CUES = [
  '我需要',
  '我应该',
  '我要',
  '我会',
  '我要分析',
  '我要考虑',
  '我要处理',
  '需要理解',
  '需要考虑',
  '引导用户',
  '测试我的反应',
  '使用场景',
  '身份',
  '打字错误',
  '看起来',
  '意味着',
  '确保回应',
  '保持友好',
  '开放的态度',
  '回顾之前的对话历史',
  '进一步了解',
];

const RAW_REASONING_OPENING = /^(好|嗯|好的|首先|另外|看起来|让我|基于|根据|接下来|现在|然后)[，,。]?\s*/;

function processTokenContent(text: string): string {
  return text
    .replace(/<content>/g, '')
    .replace(/<\/content>/g, '')
    .replace(/<start_of_turn>/g, '')
    .replace(/<end_of_turn>/g, '')
    .replace(/<im_end>/g, '')
    .replace(/<\|im_end\|>/g, '');
}

function trimOrEmpty(value: string | null | undefined) {
  return value?.trim() ?? '';
}

function isLikelyRawReasoningLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (
    RAW_REASONING_OPENING.test(trimmed) &&
    (RAW_REASONING_USER_CUES.some(cue => trimmed.includes(cue)) ||
      RAW_REASONING_PLANNING_CUES.some(cue => trimmed.includes(cue)))
  ) {
    return true;
  }

  const userCueCount = RAW_REASONING_USER_CUES.filter(cue => trimmed.includes(cue)).length;
  const planningCueCount = RAW_REASONING_PLANNING_CUES.filter(cue => trimmed.includes(cue)).length;

  return (
    (trimmed.includes('用户') && planningCueCount > 0) ||
    userCueCount + planningCueCount >= 2
  );
}

function isLikelyRawReasoningMessage(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  const openingMatched = RAW_REASONING_OPENING.test(trimmed);
  const userCueCount = RAW_REASONING_USER_CUES.filter(cue => trimmed.includes(cue)).length;
  const planningCueCount = RAW_REASONING_PLANNING_CUES.filter(cue => trimmed.includes(cue)).length;

  if (openingMatched && userCueCount >= 1 && planningCueCount >= 1) {
    return true;
  }

  const sentenceLikeParts = trimmed
    .split(/[。！？!?\n]/)
    .map(part => part.trim())
    .filter(Boolean);
  const reasoningParts = sentenceLikeParts.filter(isLikelyRawReasoningLine);

  return reasoningParts.length >= 2 && reasoningParts.length >= Math.ceil(sentenceLikeParts.length / 2);
}

function extractVisibleAssistantContent(content: string, streaming: boolean): string {
  const normalized = content.replace(/\r/g, '').trim();
  if (!normalized) {
    return '';
  }

  const thinkAnswerMatch = normalized.match(/<\/think>\s*([\s\S]*)/i);
  if (thinkAnswerMatch) {
    return trimOrEmpty(thinkAnswerMatch[1]);
  }

  const explicitAnswerMatch =
    normalized.match(/<回答>([\s\S]*)/i) ||
    normalized.match(/回答[：:]\s*([\s\S]*)$/);
  if (explicitAnswerMatch) {
    return trimOrEmpty(explicitAnswerMatch[1]);
  }

  if (
    normalized.includes('<think>') ||
    normalized.includes('<思考>') ||
    normalized.startsWith('思考：') ||
    normalized.startsWith('思考:')
  ) {
    return trimOrEmpty(
      normalized
        .replace(/<think>/gi, '')
        .replace(/<\/think>/gi, '')
        .replace(/<思考>/g, '')
        .replace(/<\/思考>/g, '')
        .replace(/<回答>/g, '')
        .replace(/<\/回答>/g, '')
        .replace(/^思考[：:]\s*/g, '')
        .replace(/\n?回答[：:]\s*/g, '\n')
    );
  }

  if (isLikelyRawReasoningMessage(normalized)) {
    return streaming ? '' : '回复生成异常，请重试。';
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  const visibleParagraphs = paragraphs.filter(paragraph => !isLikelyRawReasoningMessage(paragraph));

  if (visibleParagraphs.length > 0 && visibleParagraphs.length < paragraphs.length) {
    return visibleParagraphs.join('\n\n');
  }

  return normalized;
}

function calculateRateFallback(nTokens: number, startedAt: number): number {
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  return elapsedSeconds > 0 ? nTokens / elapsedSeconds : 0;
}

export function useChat(
  systemPrompt: string = DEFAULT_APP_SETTINGS.system_prompt,
  modelParams: ModelParams = DEFAULT_MODEL_PARAMS
) {
  const {
    sessions,
    activeSessionId,
    streaming,
    error,
    tokPerSec,
    promptTokPerSec,
    firstTokenLatencyMs,
    promptTokenCount,
    tokenCount,
    draftAssistantMessage,
    draftSessionId,
    createSession: createStoreSession,
    ensureSession,
    switchSession,
    deleteSession,
    renameSession,
    clearAllSessions,
    syncSystemPrompt,
    addMessage,
    resetSession,
    startStreaming,
    setStreamingContent,
    finishStreaming,
    failStreaming,
    setTokPerSec,
    setPromptTokPerSec,
    setFirstTokenLatencyMs,
    setPromptTokenCount,
    setTokenCount,
  } = useChatStore();

  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const messages = useMemo(() => {
    const baseMessages = activeSession?.messages || [];

    if (draftAssistantMessage && draftSessionId && draftSessionId === activeSessionId) {
      return [...baseMessages, draftAssistantMessage];
    }

    return baseMessages;
  }, [activeSession, activeSessionId, draftAssistantMessage, draftSessionId]);

  const currentRequestIdRef = useRef<string | null>(null);
  const requestRawBuffersRef = useRef(new Map<string, string>());
  const requestBuffersRef = useRef(new Map<string, string>());
  const requestStartedAtRef = useRef(new Map<string, number>());
  const updateTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearScheduledUpdate = useCallback((requestId: string) => {
    const timer = updateTimersRef.current.get(requestId);
    if (timer) {
      clearTimeout(timer);
      updateTimersRef.current.delete(requestId);
    }
  }, []);

  const clearRequestTracking = useCallback(
    (requestId: string) => {
      clearScheduledUpdate(requestId);
      requestRawBuffersRef.current.delete(requestId);
      requestBuffersRef.current.delete(requestId);
      requestStartedAtRef.current.delete(requestId);

      if (currentRequestIdRef.current === requestId) {
        currentRequestIdRef.current = null;
      }
    },
    [clearScheduledUpdate]
  );

  const flushRequestContent = useCallback(
    (requestId: string) => {
      clearScheduledUpdate(requestId);
      const rawContent = requestRawBuffersRef.current.get(requestId) ?? '';
      const content =
        rawContent.length > 0
          ? extractVisibleAssistantContent(rawContent, false)
          : requestBuffersRef.current.get(requestId);
      if (content !== undefined) {
        setStreamingContent(requestId, content);
      }
    },
    [clearScheduledUpdate, setStreamingContent]
  );

  const scheduleStreamingUpdate = useCallback(
    (requestId: string) => {
      clearScheduledUpdate(requestId);

      const timer = setTimeout(() => {
        updateTimersRef.current.delete(requestId);
        const content = requestBuffersRef.current.get(requestId);
        if (content !== undefined) {
          setStreamingContent(requestId, content);
        }
      }, 50);

      updateTimersRef.current.set(requestId, timer);
    },
    [clearScheduledUpdate, setStreamingContent]
  );

  useEffect(() => {
    syncSystemPrompt(systemPrompt);
  }, [syncSystemPrompt, systemPrompt, activeSessionId]);

  useEffect(() => {
    const updateTimers = updateTimersRef.current;
    const requestRawBuffers = requestRawBuffersRef.current;
    const requestBuffers = requestBuffersRef.current;
    const requestStartedAt = requestStartedAtRef.current;

    const unToken = listen<ChatTokenEvent>('chat://token', event => {
      const payload = event.payload;
      if (payload.request_id !== currentRequestIdRef.current) {
        return;
      }

      const text = processTokenContent(payload.content);
      const currentRawContent = requestRawBuffersRef.current.get(payload.request_id) || '';
      const nextRawContent = currentRawContent + text;
      requestRawBuffersRef.current.set(payload.request_id, nextRawContent);
      requestBuffersRef.current.set(
        payload.request_id,
        extractVisibleAssistantContent(nextRawContent, true)
      );
      setTokPerSec(payload.tok_per_sec || 0);
      setPromptTokPerSec(payload.prompt_tok_per_sec || 0);
      setFirstTokenLatencyMs(payload.first_token_latency_ms || 0);
      setPromptTokenCount(payload.prompt_tokens || 0);
      setTokenCount(payload.n_tokens || 0);
      scheduleStreamingUpdate(payload.request_id);
    });

    const unStart = listen<ChatStartEvent>('chat://start', event => {
      const payload = event.payload;
      if (payload.request_id !== currentRequestIdRef.current) {
        return;
      }

      setPromptTokenCount(payload.prompt_tokens || 0);
      setTokPerSec(0);
      setPromptTokPerSec(0);
      setFirstTokenLatencyMs(0);
    });

    const unDone = listen<ChatDoneEvent>('chat://done', event => {
      const payload = event.payload;
      if (payload.request_id !== currentRequestIdRef.current) {
        return;
      }

      flushRequestContent(payload.request_id);
      setTokPerSec(payload.tok_per_sec || 0);
      setPromptTokPerSec(payload.prompt_tok_per_sec || 0);
      setFirstTokenLatencyMs(payload.first_token_latency_ms || 0);
      setPromptTokenCount(payload.prompt_tokens || 0);
      setTokenCount(payload.n_tokens || 0);
      finishStreaming(payload.request_id);
      clearRequestTracking(payload.request_id);
    });

    const unError = listen<ChatErrorEvent>('chat://error', event => {
      const payload = event.payload;
      if (payload.request_id !== currentRequestIdRef.current) {
        return;
      }

      flushRequestContent(payload.request_id);
      setTokPerSec(payload.tok_per_sec || 0);
      setPromptTokPerSec(payload.prompt_tok_per_sec || 0);
      setFirstTokenLatencyMs(payload.first_token_latency_ms || 0);
      setPromptTokenCount(payload.prompt_tokens || 0);
      setTokenCount(payload.n_tokens || 0);
      failStreaming(payload.request_id, payload.error);
      clearRequestTracking(payload.request_id);
    });

    return () => {
      updateTimers.forEach(timer => clearTimeout(timer));
      updateTimers.clear();
      requestRawBuffers.clear();
      requestBuffers.clear();
      requestStartedAt.clear();
      currentRequestIdRef.current = null;

      unToken.then(unsubscribe => unsubscribe()).catch(() => {});
      unStart.then(unsubscribe => unsubscribe()).catch(() => {});
      unDone.then(unsubscribe => unsubscribe()).catch(() => {});
      unError.then(unsubscribe => unsubscribe()).catch(() => {});
    };
  }, [
    clearRequestTracking,
    failStreaming,
    finishStreaming,
    flushRequestContent,
    scheduleStreamingUpdate,
    setTokPerSec,
    setPromptTokPerSec,
    setFirstTokenLatencyMs,
    setPromptTokenCount,
    setTokenCount,
  ]);

  const createSession = useCallback(() => {
    return createStoreSession(systemPrompt);
  }, [createStoreSession, systemPrompt]);

  const send = useCallback(
    async (content: string) => {
      const sessionId = ensureSession(systemPrompt);
      const requestId = generateId();
      const previousRequestId = currentRequestIdRef.current;

      if (previousRequestId && previousRequestId !== requestId) {
        clearRequestTracking(previousRequestId);
      }

      syncSystemPrompt(systemPrompt);

      currentRequestIdRef.current = requestId;
      requestRawBuffersRef.current.set(requestId, '');
      requestBuffersRef.current.set(requestId, '');
      requestStartedAtRef.current.set(requestId, Date.now());

      const userMessage: Message = {
        role: 'user',
        content,
      };

      addMessage(sessionId, userMessage);
      startStreaming(sessionId, requestId);

      const currentSession = useChatStore
        .getState()
        .sessions.find(session => session.id === sessionId);
      const currentMessages = currentSession?.messages ?? [];

      try {
        await invoke('chat_stream', {
          messages: currentMessages,
          requestId,
          params: {
            temperature: modelParams.temperature,
            top_p: modelParams.top_p,
            max_tokens: modelParams.max_tokens,
            ctx_size: modelParams.ctx_size,
            repeat_penalty: modelParams.repeat_penalty,
          },
        });
      } catch (e) {
        if (currentRequestIdRef.current !== requestId) {
          return;
        }

        const nTokens = useChatStore.getState().tokenCount;
        const startedAt = requestStartedAtRef.current.get(requestId) ?? Date.now();
        setTokPerSec(calculateRateFallback(nTokens, startedAt));
        failStreaming(requestId, String(e));
        clearRequestTracking(requestId);
      }
    },
    [
      addMessage,
      clearRequestTracking,
      ensureSession,
      failStreaming,
      setTokPerSec,
      startStreaming,
      syncSystemPrompt,
      modelParams,
      systemPrompt,
    ]
  );

  const reset = useCallback(() => {
    resetSession(systemPrompt);
  }, [resetSession, systemPrompt]);

  const stop = useCallback(() => {
    return invoke('stop_generation')
      .then(() => undefined)
      .catch(() => undefined);
  }, []);

  return {
    sessions,
    activeSession,
    messages,
    streaming,
    error,
    tokPerSec,
    promptTokPerSec,
    firstTokenLatencyMs,
    promptTokenCount,
    tokenCount,
    send,
    stop,
    reset,
    createSession,
    switchSession,
    deleteSession,
    renameSession,
    clearAllSessions,
  };
}
