// src/components/Chat.tsx
// 聊天容器组件（重构后）

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../store';
import { useModel } from '../../hooks/useModel';
import { useChat } from '../../hooks/useChat';
import { ChatSidebar } from './ChatSidebar/ChatSidebar';
import { ChatMain } from './ChatMain/ChatMain';
import { DebugPanel } from './DebugPanel/DebugPanel';
import styles from './Chat.module.css';

export function Chat() {
  const { settings } = useSettingsStore();
  const { modelLoaded, loading: modelLoading, error: modelError } = useModel();
  const {
    sessions,
    activeSession,
    messages,
    streaming,
    error: chatError,
    tokPerSec,
    tokenCount,
    send,
    stop,
    createSession,
    switchSession,
    deleteSession,
    renameSession,
  } = useChat(settings.system_prompt);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const error = localError || chatError;

  // 处理发送消息
  const handleSend = useCallback(
    async (content: string) => {
      // 清除之前的错误
      setLocalError(null);

      // 检查是否已加载模型
      if (!modelLoaded) {
        setLocalError('请先加载模型才能发送消息。请前往「模型」页面加载模型。');
        return;
      }

      await send(content);
    },
    [modelLoaded, send]
  );

  // 处理新建会话
  const handleNewSession = useCallback(async () => {
    // 如果正在流式输出，先停止
    if (streaming) {
      await invoke('stop_generation').catch(() => {});
    }
    createSession();
  }, [streaming, createSession]);

  // 处理切换会话
  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      // 如果正在流式输出，先停止
      if (streaming) {
        await invoke('stop_generation').catch(() => {});
      }
      switchSession(sessionId);
    },
    [streaming, switchSession]
  );

  // 处理删除会话
  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      // 如果正在流式输出，先停止
      if (streaming) {
        await invoke('stop_generation').catch(() => {});
      }
      deleteSession(sessionId);
    },
    [streaming, deleteSession]
  );

  return (
    <div className={styles.chatContainer}>
      {/* 左侧会话列表 */}
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSession?.id || null}
        streaming={streaming}
        collapsed={sidebarCollapsed}
        onNewSession={handleNewSession}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onSessionSelect={handleSwitchSession}
        onSessionDelete={handleDeleteSession}
        onSessionRename={renameSession}
      />

      {/* 右侧聊天区域 */}
      <ChatMain
        activeSession={activeSession ?? null}
        messages={messages}
        streaming={streaming}
        error={error}
        modelLoaded={modelLoaded}
        modelLoading={modelLoading}
        modelError={modelError}
        tokPerSec={tokPerSec}
        tokenCount={tokenCount}
        onNewSession={handleNewSession}
        onSend={handleSend}
        onStop={stop}
        onToggleDebug={() => setShowDebug(!showDebug)}
        showDebug={showDebug}
      />

      {/* 调试面板 */}
      {showDebug && (
        <DebugPanel
          modelLoaded={modelLoaded}
          modelLoading={modelLoading}
          streaming={streaming}
          messages={messages}
          tokPerSec={tokPerSec}
          tokenCount={tokenCount}
          modelError={modelError}
          chatError={error}
          onClose={() => setShowDebug(false)}
        />
      )}
    </div>
  );
}
