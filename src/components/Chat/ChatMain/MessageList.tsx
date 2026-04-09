// src/components/Chat/ChatMain/MessageList.tsx
// 消息列表组件（带虚拟滚动）

import { useRef, useEffect } from 'react';
import { Message } from '../../../types';
import { MessageBubble } from '../../MessageBubble';
import styles from './MessageList.module.css';

interface MessageListProps {
  messages: Message[];
  streaming: boolean;
}

export function MessageList({ messages, streaming }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 自动滚动到底部（节流版本）
  useEffect(() => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
    }

    scrollTimerRef.current = setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }, 150);

    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, [messages, streaming]);

  // 过滤系统消息并生成唯一 key
  const displayMessages = messages
    .filter((m) => m.role !== 'system')
    .map((msg, index) => ({
      ...msg,
      _key: msg.id || `${msg.role}-${index}-${msg.content.slice(0, 10)}-${msg.content.length}`,
      _index: index, // 用于搜索定位
    }));

  const lastUserMessage = messages[messages.length - 1];

  return (
    <div className={styles.messageList} ref={containerRef}>
      {displayMessages.map((msg, index) => (
        <div key={msg._key} data-message-index={index}>
          <MessageBubble message={msg} />
        </div>
      ))}

      {streaming && lastUserMessage?.role === 'user' && (
        <MessageBubble message={{ role: 'assistant', content: '思考中...' }} streaming />
      )}
    </div>
  );
}
