import { Message } from '../../types';

export interface SearchResult {
  message: Message;
  index: number;
  matches: number;
  preview: string;
}

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function generatePreview(content: string, query: string): string {
  const maxLength = 150;
  const queryLower = query.toLowerCase();
  const contentLower = content.toLowerCase();
  const firstMatchIndex = contentLower.indexOf(queryLower);

  if (firstMatchIndex === -1) {
    return content.slice(0, maxLength) + (content.length > maxLength ? '...' : '');
  }

  const start = Math.max(0, firstMatchIndex - 50);
  const end = Math.min(content.length, firstMatchIndex + query.length + 50);

  let preview = content.slice(start, end);

  if (start > 0) {
    preview = '...' + preview;
  }

  if (end < content.length) {
    preview += '...';
  }

  return preview;
}

export function getHighlightSegments(text: string, query: string): HighlightSegment[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [{ text, matched: false }];
  }

  const parts = text
    .split(new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'gi'))
    .filter(part => part.length > 0);

  return parts.map(part => ({
    text: part,
    matched: part.toLowerCase() === normalizedQuery.toLowerCase(),
  }));
}

export function searchMessages(messages: Message[], query: string): SearchResult[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const searchLower = normalizedQuery.toLowerCase();
  const safePattern = escapeRegExp(searchLower);
  const matcher = new RegExp(safePattern, 'g');
  const results: SearchResult[] = [];

  messages.forEach((message, index) => {
    if (message.role === 'system') {
      return;
    }

    const content = message.content;
    const contentLower = content.toLowerCase();
    const matches = (contentLower.match(matcher) || []).length;

    if (matches === 0) {
      return;
    }

    results.push({
      message,
      index,
      matches,
      preview: generatePreview(content, normalizedQuery),
    });
  });

  return results.sort((a, b) => b.matches - a.matches);
}
