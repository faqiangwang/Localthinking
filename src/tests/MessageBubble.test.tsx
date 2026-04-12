import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageBubble } from '../components/MessageBubble';

describe('MessageBubble reasoning fallback', () => {
  it('将只有 think 内容的消息降级显示为普通回答', () => {
    render(<MessageBubble message={{ role: 'assistant', content: '<think>你好！</think>' }} />);

    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(screen.getByText('你好！')).toBeInTheDocument();
  });

  it('将未闭合 think 内容在结束后降级显示为普通回答', () => {
    render(<MessageBubble message={{ role: 'assistant', content: '<think>你好！我可以帮助你解答问题。' }} />);

    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(screen.getByText('你好！我可以帮助你解答问题。')).toBeInTheDocument();
  });

  it('流式阶段只有 think 内容时也直接显示可见回复', () => {
    render(
      <MessageBubble
        message={{ role: 'assistant', content: '<think>你好！我可以帮助你写作和解答问题。' }}
        streaming
      />
    );

    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(screen.getByText('你好！我可以帮助你写作和解答问题。')).toBeInTheDocument();
  });

  it('完整的 think 加回答内容只显示最终回答', () => {
    render(
      <MessageBubble
        message={{ role: 'assistant', content: '<think>先分析一下</think>你好！我可以帮助你解答问题。' }}
      />
    );

    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(screen.queryByText('先分析一下')).not.toBeInTheDocument();
    expect(screen.getByText('你好！我可以帮助你解答问题。')).toBeInTheDocument();
  });

  it('中文思考回答格式只显示回答部分', () => {
    render(
      <MessageBubble
        message={{ role: 'assistant', content: '思考：先判断用户意图。\n回答：你好，我可以帮你处理问题。' }}
      />
    );

    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(screen.queryByText('先判断用户意图。')).not.toBeInTheDocument();
    expect(screen.getByText('你好，我可以帮你处理问题。')).toBeInTheDocument();
  });
});
