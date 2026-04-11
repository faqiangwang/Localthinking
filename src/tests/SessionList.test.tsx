import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionList } from '../components/Chat/ChatSidebar/SessionList';
import type { ChatSession } from '../types';

function createSession(id: string, name: string, updatedAt: number): ChatSession {
  return {
    id,
    name,
    messages: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('SessionList', () => {
  const sessions = [
    createSession('active', '当前会话', Date.now()),
    createSession('other', '其他会话', Date.now() - 1000),
  ];

  it('流式输出时不允许切换到非活动会话', () => {
    const onSessionSelect = vi.fn();

    render(
      <SessionList
        sessions={sessions}
        activeSessionId="active"
        streaming
        onSessionSelect={onSessionSelect}
        onSessionDelete={vi.fn()}
        onSessionRename={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('其他会话'));

    expect(onSessionSelect).not.toHaveBeenCalled();
  });

  it('流式输出时仍允许删除非活动会话', () => {
    const onSessionDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <SessionList
        sessions={sessions}
        activeSessionId="active"
        streaming
        onSessionSelect={vi.fn()}
        onSessionDelete={onSessionDelete}
        onSessionRename={vi.fn()}
      />
    );

    const deleteButtons = screen.getAllByTitle('删除会话');
    fireEvent.click(deleteButtons[1]);

    expect(onSessionDelete).toHaveBeenCalledWith('other');
    confirmSpy.mockRestore();
  });

  it('流式输出时不在非活动会话上进入重命名模式', () => {
    render(
      <SessionList
        sessions={sessions}
        activeSessionId="active"
        streaming
        onSessionSelect={vi.fn()}
        onSessionDelete={vi.fn()}
        onSessionRename={vi.fn()}
      />
    );

    fireEvent.doubleClick(screen.getByText('其他会话'));

    expect(screen.queryByDisplayValue('其他会话')).not.toBeInTheDocument();
  });
});
