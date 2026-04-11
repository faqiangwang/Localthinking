// src/components/MessageBubble/CodeBlock.tsx
// 代码块组件（带高亮）

import { useState } from 'react';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '../providers';
import styles from './CodeBlock.module.css';
import { normalizeCodeLanguage, SyntaxHighlighter } from './syntaxHighlighter';

// 支持的编程语言
const LANGUAGE_DISPLAY_NAMES: { [key: string]: string } = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
  c: 'C',
  csharp: 'C#',
  go: 'Go',
  rust: 'Rust',
  php: 'PHP',
  ruby: 'Ruby',
  swift: 'Swift',
  kotlin: 'Kotlin',
  scala: 'Scala',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  xml: 'XML',
  yaml: 'YAML',
  markdown: 'Markdown',
  bash: 'Bash',
  shell: 'Shell',
  sql: 'SQL',
  dockerfile: 'Dockerfile',
  plaintext: 'Plain Text',
};

interface CodeBlockProps {
  code: string;
  language?: string;
  streaming?: boolean;
}

export function CodeBlock({ code, language = 'plaintext', streaming }: CodeBlockProps) {
  const { resolvedTheme } = useTheme();
  const [copied, setCopied] = useState(false);

  // 复制代码到剪贴板
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // 获取语言显示名称
  const languageDisplayName = LANGUAGE_DISPLAY_NAMES[language] || language;
  const normalizedLanguage = normalizeCodeLanguage(language);

  // 选择主题
  const theme = resolvedTheme === 'dark' ? vscDarkPlus : vs;

  return (
    <div className={`${styles.codeBlock} ${streaming ? styles.streaming : ''}`}>
      <div className={styles.header}>
        <span className={styles.language}>{languageDisplayName}</span>
        {streaming && <span className={styles.streamingIndicator}>⏳ 生成中...</span>}
        <button
          onClick={handleCopy}
          className={styles.copyButton}
          title={copied ? '已复制!' : '复制代码'}
          disabled={streaming}
        >
          {copied ? '✓' : '📋'}
        </button>
      </div>
      <div className={styles.codeContainer}>
        <SyntaxHighlighter
          language={normalizedLanguage}
          style={theme}
          customStyle={{
            margin: 0,
            borderRadius: '0 0 var(--radius-md) var(--radius-md)',
            fontSize: '13px',
            lineHeight: '1.5',
          }}
          showLineNumbers
          wrapLines
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
        {streaming && <span className={styles.streamingCursor}>▊</span>}
      </div>
    </div>
  );
}
