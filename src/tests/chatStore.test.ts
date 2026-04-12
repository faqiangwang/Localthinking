import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '../store/chatStore';

function resetChatStore() {
  localStorage.clear();
  useChatStore.setState({
    sessions: [],
    activeSessionId: null,
    streaming: false,
    error: null,
    tokPerSec: 0,
    promptTokPerSec: 0,
    firstTokenLatencyMs: 0,
    promptTokenCount: 0,
    tokenCount: 0,
    activeRequestId: null,
    draftAssistantMessage: null,
    draftSessionId: null,
  });
}

describe('chatStore streaming requests', () => {
  beforeEach(() => {
    resetChatStore();
  });

  it('忽略旧请求的流式更新和完成事件', () => {
    const store = useChatStore.getState();

    const firstSessionId = store.createSession('system prompt');
    store.addMessage(firstSessionId, { role: 'user', content: 'first question' });
    store.startStreaming(firstSessionId, 'req-1');
    store.setStreamingContent('req-1', 'old draft');

    const secondSessionId = store.createSession('system prompt');
    store.addMessage(secondSessionId, { role: 'user', content: 'second question' });
    store.startStreaming(secondSessionId, 'req-2');

    useChatStore.getState().setStreamingContent('req-1', 'stale content');
    useChatStore.getState().finishStreaming('req-1');

    expect(useChatStore.getState().draftAssistantMessage).toBeNull();

    useChatStore.getState().setStreamingContent('req-2', 'fresh answer');
    expect(useChatStore.getState().draftAssistantMessage?.content).toBe('fresh answer');

    useChatStore.getState().finishStreaming('req-2');

    const state = useChatStore.getState();
    const firstSession = state.sessions.find(session => session.id === firstSessionId);
    const secondSession = state.sessions.find(session => session.id === secondSessionId);
    const secondSessionLastMessage =
      secondSession && secondSession.messages[secondSession.messages.length - 1];

    expect(firstSession?.messages.some(message => message.role === 'assistant')).toBe(false);
    expect(secondSessionLastMessage?.content).toBe('fresh answer');
  });

  it('切换会话后当前请求仍能写回原始会话', () => {
    const store = useChatStore.getState();

    const secondSessionId = store.createSession('system prompt');
    const firstSessionId = store.createSession('system prompt');

    useChatStore.getState().switchSession(firstSessionId);
    useChatStore.getState().addMessage(firstSessionId, { role: 'user', content: 'question' });
    useChatStore.getState().startStreaming(firstSessionId, 'req-1');
    useChatStore.getState().setStreamingContent('req-1', 'partial answer');

    useChatStore.getState().switchSession(secondSessionId);

    useChatStore.getState().finishStreaming('req-1');

    const state = useChatStore.getState();
    const firstSession = state.sessions.find(session => session.id === firstSessionId);
    const firstSessionLastMessage =
      firstSession && firstSession.messages[firstSession.messages.length - 1];

    expect(state.activeSessionId).toBe(secondSessionId);
    expect(firstSessionLastMessage?.content).toBe('partial answer');
    expect(state.streaming).toBe(false);
  });

  it('clearAllSessions 会清空会话和运行态', () => {
    const store = useChatStore.getState();

    const sessionId = store.createSession('system prompt');
    store.addMessage(sessionId, { role: 'user', content: 'question' });
    store.startStreaming(sessionId, 'req-1');
    store.setStreamingContent('req-1', 'draft answer');

    useChatStore.getState().clearAllSessions();

    const state = useChatStore.getState();
    expect(state.sessions).toEqual([]);
    expect(state.activeSessionId).toBeNull();
    expect(state.streaming).toBe(false);
    expect(state.activeRequestId).toBeNull();
    expect(state.draftAssistantMessage).toBeNull();
    expect(state.draftSessionId).toBeNull();
  });

  it('完成时会清空错误且忽略空 assistant 草稿', () => {
    const store = useChatStore.getState();
    const sessionId = store.createSession('system prompt');

    store.addMessage(sessionId, { role: 'user', content: 'question' });
    store.startStreaming(sessionId, 'req-1');
    store.setStreamingContent('req-1', '');
    useChatStore.setState({ error: 'old error' });

    useChatStore.getState().finishStreaming('req-1');

    const state = useChatStore.getState();
    const session = state.sessions.find(current => current.id === sessionId);

    expect(state.error).toBeNull();
    expect(session?.messages.some(message => message.role === 'assistant')).toBe(false);
  });

  it('失败时不会把瞬时失败占位写入会话', () => {
    const store = useChatStore.getState();
    const sessionId = store.createSession('system prompt');

    store.addMessage(sessionId, { role: 'user', content: 'question' });
    store.startStreaming(sessionId, 'req-1');
    store.setStreamingContent('req-1', '回复生成异常，请重试。');

    useChatStore.getState().failStreaming('req-1', 'backend error');

    const state = useChatStore.getState();
    const session = state.sessions.find(current => current.id === sessionId);

    expect(state.error).toBe('backend error');
    expect(session?.messages.some(message => message.role === 'assistant')).toBe(false);
  });
});
