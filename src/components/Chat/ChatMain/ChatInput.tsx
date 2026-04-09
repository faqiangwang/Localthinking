// src/components/Chat/ChatMain/ChatInput.tsx
// 聊天输入框组件

import { useState, FormEvent, KeyboardEvent } from 'react';
import styles from './ChatInput.module.css';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled,
  placeholder = '输入消息... (Enter 发送，Shift+Enter 换行)',
}: ChatInputProps) {
  const [input, setInput] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    const content = input;
    setInput('');
    await onSend(content);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form className={styles.chatInput} onSubmit={handleSubmit}>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
      />
      <button type="submit" disabled={!input.trim() || disabled} title={disabled ? '请先加载模型' : ''}>
        {disabled ? '生成中...' : '发送'}
      </button>
    </form>
  );
}
