// src/components/Chat/ChatMain/VirtualMessageList.tsx
// 虚拟滚动消息列表（支持 1000+ 消息）

import { useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Message } from '../../../types';
import { MessageBubble } from '../../MessageBubble';
import styles from './VirtualMessageList.module.css';

interface VirtualMessageListProps {
  messages: Message[];
  streaming: boolean;
  focusRequest?: {
    id: number;
    index: number;
  } | null;
}

export function VirtualMessageList({ messages, streaming, focusRequest }: VirtualMessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 过滤系统消息并生成唯一 key
  const displayMessages = useMemo(
    () =>
      messages
        .filter(m => m.role !== 'system')
        .map((msg, index) => ({
          ...msg,
          _key: msg.id || `${msg.role}-${index}-${msg.content.slice(0, 10)}-${msg.content.length}`,
        })),
    [messages]
  );

  // 创建虚拟化实例
  const virtualizer = useVirtualizer({
    count: displayMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100, // 估计每条消息高度为 100px
    overscan: 5, // 预渲染上下各 5 条消息
  });

  // 自动滚动到底部（仅在有新消息时）
  const scrollToBottom = () => {
    if (parentRef.current) {
      parentRef.current.scrollTop = parentRef.current.scrollHeight;
    }
  };

  // 当有新消息时自动滚动
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, streaming]);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }

    virtualizer.scrollToIndex(focusRequest.index, { align: 'center' });

    const highlight = (attempt = 0) => {
      const element = parentRef.current?.querySelector<HTMLElement>(
        `[data-message-index="${focusRequest.index}"]`
      );

      if (!element) {
        if (attempt < 5) {
          highlightTimerRef.current = setTimeout(() => highlight(attempt + 1), 60);
        }
        return;
      }

      parentRef.current
        ?.querySelectorAll<HTMLElement>(`.${styles.highlighted}`)
        .forEach(node => node.classList.remove(styles.highlighted));

      element.classList.add(styles.highlighted);
      highlightTimerRef.current = setTimeout(() => {
        element.classList.remove(styles.highlighted);
      }, 2000);
    };

    highlight();

    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, [focusRequest, virtualizer]);

  // 获取最后一条用户消息（用于流式状态显示）
  const lastUserMessage = messages[messages.length - 1];

  return (
    <div className={styles.messageList} ref={parentRef}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map(virtualItem => {
          const message = displayMessages[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              data-message-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <MessageBubble
                key={message._key}
                message={message}
                streaming={
                  streaming &&
                  virtualItem.index === displayMessages.length - 1 &&
                  message.role === 'assistant'
                }
              />
            </div>
          );
        })}

        {/* 流式状态指示器 */}
        {streaming && lastUserMessage?.role === 'user' && (
          <div
            style={{
              position: 'absolute',
              top: `${virtualizer.getTotalSize()}px`,
              left: 0,
              width: '100%',
            }}
          >
            <MessageBubble message={{ role: 'assistant', content: '生成中...' }} streaming />
          </div>
        )}
      </div>
    </div>
  );
}
