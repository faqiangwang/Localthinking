// src/components/Chat/ChatSidebar/SessionList.tsx
// 会话列表组件

import { useState } from 'react';
import { ChatSession } from '../../../types';
import { formatTimestamp } from '../../../utils';
import styles from './SessionList.module.css';
import { groupSessionsByTimeline, sortSessionGroupEntries } from './sessionTimeline';

interface SessionListProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  streaming: boolean;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
}

export function SessionList({
  sessions,
  activeSessionId,
  streaming,
  onSessionSelect,
  onSessionDelete,
  onSessionRename,
}: SessionListProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const startRename = (sessionId: string, currentName: string) => {
    setEditingSessionId(sessionId);
    setEditingName(currentName);
  };

  const cancelRename = () => {
    setEditingSessionId(null);
    setEditingName('');
  };

  const finishRename = () => {
    const nextName = editingName.trim();
    if (editingSessionId && nextName) {
      onSessionRename(editingSessionId, nextName);
    }
    cancelRename();
  };

  const sessionGroups = sortSessionGroupEntries(groupSessionsByTimeline(sessions));

  return (
    <div className={styles.sessionList}>
      {sessionGroups.map(([groupLabel, groupSessions]) => (
        <div key={groupLabel} className={styles.sessionGroup}>
          <div className={styles.sessionGroupLabel}>{groupLabel}</div>
          {groupSessions.map(({ session }) => {
            const isSelectionBlocked = streaming && session.id !== activeSessionId;

            return (
              <div
                key={session.id}
                className={`${styles.sessionItem} ${
                  session.id === activeSessionId ? styles.active : ''
                } ${isSelectionBlocked ? styles.streamingDisabled : ''}`}
                aria-disabled={isSelectionBlocked}
                onClick={() => {
                  if (isSelectionBlocked) {
                    return;
                  }
                  onSessionSelect(session.id);
                }}
              >
                {editingSessionId === session.id ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onBlur={finishRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') finishRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                    className={styles.sessionNameInput}
                  />
                ) : (
                  <>
                    <div
                      className={styles.sessionName}
                      title={session.name}
                      onDoubleClick={() => {
                        if (isSelectionBlocked) {
                          return;
                        }
                        startRename(session.id, session.name);
                      }}
                    >
                      {session.name}
                    </div>
                    <div className={styles.sessionDate}>{formatTimestamp(session.updatedAt)}</div>
                    <button
                      className={styles.sessionDelete}
                      onClick={e => {
                        e.stopPropagation();
                        if (!window.confirm(`确定删除会话「${session.name}」吗？`)) {
                          return;
                        }
                        onSessionDelete(session.id);
                      }}
                      title="删除会话"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
