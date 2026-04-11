// src/components/Chat/ChatMain/ChatMain.tsx
// 主聊天区域组件（带搜索和虚拟滚动）

import { useState, useRef } from 'react';
import { ChatSession, Message, ModelParams } from '../../../types';
import { WelcomeScreen } from '../WelcomeScreen/WelcomeScreen';
import { MessageList } from './MessageList';
import { VirtualMessageList } from './VirtualMessageList';
import { ChatInput } from './ChatInput';
import { StatusBar } from './StatusBar';
import { SearchBar } from '../SearchBar';
import styles from './ChatMain.module.css';

interface ChatMainProps {
  activeSession: ChatSession | null;
  messages: Message[];
  streaming: boolean;
  error: string | null;
  modelLoaded: boolean;
  modelLoading: boolean;
  modelError: string | null;
  modelParams: ModelParams;
  tokPerSec: number;
  tokenCount: number;
  onNewSession: () => void;
  onSend: (content: string) => void;
  onStop: () => void;
  onToggleDebug: () => void;
  showDebug: boolean;
}

// 启用虚拟滚动的消息数量阈值（提高阈值，只在消息很多时才启用虚拟滚动）
const VIRTUAL_SCROLL_THRESHOLD = 500;

export function ChatMain({
  activeSession,
  messages,
  streaming,
  error,
  modelLoaded,
  modelLoading,
  modelError,
  modelParams,
  tokPerSec,
  tokenCount,
  onNewSession,
  onSend,
  onStop,
  onToggleDebug,
  showDebug,
}: ChatMainProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ id: number; index: number } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // 判断是否使用虚拟滚动
  const useVirtualScroll = messages.length > VIRTUAL_SCROLL_THRESHOLD;

  // 处理搜索结果点击
  const handleSearchResultClick = (messageIndex: number) => {
    setShowSearch(false);
    setFocusRequest({
      id: Date.now(),
      index: messageIndex,
    });
  };

  // 过滤用于显示的消息（过滤系统消息）
  const displayMessages = messages.filter(m => m.role !== 'system');

  return (
    <div className={styles.chatMain}>
      <div className={styles.chatHeader}>
        <h2>{activeSession?.name || 'Local thinking Chat'}</h2>
        <div className={styles.headerButtons}>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={styles.searchBtn}
            title="搜索消息"
          >
            🔍
          </button>
          <button onClick={onToggleDebug} className={styles.debugBtn} title="显示调试信息">
            {showDebug ? '隐藏调试' : '调试'}
          </button>
          <button onClick={onNewSession} className={styles.resetBtn}>
            新对话
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      {showSearch && (
        <div className={styles.searchContainer}>
          <SearchBar
            messages={displayMessages}
            onResultClick={handleSearchResultClick}
            onClose={() => setShowSearch(false)}
          />
        </div>
      )}

      {/* 模型加载状态提示 */}
      {modelLoading && (
        <div className={styles.modelLoadingBanner}>
          <div className={styles.loadingSpinner} />
          <span>模型加载中，请稍候...</span>
        </div>
      )}

      {/* 模型加载错误提示 */}
      {modelError && !modelLoaded && (
        <div className={styles.modelErrorBanner}>
          <span>模型加载失败</span>
          <span>{modelError.split('\n')[0]}</span>
          {modelError.includes('建议') && (
            <span className={styles.errorHint}>请查看「模型」页面的详细错误信息和解决方案</span>
          )}
        </div>
      )}

      {/* 消息列表 */}
      <div ref={messagesContainerRef} className={styles.messagesContainer}>
        {displayMessages.length === 0 && (
          <WelcomeScreen modelLoaded={modelLoaded} modelParams={modelParams} />
        )}

        {displayMessages.length > 0 && (
          <>
            {useVirtualScroll ? (
              <VirtualMessageList
                messages={messages}
                streaming={streaming}
                focusRequest={focusRequest}
              />
            ) : (
              <MessageList messages={messages} streaming={streaming} focusRequest={focusRequest} />
            )}
          </>
        )}
      </div>

      {error && <div className={styles.chatError}>{error}</div>}

      {!modelLoaded && displayMessages.length === 0 && (
        <div className={styles.modelStatusHint}>
          <p>💡 提示：请先在「模型」页面加载模型</p>
        </div>
      )}

      <StatusBar
        streaming={streaming}
        tokPerSec={tokPerSec}
        tokenCount={tokenCount}
        onStop={onStop}
      />

      <ChatInput
        onSend={onSend}
        disabled={streaming || !modelLoaded}
        placeholder={
          !modelLoaded ? '请先加载模型...' : '输入消息... (Enter 发送，Shift+Enter 换行)'
        }
      />
    </div>
  );
}
