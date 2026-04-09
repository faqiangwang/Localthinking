// src/components/Chat/ChatSidebar/SessionList.tsx
// 会话列表组件

import { useState } from 'react';
import { ChatSession } from '../../../types';
import styles from './SessionList.module.css';

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

  // 按时间线分组会话
  const groupSessionsByTimeline = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const halfYearAgo = new Date(today);
    halfYearAgo.setMonth(halfYearAgo.getMonth() - 6);

    // 使用 Map 来存储分组，支持动态的年月分组
    const groups = new Map<string, { session: ChatSession; label: string }[]>();

    // 初始化固定分组
    groups.set('今天', []);
    groups.set('昨天', []);
    groups.set('七天内', []);
    groups.set('三十天内', []);
    groups.set('半年内', []);

    sessions.forEach((session) => {
      // 使用 updatedAt 而不是 createdAt 来分组，这样更新的对话会移动到今天
      const sessionDate = new Date(session.updatedAt);

      if (sessionDate >= today) {
        groups.get('今天')!.push({ session, label: '今天' });
      } else if (sessionDate >= yesterday) {
        groups.get('昨天')!.push({ session, label: '昨天' });
      } else if (sessionDate >= sevenDaysAgo) {
        groups.get('七天内')!.push({ session, label: '七天内' });
      } else if (sessionDate >= thirtyDaysAgo) {
        groups.get('三十天内')!.push({ session, label: '三十天内' });
      } else if (sessionDate >= halfYearAgo) {
        groups.get('半年内')!.push({ session, label: '半年内' });
      } else {
        // 半年以上的按年.月显示，如 "2024.01"
        const year = sessionDate.getFullYear();
        const month = String(sessionDate.getMonth() + 1).padStart(2, '0');
        const monthKey = `${year}.${month}`;
        const monthLabel = `${year}.${month}`;

        if (!groups.has(monthKey)) {
          groups.set(monthKey, []);
        }
        groups.get(monthKey)!.push({ session, label: monthLabel });
      }
    });

    return groups;
  };

  const startRename = (sessionId: string, currentName: string) => {
    setEditingSessionId(sessionId);
    setEditingName(currentName);
  };

  const finishRename = () => {
    if (editingSessionId && editingName.trim()) {
      onSessionRename(editingSessionId, editingName.trim());
    }
    setEditingSessionId(null);
    setEditingName('');
  };

  const sessionGroups = groupSessionsByTimeline();

  // 对每个分组内的会话按 updatedAt 倒序排序（最近更新的在前）
  sessionGroups.forEach((groupSessions, _groupLabel) => {
    groupSessions.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
  });

  // 定义分组的显示顺序
  const groupOrder = ['今天', '昨天', '七天内', '三十天内', '半年内'];

  return (
    <div className={styles.sessionList}>
      {Array.from(sessionGroups.entries())
        .filter(([_, groupSessions]) => groupSessions.length > 0)
        // 排序：固定分组按预定顺序，年月分组按时间倒序
        .sort(([labelA], [labelB]) => {
          const indexA = groupOrder.indexOf(labelA);
          const indexB = groupOrder.indexOf(labelB);

          // 两个都是固定分组
          if (indexA !== -1 && indexB !== -1) {
            return indexA - indexB;
          }
          // A 是固定分组，B 不是
          if (indexA !== -1) {
            return -1;
          }
          // B 是固定分组，A 不是
          if (indexB !== -1) {
            return 1;
          }
          // 都是年月分组，按时间倒序（最近的在前）
          return labelB.localeCompare(labelA);
        })
        .map(([groupLabel, groupSessions]) => (
          <div key={groupLabel} className={styles.sessionGroup}>
            <div className={styles.sessionGroupLabel}>{groupLabel}</div>
            {groupSessions.map(({ session }) => (
              <div
                key={session.id}
                className={`${styles.sessionItem} ${
                  session.id === activeSessionId ? styles.active : ''
                } ${streaming && session.id !== activeSessionId ? styles.streamingDisabled : ''}`}
                onClick={() => {
                  if (streaming && session.id !== activeSessionId) {
                    return;
                  }
                  onSessionSelect(session.id);
                }}
              >
                {editingSessionId === session.id ? (
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={finishRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') finishRename();
                      if (e.key === 'Escape') setEditingSessionId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className={styles.sessionNameInput}
                  />
                ) : (
                  <>
                    <div
                      className={styles.sessionName}
                      onDoubleClick={() => startRename(session.id, session.name)}
                    >
                      {session.name}
                    </div>
                    <button
                      className={styles.sessionDelete}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSessionDelete(session.id);
                      }}
                      title="删除会话"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
