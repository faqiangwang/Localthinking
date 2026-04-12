/* @refresh reset */
// src/components/Chat.tsx
// 聊天容器组件（重构后）

import { useState, useCallback } from 'react';
import { useSettingsStore } from '../../store';
import { useModel } from '../../hooks/useModel';
import { useChat } from '../../hooks/useChat';
import { ChatSidebar } from './ChatSidebar/ChatSidebar';
import { ChatMain } from './ChatMain/ChatMain';
import { DebugPanel } from './DebugPanel/DebugPanel';
import styles from './Chat.module.css';

export function Chat() {
  const { settings } = useSettingsStore();
  const { modelLoaded, modelPath, loading: modelLoading, error: modelError } = useModel();
  const {
    sessions,
    activeSession,
    messages,
    streaming,
    error: chatError,
    tokPerSec,
    promptTokPerSec,
    firstTokenLatencyMs,
    promptTokenCount,
    tokenCount,
    send,
    stop,
    createSession,
    switchSession,
    deleteSession,
    renameSession,
  } = useChat(settings.system_prompt, settings.model_params);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const error = localError || chatError;

  const stopStreamingIfNeeded = useCallback(async () => {
    if (!streaming) {
      return;
    }

    await stop();
  }, [stop, streaming]);

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
    await stopStreamingIfNeeded();
    createSession();
  }, [createSession, stopStreamingIfNeeded]);

  // 处理切换会话
  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      await stopStreamingIfNeeded();
      switchSession(sessionId);
    },
    [stopStreamingIfNeeded, switchSession]
  );

  // 处理删除会话
  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      await stopStreamingIfNeeded();
      deleteSession(sessionId);
    },
    [deleteSession, stopStreamingIfNeeded]
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
        modelParams={settings.model_params}
        tokPerSec={tokPerSec}
        promptTokPerSec={promptTokPerSec}
        firstTokenLatencyMs={firstTokenLatencyMs}
        promptTokenCount={promptTokenCount}
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
          activeSessionId={activeSession?.id ?? null}
          modelLoaded={modelLoaded}
          modelLoading={modelLoading}
          modelPath={modelPath ?? null}
          modelParams={settings.model_params}
          streaming={streaming}
          messages={messages}
          tokPerSec={tokPerSec}
          promptTokPerSec={promptTokPerSec}
          firstTokenLatencyMs={firstTokenLatencyMs}
          promptTokenCount={promptTokenCount}
          tokenCount={tokenCount}
          modelError={modelError}
          chatError={error}
          onClose={() => setShowDebug(false)}
        />
      )}
    </div>
  );
}
