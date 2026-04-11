import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchBar } from '../components/Chat/SearchBar';
import type { Message } from '../types';

const messages: Message[] = [
  { role: 'user', content: 'alpha beta gamma' },
  { role: 'assistant', content: 'beta beta delta' },
];

describe('SearchBar', () => {
  it('打开后应自动聚焦输入框，并在 Escape 时关闭', () => {
    const onClose = vi.fn();

    render(<SearchBar messages={messages} onResultClick={vi.fn()} onClose={onClose} />);

    const input = screen.getByPlaceholderText(
      '搜索消息... (↑↓ 导航, Enter 跳转, Esc 关闭)'
    ) as HTMLInputElement;

    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: 'beta' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('应渲染命中高亮并支持 Enter 跳转', () => {
    const onResultClick = vi.fn();

    render(<SearchBar messages={messages} onResultClick={onResultClick} />);

    const input = screen.getByPlaceholderText('搜索消息... (↑↓ 导航, Enter 跳转, Esc 关闭)');

    fireEvent.change(input, { target: { value: 'beta' } });

    expect(screen.getAllByText('beta').length).toBeGreaterThan(1);

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onResultClick).toHaveBeenCalledWith(1);
  });
});
