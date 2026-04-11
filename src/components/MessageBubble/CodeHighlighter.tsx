import { lazy, Suspense } from 'react';
import styles from './CodeBlock.module.css';
import { InlineCode } from './InlineCode';
import { parseMessageContent } from './messageContentParser';

const LazyCodeBlock = lazy(() =>
  import('./CodeBlock').then(module => ({ default: module.CodeBlock }))
);

function PlainCodeBlock({
  code,
  language = 'plaintext',
  streaming,
}: {
  code: string;
  language?: string;
  streaming?: boolean;
}) {
  return (
    <div className={`${styles.codeBlock} ${streaming ? styles.streaming : ''}`}>
      <div className={styles.header}>
        <span className={styles.language}>{language}</span>
        {streaming && <span className={styles.streamingIndicator}>⏳ 生成中...</span>}
      </div>
      <div className={styles.codeContainer}>
        <pre
          style={{
            margin: 0,
            padding: '16px',
            overflowX: 'auto',
            fontSize: '13px',
            lineHeight: '1.5',
            fontFamily: 'var(--font-family-mono)',
          }}
        >
          <code>{code}</code>
        </pre>
        {streaming && <span className={styles.streamingCursor}>▊</span>}
      </div>
    </div>
  );
}

interface MessageContentProps {
  content: string;
  streaming?: boolean;
}

export function MessageContent({ content, streaming }: MessageContentProps) {
  const parts = parseMessageContent(content);

  return (
    <>
      {parts.map((part, index) => {
        switch (part.type) {
          case 'codeBlock':
            return (
              <Suspense
                key={index}
                fallback={
                  <PlainCodeBlock
                    code={part.content}
                    language={part.language}
                    streaming={streaming}
                  />
                }
              >
                <LazyCodeBlock code={part.content} language={part.language} streaming={streaming} />
              </Suspense>
            );
          case 'inlineCode':
            return <InlineCode key={index}>{part.content}</InlineCode>;
          case 'text':
          default:
            return (
              <span
                key={index}
                className="message-text"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {part.content}
                {streaming && index === parts.length - 1 && part.type === 'text' && (
                  <span className="streaming-cursor">▊</span>
                )}
              </span>
            );
        }
      })}
    </>
  );
}
