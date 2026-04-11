import { describe, expect, it } from 'vitest';
import {
  generatePreview,
  getHighlightSegments,
  searchMessages,
} from '../components/Chat/searchUtils';
import type { Message } from '../types';

describe('searchUtils', () => {
  it('应支持包含正则特殊字符的搜索词', () => {
    const messages: Message[] = [
      { role: 'user', content: '请搜索 a+b 和 a+b?' },
      { role: 'assistant', content: '普通回复' },
    ];

    const results = searchMessages(messages, 'a+b?');

    expect(results).toHaveLength(1);
    expect(results[0].matches).toBe(1);
  });

  it('应忽略 system 消息并按匹配数排序', () => {
    const messages: Message[] = [
      { role: 'system', content: 'keyword keyword keyword' },
      { role: 'assistant', content: 'keyword' },
      { role: 'user', content: 'keyword keyword' },
    ];

    const results = searchMessages(messages, 'keyword');

    expect(results).toHaveLength(2);
    expect(results[0].message.role).toBe('user');
    expect(results[0].matches).toBe(2);
  });

  it('应在命中位置附近生成预览', () => {
    const preview = generatePreview(
      '这是一个很长的消息，用来测试 preview 生成逻辑，目标关键词就在这里：needle，然后后面还有更多内容。',
      'needle'
    );

    expect(preview).toContain('needle');
    expect(preview.length).toBeLessThanOrEqual(110);
  });

  it('应按查询词拆分高亮片段并忽略大小写', () => {
    expect(getHighlightSegments('Hello hello HeLLo', 'hello')).toEqual([
      { text: 'Hello', matched: true },
      { text: ' ', matched: false },
      { text: 'hello', matched: true },
      { text: ' ', matched: false },
      { text: 'HeLLo', matched: true },
    ]);
  });

  it('应支持带特殊字符的高亮片段拆分', () => {
    expect(getHighlightSegments('a+b? 和 a+b?', 'a+b?')).toEqual([
      { text: 'a+b?', matched: true },
      { text: ' 和 ', matched: false },
      { text: 'a+b?', matched: true },
    ]);
  });
});
