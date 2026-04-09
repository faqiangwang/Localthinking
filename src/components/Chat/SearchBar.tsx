// src/components/Chat/SearchBar.tsx
// 消息搜索组件

import { useState, useCallback, useMemo } from 'react';
import { Message } from '../../types';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  messages: Message[];
  onResultClick: (messageIndex: number) => void;
}

interface SearchResult {
  message: Message;
  index: number;
  matches: number;
  preview: string;
}

export function SearchBar({ messages, onResultClick }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 搜索消息
  const results = useMemo<SearchResult[]>(() => {
    if (!query.trim()) {
      return [];
    }

    const searchLower = query.toLowerCase();
    const searchResults: SearchResult[] = [];

    messages.forEach((message, index) => {
      // 跳过系统消息
      if (message.role === 'system') return;

      const content = message.content;
      const contentLower = content.toLowerCase();

      // 查找匹配数量
      const matches = (contentLower.match(new RegExp(searchLower, 'g')) || []).length;

      if (matches > 0) {
        // 生成预览文本（高亮匹配部分）
        const preview = generatePreview(content, query);

        searchResults.push({
          message,
          index,
          matches,
          preview,
        });
      }
    });

    // 按匹配数量排序
    return searchResults.sort((a, b) => b.matches - a.matches);
  }, [query, messages]);

  // 生成预览文本（带高亮）
  const generatePreview = (content: string, query: string): string => {
    const maxLength = 150;
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();

    // 找到第一个匹配位置
    const firstMatchIndex = contentLower.indexOf(queryLower);

    if (firstMatchIndex === -1) {
      return content.slice(0, maxLength) + (content.length > maxLength ? '...' : '');
    }

    // 计算预览范围（匹配前后各 50 个字符）
    const start = Math.max(0, firstMatchIndex - 50);
    const end = Math.min(content.length, firstMatchIndex + query.length + 50);

    let preview = content.slice(start, end);

    // 添加省略号
    if (start > 0) preview = '...' + preview;
    if (end < content.length) preview = preview + '...';

    return preview;
  };

  // 处理键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!results.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % results.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (results[selectedIndex]) {
            onResultClick(results[selectedIndex].index);
          }
          break;
        case 'Escape':
          setQuery('');
          setSelectedIndex(0);
          break;
      }
    },
    [results, selectedIndex, onResultClick]
  );

  return (
    <div className={styles.searchBar}>
      <div className={styles.searchInput}>
        <span className={styles.searchIcon}>🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="搜索消息... (↑↓ 导航, Enter 跳转, Esc 关闭)"
          className={styles.input}
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setSelectedIndex(0);
            }}
            className={styles.clearButton}
            title="清除搜索"
          >
            ×
          </button>
        )}
      </div>

      {query && results.length > 0 && (
        <div className={styles.results}>
          <div className={styles.resultsHeader}>
            找到 <strong>{results.length}</strong> 条结果
          </div>
          <div className={styles.resultsList}>
            {results.map((result, index) => (
              <div
                key={result.index}
                className={`${styles.resultItem} ${
                  index === selectedIndex ? styles.selected : ''
                }`}
                onClick={() => onResultClick(result.index)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className={styles.resultHeader}>
                  <span className={`${styles.role} ${styles[result.message.role]}`}>
                    {result.message.role === 'user' ? '用户' : '助手'}
                  </span>
                  <span className={styles.matches}>{result.matches} 个匹配</span>
                </div>
                <div className={styles.preview}>{result.preview}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {query && results.length === 0 && (
        <div className={styles.noResults}>
          未找到匹配的消息
        </div>
      )}
    </div>
  );
}
