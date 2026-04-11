// src/components/Chat/SearchBar.tsx
// 消息搜索组件

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Message } from '../../types';
import styles from './SearchBar.module.css';
import { getHighlightSegments, searchMessages, type SearchResult } from './searchUtils';

interface SearchBarProps {
  messages: Message[];
  onResultClick: (messageIndex: number) => void;
  onClose?: () => void;
}

export function SearchBar({ messages, onResultClick, onClose }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo<SearchResult[]>(() => searchMessages(messages, query), [messages, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 处理键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          setQuery('');
          setSelectedIndex(0);
          onClose?.();
          return;
        case 'ArrowDown':
          if (!results.length) return;
          e.preventDefault();
          setSelectedIndex(prev => (prev + 1) % results.length);
          break;
        case 'ArrowUp':
          if (!results.length) return;
          e.preventDefault();
          setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
          break;
        case 'Enter':
          if (!results.length) return;
          e.preventDefault();
          if (results[selectedIndex]) {
            onResultClick(results[selectedIndex].index);
          }
          break;
      }
    },
    [onClose, onResultClick, results, selectedIndex]
  );

  return (
    <div className={styles.searchBar}>
      <div className={styles.searchInput}>
        <span className={styles.searchIcon}>🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => {
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
                className={`${styles.resultItem} ${index === selectedIndex ? styles.selected : ''}`}
                onClick={() => onResultClick(result.index)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className={styles.resultHeader}>
                  <span className={`${styles.role} ${styles[result.message.role]}`}>
                    {result.message.role === 'user' ? '用户' : '助手'}
                  </span>
                  <span className={styles.matches}>{result.matches} 个匹配</span>
                </div>
                <div className={styles.preview}>
                  {getHighlightSegments(result.preview, query).map((segment, segmentIndex) =>
                    segment.matched ? (
                      <mark key={segmentIndex} className={styles.highlight}>
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={segmentIndex}>{segment.text}</span>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {query && results.length === 0 && <div className={styles.noResults}>未找到匹配的消息</div>}
    </div>
  );
}
