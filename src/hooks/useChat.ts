import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type ChatDoneEvent,
  type ChatErrorEvent,
  type ModelParams,
  type ChatTokenEvent,
  type Message,
  DEFAULT_MODEL_PARAMS,
  DEFAULT_APP_SETTINGS,
} from '../types';
import { useChatStore } from '../store';
import { generateId } from '../utils';

function processTokenContent(text: string): string {
  return text
    .replace(/<content>/g, '')
    .replace(/<\/content>/g, '')
    .replace(/<start_of_turn>/g, '')
    .replace(/<end_of_turn>/g, '')
    .replace(/<im_end>/g, '')
    .replace(/<\|im_end\|>/g, '');
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
    tokenCount,
    draftAssistantMessage,
    draftSessionId,
    ensureRuntimeInitialized,
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
      const content = requestBuffersRef.current.get(requestId);
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
    if (!ensureRuntimeInitialized()) {
      return;
    }

    const updateTimers = updateTimersRef.current;
    const requestBuffers = requestBuffersRef.current;
    const requestStartedAt = requestStartedAtRef.current;

    const unToken = listen<ChatTokenEvent>('chat://token', event => {
      const payload = event.payload;
      if (payload.request_id !== currentRequestIdRef.current) {
        return;
      }

      const text = processTokenContent(payload.content);
      const currentContent = requestBuffersRef.current.get(payload.request_id) || '';
      requestBuffersRef.current.set(payload.request_id, currentContent + text);
      setTokPerSec(payload.tok_per_sec || 0);
      setTokenCount(payload.n_tokens || 0);
      scheduleStreamingUpdate(payload.request_id);
    });

    const unDone = listen<ChatDoneEvent>('chat://done', event => {
      const payload = event.payload;
      if (payload.request_id !== currentRequestIdRef.current) {
        return;
      }

      flushRequestContent(payload.request_id);
      setTokPerSec(payload.tok_per_sec || 0);
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
      setTokenCount(payload.n_tokens || 0);
      failStreaming(payload.request_id, payload.error);
      clearRequestTracking(payload.request_id);
    });

    return () => {
      updateTimers.forEach(timer => clearTimeout(timer));
      updateTimers.clear();
      requestBuffers.clear();
      requestStartedAt.clear();
      currentRequestIdRef.current = null;

      unToken.then(unsubscribe => unsubscribe()).catch(() => {});
      unDone.then(unsubscribe => unsubscribe()).catch(() => {});
      unError.then(unsubscribe => unsubscribe()).catch(() => {});
    };
  }, [
    clearRequestTracking,
    ensureRuntimeInitialized,
    failStreaming,
    finishStreaming,
    flushRequestContent,
    scheduleStreamingUpdate,
    setTokPerSec,
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
