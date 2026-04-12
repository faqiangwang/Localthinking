import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChat } from '../hooks/useChat';
import { useChatStore } from '../store/chatStore';
import { DEFAULT_MODEL_PARAMS, type ChatTokenEvent, type ChatStartEvent } from '../types';

type EventPayload = ChatStartEvent | ChatTokenEvent;
type EventHandler = (event: { payload: EventPayload }) => void;

const { eventHandlers, invokeMock } = vi.hoisted(() => ({
  eventHandlers: new Map<string, EventHandler[]>(),
  invokeMock: vi.fn(async (command: string) => {
    if (command === 'chat_stream') {
      return;
    }

    throw new Error(`Unexpected invoke command: ${command}`);
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, handler: EventHandler) => {
    const handlers = eventHandlers.get(eventName) ?? [];
    handlers.push(handler);
    eventHandlers.set(eventName, handlers);

    return () => {
      const current = eventHandlers.get(eventName) ?? [];
      eventHandlers.set(
        eventName,
        current.filter(candidate => candidate !== handler)
      );
    };
  }),
}));

function emit(eventName: string, payload: EventPayload) {
  for (const handler of eventHandlers.get(eventName) ?? []) {
    handler({ payload });
  }
}

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

function Harness() {
  const { messages, send } = useChat('system prompt', DEFAULT_MODEL_PARAMS);

  return (
    <div>
      <button onClick={() => void send('hello')}>send</button>
      <div data-testid="messages">
        {messages.map(message => `${message.role}:${message.content}`).join('|')}
      </div>
    </div>
  );
}

describe('useChat lifecycle', () => {
  beforeEach(() => {
    eventHandlers.clear();
    invokeMock.mockClear();
    resetChatStore();
  });

  it('重新挂载后仍会重新订阅流式事件', async () => {
    const firstRender = render(<Harness />);

    fireEvent.click(screen.getByText('send'));
    await waitFor(() => {
      expect(useChatStore.getState().activeRequestId).toBeTruthy();
    });

    firstRender.unmount();

    render(<Harness />);

    fireEvent.click(screen.getByText('send'));

    let requestId = '';
    await waitFor(() => {
      requestId = useChatStore.getState().activeRequestId ?? '';
      expect(requestId).not.toBe('');
    });

    await act(async () => {
      emit('chat://start', {
        request_id: requestId,
        prompt_tokens: 3,
      });
      emit('chat://token', {
        request_id: requestId,
        content: 'world',
        n_tokens: 1,
        tok_per_sec: 12,
        prompt_tokens: 3,
        prompt_tok_per_sec: 48,
        first_token_latency_ms: 25,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('messages')).toHaveTextContent('assistant:world');
    });
  });

  it('流式阶段不会把内部独白直接显示到消息列表', async () => {
    render(<Harness />);

    fireEvent.click(screen.getByText('send'));

    let requestId = '';
    await waitFor(() => {
      requestId = useChatStore.getState().activeRequestId ?? '';
      expect(requestId).not.toBe('');
    });

    await act(async () => {
      emit('chat://token', {
        request_id: requestId,
        content:
          '好的，现在我要处理用户的请求：“给我使用c语言写一个冒泡排序”。首先，我需要分析用户的需求。',
        n_tokens: 1,
        tok_per_sec: 8,
        prompt_tokens: 5,
        prompt_tok_per_sec: 40,
        first_token_latency_ms: 30,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('messages')).not.toHaveTextContent('现在我要处理用户的请求');
      expect(screen.getByTestId('messages')).not.toHaveTextContent('我需要分析用户的需求');
    });
  });

  it('发送请求前会清理历史中的内部独白 assistant 消息', async () => {
    useChatStore.setState({
      sessions: [
        {
          id: 'session-1',
          name: 'test',
          messages: [
            { id: 'sys', role: 'system', content: 'system prompt' },
            { id: 'user-1', role: 'user', content: '你好' },
            {
              id: 'assistant-1',
              role: 'assistant',
              content:
                '好的，现在我要处理用户的请求：“你好”。首先，我需要分析用户的需求。',
            },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      activeSessionId: 'session-1',
    });

    render(<Harness />);
    fireEvent.click(screen.getByText('send'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'chat_stream',
        expect.objectContaining({
          messages: [
            { id: 'sys', role: 'system', content: 'system prompt' },
            { id: 'user-1', role: 'user', content: '你好' },
            expect.objectContaining({ role: 'user', content: 'hello' }),
          ],
        })
      );
    });
  });
});
