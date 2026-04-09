// src/components/Chat/ChatSidebar/ChatSidebar.tsx
// 聊天侧边栏组件

import { ChatSession } from '../../../types';
import { SessionList } from './SessionList';
import styles from './ChatSidebar.module.css';

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  streaming: boolean;
  collapsed: boolean;
  onNewSession: () => void;
  onToggleCollapse: () => void;
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  streaming,
  collapsed,
  onNewSession,
  onToggleCollapse,
  onSessionSelect,
  onSessionDelete,
  onSessionRename,
}: ChatSidebarProps) {
  return (
    <div className={`${styles.sessionSidebar} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.sessionHeader}>
        <button onClick={onNewSession} className={styles.newChatBtn}>
          + 新对话
        </button>
        <button
          onClick={onToggleCollapse}
          className={styles.sidebarToggleBtn}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      {!collapsed && (
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          streaming={streaming}
          onSessionSelect={onSessionSelect}
          onSessionDelete={onSessionDelete}
          onSessionRename={onSessionRename}
        />
      )}
    </div>
  );
}
