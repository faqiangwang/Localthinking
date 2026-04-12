// src/store/chatStore.ts
// 聊天状态管理 - Zustand

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { type ChatSession, type Message, STORAGE_KEYS, isValidChatSession } from '../types';

const CHAT_STORE_VERSION = 1;
const MAX_SESSIONS = 50;

interface PersistedChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
}

interface ChatStore extends PersistedChatState {
  streaming: boolean;
  error: string | null;
  tokPerSec: number;
  tokenCount: number;
  activeRequestId: string | null;
  draftAssistantMessage: Message | null;
  draftSessionId: string | null;
  runtimeInitialized: boolean;

  ensureRuntimeInitialized: () => boolean;
  createSession: (systemPrompt: string) => string;
  ensureSession: (systemPrompt: string) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, name: string) => void;
  clearAllSessions: () => void;
  syncSystemPrompt: (systemPrompt: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  resetSession: (systemPrompt: string) => void;
  startStreaming: (sessionId: string, requestId: string) => void;
  setStreamingContent: (requestId: string, content: string) => void;
  finishStreaming: (requestId: string) => void;
  failStreaming: (requestId: string, error: string | null) => void;
  clearRuntimeState: () => void;
  setError: (error: string | null) => void;
  setTokPerSec: (speed: number) => void;
  setTokenCount: (count: number) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function generateTitle(messages: Message[]): string {
  const userMessages = messages.filter(message => message.role === 'user');

  if (userMessages.length === 0) {
    return '新对话';
  }

  const firstMessage = userMessages[0].content;
  const cleanedMessage = firstMessage.trim().replace(/\s+/g, ' ');

  if (cleanedMessage.length <= 30) {
    return cleanedMessage;
  }

  return `${cleanedMessage.substring(0, 30)}...`;
}

function normalizeSessions(value: unknown): ChatSession[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isValidChatSession).slice(-MAX_SESSIONS);
}

function resolveActiveSessionId(
  sessions: ChatSession[],
  activeSessionId: string | null
): string | null {
  if (!activeSessionId) {
    return sessions.length > 0 ? sessions[sessions.length - 1].id : null;
  }

  const exists = sessions.some(session => session.id === activeSessionId);
  return exists ? activeSessionId : sessions.length > 0 ? sessions[sessions.length - 1].id : null;
}

function withUpdatedSession(
  sessions: ChatSession[],
  sessionId: string,
  updater: (session: ChatSession) => ChatSession
): ChatSession[] {
  return sessions.map(session => (session.id === sessionId ? updater(session) : session));
}

