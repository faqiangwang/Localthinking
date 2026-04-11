import { describe, expect, it } from 'vitest';
import { parseMessageContent } from '../components/MessageBubble/messageContentParser';
import { deepClone } from '../utils';

describe('messageContentParser', () => {
  it('重复解析相同内容时应保持稳定', () => {
    const content = '前置文本\n```ts\nconst value = 1;\n```\n结尾 `inline`';

    const first = parseMessageContent(content);
    const second = parseMessageContent(content);

    expect(first).toEqual(second);
    expect(second).toEqual([
      { type: 'text', content: '前置文本\n' },
      { type: 'codeBlock', content: 'const value = 1;', language: 'ts' },
      { type: 'text', content: '\n结尾 ' },
      { type: 'inlineCode', content: 'inline' },
    ]);
  });

  it('没有代码块时也能解析行内代码', () => {
    expect(parseMessageContent('请运行 `npm run build`')).toEqual([
      { type: 'text', content: '请运行 ' },
      { type: 'inlineCode', content: 'npm run build' },
    ]);
  });
});

describe('deepClone', () => {
  it('应复制嵌套对象和数组而不共享引用', () => {
    const source = {
      message: 'hello',
      nested: {
        count: 1,
      },
      list: [1, { done: false }],
    };

    const cloned = deepClone(source);

    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    expect(cloned.nested).not.toBe(source.nested);
    expect(cloned.list).not.toBe(source.list);
    expect(cloned.list[1]).not.toBe(source.list[1]);
  });
});
