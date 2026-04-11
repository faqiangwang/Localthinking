const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;
const INLINE_CODE_REGEX = /`([^`]+)`/g;

export interface ParsedContent {
  type: 'text' | 'codeBlock' | 'inlineCode';
  content: string;
  language?: string;
}

export function parseMessageContent(content: string): ParsedContent[] {
  CODE_BLOCK_REGEX.lastIndex = 0;

  const parts: ParsedContent[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        parts.push({ type: 'text', content: textBefore });
      }
    }

    parts.push({
      type: 'codeBlock',
      content: match[2].trim(),
      language: match[1] || 'plaintext',
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remainingText = content.slice(lastIndex);
    if (remainingText.trim()) {
      parts.push({ type: 'text', content: remainingText });
    }
  }

  if (parts.length === 0) {
    return parseInlineCodes(content);
  }

  const processedParts: ParsedContent[] = [];
  parts.forEach(part => {
    if (part.type === 'text') {
      processedParts.push(...parseInlineCodes(part.content));
      return;
    }

    processedParts.push(part);
  });

  return processedParts;
}

function parseInlineCodes(content: string): ParsedContent[] {
  INLINE_CODE_REGEX.lastIndex = 0;

  const parts: ParsedContent[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_CODE_REGEX.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        parts.push({ type: 'text', content: textBefore });
      }
    }

    parts.push({
      type: 'inlineCode',
      content: match[1],
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remainingText = content.slice(lastIndex);
    if (remainingText.trim()) {
      parts.push({ type: 'text', content: remainingText });
    }
  }

  return parts.length > 0 ? parts : [{ type: 'text', content }];
}