const chatStorage: StateStorage = {
  getItem: name => {
    const current = localStorage.getItem(name);
    if (current) {
      return current;
    }

    const legacySessions = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    const legacyActiveSessionId = localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSION);

    if (!legacySessions && !legacyActiveSessionId) {
      return null;
    }

    let sessions: ChatSession[] = [];

    if (legacySessions) {
      try {
        sessions = normalizeSessions(JSON.parse(legacySessions));
      } catch {
        sessions = [];
      }
    }

    const migrated = JSON.stringify({
      state: {
        sessions,
        activeSessionId: resolveActiveSessionId(sessions, legacyActiveSessionId),
      },
      version: CHAT_STORE_VERSION,
    });

    localStorage.setItem(name, migrated);
    localStorage.removeItem(STORAGE_KEYS.SESSIONS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);

    return migrated;
  },
  setItem: (name, value) => {
    localStorage.setItem(name, value);
    localStorage.removeItem(STORAGE_KEYS.SESSIONS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
  },
  removeItem: name => {
    localStorage.removeItem(name);
    localStorage.removeItem(STORAGE_KEYS.SESSIONS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
  },
};

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      streaming: false,
      error: null,
      tokPerSec: 0,
      tokenCount: 0,
      activeRequestId: null,
      draftAssistantMessage: null,
      draftSessionId: null,
      runtimeInitialized: false,

      ensureRuntimeInitialized: () => {
        if (get().runtimeInitialized) {
          return false;
        }

        set({ runtimeInitialized: true });
        return true;
      },

      createSession: systemPrompt => {
        const newSession: ChatSession = {
          id: generateId(),
          name: '新对话',
          messages: [{ id: generateId(), role: 'system', content: systemPrompt }],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        set(state => ({
          sessions: [...state.sessions, newSession].slice(-MAX_SESSIONS),
          activeSessionId: newSession.id,
          error: null,
          draftAssistantMessage: null,
          draftSessionId: null,
          activeRequestId: null,
          streaming: false,
          tokPerSec: 0,
          tokenCount: 0,
        }));

        return newSession.id;
      },

      ensureSession: systemPrompt => {
        const state = get();
        const currentSession = state.sessions.find(session => session.id === state.activeSessionId);

        if (currentSession) {
          return currentSession.id;
        }

        return get().createSession(systemPrompt);
      },

      switchSession: sessionId =>
        set({
          activeSessionId: sessionId,
          streaming: false,
          error: null,
          tokPerSec: 0,
          tokenCount: 0,
        }),

      deleteSession: sessionId =>
        set(state => {
          const sessions = state.sessions.filter(session => session.id !== sessionId);
          const activeSessionId =
            sessionId === state.activeSessionId
              ? sessions.length > 0
                ? sessions[sessions.length - 1].id
                : null
              : state.activeSessionId;
          const deletingDraftSession = state.draftSessionId === sessionId;

          return {
            sessions,
            activeSessionId,
            streaming: deletingDraftSession ? false : state.streaming,
            draftAssistantMessage: deletingDraftSession ? null : state.draftAssistantMessage,
            draftSessionId: deletingDraftSession ? null : state.draftSessionId,
            activeRequestId: deletingDraftSession ? null : state.activeRequestId,
            tokPerSec: 0,
            tokenCount: 0,
            error: null,
          };
        }),

      renameSession: (sessionId, name) =>
        set(state => ({
          sessions: withUpdatedSession(state.sessions, sessionId, session => ({
            ...session,
            name,
            updatedAt: Date.now(),
          })),
        })),

      clearAllSessions: () =>
        set({
          sessions: [],
          activeSessionId: null,
          streaming: false,
          error: null,
          tokPerSec: 0,
          tokenCount: 0,
          activeRequestId: null,
          draftAssistantMessage: null,
          draftSessionId: null,
        }),

      syncSystemPrompt: systemPrompt =>
        set(state => {
          if (!state.activeSessionId) {
            return state;
          }

          const nextSessions = withUpdatedSession(
            state.sessions,
            state.activeSessionId,
            session => {
              const firstMessage = session.messages[0];

              if (!firstMessage) {
                return {
                  ...session,
                  messages: [{ id: generateId(), role: 'system', content: systemPrompt }],
                  updatedAt: Date.now(),
                };
              }

              if (firstMessage.role !== 'system' || firstMessage.content === systemPrompt) {
                return session;
              }

              return {
                ...session,
                messages: [
                  { ...firstMessage, content: systemPrompt },
                  ...session.messages.slice(1),
                ],
                updatedAt: Date.now(),
              };
            }
          );

          return { sessions: nextSessions };
        }),

      addMessage: (sessionId, message) =>
        set(state => ({
          sessions: withUpdatedSession(state.sessions, sessionId, session => {
            const nextMessages = [
              ...session.messages,
              { ...message, id: message.id || generateId() },
            ];
            const nextName =
              session.name === '新对话' && message.role === 'user'
                ? generateTitle(nextMessages)
                : session.name;

            return {
              ...session,
              messages: nextMessages,
              name: nextName,
              updatedAt: Date.now(),
            };
          }),
        })),

      resetSession: systemPrompt =>
        set(state => {
          if (!state.activeSessionId) {
            return state;
          }

          const systemMessage: Message = {
            id: generateId(),
            role: 'system',
            content: systemPrompt,
          };
          const clearingDraft = state.draftSessionId === state.activeSessionId;

          return {
            sessions: withUpdatedSession(state.sessions, state.activeSessionId, session => ({
              ...session,
              messages: [systemMessage],
              updatedAt: Date.now(),
            })),
            draftAssistantMessage: clearingDraft ? null : state.draftAssistantMessage,
            draftSessionId: clearingDraft ? null : state.draftSessionId,
            activeRequestId: clearingDraft ? null : state.activeRequestId,
            streaming: clearingDraft ? false : state.streaming,
            tokPerSec: 0,
            tokenCount: 0,
            error: null,
          };
        }),

      startStreaming: (sessionId, requestId) =>
        set({
          streaming: true,
          error: null,
          tokPerSec: 0,
          tokenCount: 0,
          activeRequestId: requestId,
          draftAssistantMessage: null,
          draftSessionId: sessionId,
        }),

      setStreamingContent: (requestId, content) =>
        set(state => {
          if (!state.draftSessionId || state.activeRequestId !== requestId) {
            return state;
          }

          return {
            draftAssistantMessage: {
              id: state.draftAssistantMessage?.id || generateId(),
              role: 'assistant',
              content,
            },
          };
        }),

      finishStreaming: requestId =>
        set(state => {
          if (state.activeRequestId !== requestId) {
            return state;
          }

          let sessions = state.sessions;

          if (state.draftSessionId && state.draftAssistantMessage) {
            sessions = withUpdatedSession(state.sessions, state.draftSessionId, session => ({
              ...session,
              messages: [...session.messages, state.draftAssistantMessage as Message],
              updatedAt: Date.now(),
            }));
          }

          return {
            sessions,
            streaming: false,
            activeRequestId: null,
            draftAssistantMessage: null,
            draftSessionId: null,
            tokPerSec: 0,
            tokenCount: 0,
          };
        }),

      failStreaming: (requestId, error) =>
        set(state => {
          if (state.activeRequestId !== requestId) {
            return state;
          }

          let sessions = state.sessions;

          if (state.draftSessionId && state.draftAssistantMessage) {
            sessions = withUpdatedSession(state.sessions, state.draftSessionId, session => ({
              ...session,
              messages: [...session.messages, state.draftAssistantMessage as Message],
              updatedAt: Date.now(),
            }));
          }

          return {
            sessions,
            streaming: false,
            error,
            activeRequestId: null,
            draftAssistantMessage: null,
            draftSessionId: null,
            tokPerSec: 0,
            tokenCount: 0,
          };
        }),

      clearRuntimeState: () =>
        set({
          streaming: false,
          error: null,
          tokPerSec: 0,
          tokenCount: 0,
          activeRequestId: null,
          draftAssistantMessage: null,
          draftSessionId: null,
        }),

      setError: error => set({ error }),
      setTokPerSec: tokPerSec => set({ tokPerSec }),
      setTokenCount: tokenCount => set({ tokenCount }),
    }),
    {
      name: STORAGE_KEYS.CHAT_STORE,
      version: CHAT_STORE_VERSION,
      storage: createJSONStorage(() => chatStorage),
      partialize: state => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
      migrate: persistedState => {
        const state = persistedState as Partial<PersistedChatState> | undefined;
        const sessions = normalizeSessions(state?.sessions);

        return {
          sessions,
          activeSessionId: resolveActiveSessionId(sessions, state?.activeSessionId ?? null),
        };
      },
    }
  )
);
