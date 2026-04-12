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
});
