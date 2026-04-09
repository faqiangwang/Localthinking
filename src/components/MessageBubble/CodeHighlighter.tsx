// src/components/MessageBubble/CodeHighlighter.tsx
// 消息内容中的代码高亮处理

import { CodeBlock, InlineCode } from './CodeBlock';

// 代码块正则表达式
const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;
// 内联代码正则表达式
const INLINE_CODE_REGEX = /`([^`]+)`/g;

interface ParsedContent {
  type: 'text' | 'codeBlock' | 'inlineCode';
  content: string;
  language?: string;
}

export function parseMessageContent(content: string): ParsedContent[] {
  const parts: ParsedContent[] = [];
  let lastIndex = 0;
  let match;

  // 首先处理代码块
  while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
    // 添加代码块之前的文本
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        parts.push({ type: 'text', content: textBefore });
      }
    }

    // 添加代码块
    parts.push({
      type: 'codeBlock',
      content: match[2].trim(),
      language: match[1] || 'plaintext',
    });

    lastIndex = match.index + match[0].length;
  }

  // 添加剩余文本
  if (lastIndex < content.length) {
    const remainingText = content.slice(lastIndex);
    if (remainingText.trim()) {
      parts.push({ type: 'text', content: remainingText });
    }
  }

  // 如果没有代码块，直接处理内联代码
  if (parts.length === 0) {
    return parseInlineCodes(content);
  }

  // 对每个文本部分处理内联代码
  const processedParts: ParsedContent[] = [];
  parts.forEach((part) => {
    if (part.type === 'text') {
      const inlineParts = parseInlineCodes(part.content);
      processedParts.push(...inlineParts);
    } else {
      processedParts.push(part);
    }
  });

  return processedParts;
}

function parseInlineCodes(content: string): ParsedContent[] {
  const parts: ParsedContent[] = [];
  let lastIndex = 0;
  let match;

  while ((match = INLINE_CODE_REGEX.exec(content)) !== null) {
    // 添加内联代码之前的文本
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        parts.push({ type: 'text', content: textBefore });
      }
    }

    // 添加内联代码
    parts.push({
      type: 'inlineCode',
      content: match[1],
    });

    lastIndex = match.index + match[0].length;
  }

  // 添加剩余文本
  if (lastIndex < content.length) {
    const remainingText = content.slice(lastIndex);
    if (remainingText.trim()) {
      parts.push({ type: 'text', content: remainingText });
    }
  }

  return parts.length > 0 ? parts : [{ type: 'text', content }];
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
            return <CodeBlock key={index} code={part.content} language={part.language} streaming={streaming} />;
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
