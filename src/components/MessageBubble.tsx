// src/components/MessageBubble.tsx
import { Message } from "../types";
import { memo } from "react";
import { MessageContent } from "./MessageBubble/CodeHighlighter";

interface MessageBubbleProps {
  message: Message;
  streaming?: boolean;
}

const THINKING_BLOCK_PATTERNS = [
  {
    thinking: /<思考>([\s\S]*?)<\/思考>/,
    answer: /<回答>([\s\S]*?)<\/回答>/,
    partialThinking: /<思考>([\s\S]*)/,
    partialAnswer: /<回答>([\s\S]*)/,
    thinkingStart: '<思考>',
    thinkingEnd: '</思考>',
    answerMarkers: ['<回答>', '回答：', '回答:'],
  },
  {
    thinking: /<think>([\s\S]*?)<\/think>/i,
    answer: /<\/think>\s*([\s\S]*)/i,
    partialThinking: /<think>([\s\S]*)/i,
    partialAnswer: /<\/think>\s*([\s\S]*)/i,
    thinkingStart: '<think>',
    thinkingEnd: '</think>',
    answerMarkers: ['</think>', '<answer>', '回答：', '回答:'],
  },
  {
    thinking: /思考[：:]\s*([\s\S]*?)(?=\n回答[：:]|$)/,
    answer: /回答[：:]\s*([\s\S]*)$/,
    partialThinking: /思考[：:]\s*([\s\S]*)/,
    partialAnswer: /回答[：:]\s*([\s\S]*)/,
    thinkingStart: '思考：',
    thinkingEnd: '',
    answerMarkers: ['回答：', '回答:'],
  },
];

const RAW_REASONING_USER_CUES = [
  '用户',
  '请求',
  '需求',
  '输入',
  '问题',
  '对话历史',
  '回应',
  '回答',
  '具体服务',
  '能力',
  '服务',
];

const RAW_REASONING_PLANNING_CUES = [
  '我需要',
  '我应该',
  '我要',
  '我会',
  '我要分析',
  '我要考虑',
  '需要理解',
  '需要考虑',
  '引导用户',
  '测试我的反应',
  '使用场景',
  '身份',
  '打字错误',
  '看起来',
  '意味着',
  '确保回应',
  '保持友好',
  '开放的态度',
  '回顾之前的对话历史',
  '进一步了解',
];

const RAW_REASONING_OPENING = /^(好|嗯|好的|首先|另外|看起来|让我|基于|根据)[，,。]?\s*/;

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveThinkingPattern(content: string) {
  return (
    THINKING_BLOCK_PATTERNS.find(candidate => content.match(candidate.thinking)) ||
    THINKING_BLOCK_PATTERNS.find(candidate => content.match(candidate.partialThinking)) ||
    THINKING_BLOCK_PATTERNS.find(candidate =>
      candidate.answerMarkers.some(marker => content.includes(marker))
    ) ||
    null
  );
}

function isLikelyRawReasoningLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (
    RAW_REASONING_OPENING.test(trimmed) &&
    (RAW_REASONING_USER_CUES.some(cue => trimmed.includes(cue)) ||
      RAW_REASONING_PLANNING_CUES.some(cue => trimmed.includes(cue)))
  ) {
    return true;
  }

  const userCueCount = RAW_REASONING_USER_CUES.filter(cue => trimmed.includes(cue)).length;
  const planningCueCount = RAW_REASONING_PLANNING_CUES.filter(cue => trimmed.includes(cue)).length;

  return (
    (trimmed.includes('用户') && planningCueCount > 0) ||
    userCueCount + planningCueCount >= 2
  );
}

function isLikelyRawReasoningMessage(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  const openingMatched =
    RAW_REASONING_OPENING.test(trimmed) ||
    /^(接下来|现在|然后)/.test(trimmed);
  const userCueCount = RAW_REASONING_USER_CUES.filter(cue => trimmed.includes(cue)).length;
  const planningCueCount = RAW_REASONING_PLANNING_CUES.filter(cue => trimmed.includes(cue)).length;

  if (openingMatched && userCueCount >= 1 && planningCueCount >= 1) {
    return true;
  }

  const sentenceLikeParts = trimmed
    .split(/[。！？!?\n]/)
    .map(part => part.trim())
    .filter(Boolean);
  const reasoningParts = sentenceLikeParts.filter(isLikelyRawReasoningLine);

  return reasoningParts.length >= 2 && reasoningParts.length >= Math.ceil(sentenceLikeParts.length / 2);
}

function sanitizeRawReasoningContent(content: string) {
  const normalized = content.replace(/\r/g, '').trim();
  if (!normalized) {
    return null;
  }

  if (isLikelyRawReasoningMessage(normalized)) {
    return '';
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return null;
  }

  const visibleParagraphs = paragraphs.filter(paragraph => !isLikelyRawReasoningLine(paragraph));

  if (visibleParagraphs.length === paragraphs.length) {
    return null;
  }

  if (visibleParagraphs.length > 0) {
    return visibleParagraphs.join('\n\n');
  }

  return '';
}

// 解析思考过程和回答
function parseContent(content: string, hasPartialThinking: boolean, hasPartialAnswer: boolean) {
  let thinking = null;
  let answer = content;
  const pattern = resolveThinkingPattern(content);

  const thinkingMatch = pattern ? content.match(pattern.thinking) : null;
  const answerMatch = pattern ? content.match(pattern.answer) : null;

  // 如果正在生成思考过程（流式输出）
  if (pattern && hasPartialThinking) {
    const partialMatch = content.match(pattern.partialThinking);

    if (partialMatch) {
      thinking = trimOrNull(partialMatch[1]);
      answer = '';
    }
  } else if (pattern && hasPartialAnswer) {
    // 如果正在生成回答（流式输出）
    thinking = trimOrNull(thinkingMatch?.[1]);

    const answerTextMatch = content.match(pattern.partialAnswer);
    const answerText = trimOrNull(answerTextMatch?.[1]);
    answer = answerText || '';

    if (!answer && thinking) {
      return {
        thinking: null,
        answer: '',
      };
    }
  } else if (pattern) {
    // 完整的思考过程和回答
    thinking = trimOrNull(thinkingMatch?.[1]);
    answer = trimOrNull(answerMatch?.[1]) || '';

    if (!answer && thinking) {
      return {
        thinking: null,
        answer: '',
      };
    }
  } else {
    const sanitized = sanitizeRawReasoningContent(content);
    if (sanitized !== null) {
      answer = sanitized;
    }
  }

  return { thinking, answer };
}

// 自定义比较函数，确保 content 变化时重新渲染
function arePropsEqual(prevProps: MessageBubbleProps, nextProps: MessageBubbleProps) {
  return (
    prevProps.message.role === nextProps.message.role &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.streaming === nextProps.streaming
  );
}

export const MessageBubble = memo(function MessageBubble({ message, streaming }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const hasExplicitThinkingPattern = resolveThinkingPattern(message.content) !== null;

  // 检测流式输出中是否正在生成 thinking
  const lowerContent = message.content.toLowerCase();
  const hasPartialThinking =
    (message.content.includes('<思考>') ||
      lowerContent.includes('<think>') ||
      message.content.includes('思考：') ||
      message.content.includes('思考:')) &&
    !message.content.includes('</思考>') &&
    !lowerContent.includes('</think>') &&
    !(
      message.content.includes('回答：') ||
      message.content.includes('回答:') ||
      message.content.includes('<回答>')
    );

  // 检测流式输出中是否正在生成回答
  const hasPartialAnswer =
    (message.content.includes('<回答>') && !message.content.includes('</回答>')) ||
    (message.content.includes('回答：') || message.content.includes('回答:')) ||
    lowerContent.includes('</think>');

  // 解析内容（传入 hasPartialThinking 和 hasPartialAnswer 以正确处理流式输出）
  const { answer } = parseContent(message.content, hasPartialThinking, hasPartialAnswer);
  const rawReasoningFallback = !isUser && !hasExplicitThinkingPattern
    ? sanitizeRawReasoningContent(message.content)
    : null;
  const displayAnswer = rawReasoningFallback !== null
    ? rawReasoningFallback
    : answer;

  return (
    <div className={`message-bubble ${isUser ? "user-message" : "assistant-message"} ${streaming ? "streaming" : ""}`}>
      {!isUser && (
        <div className="message-avatar">
          <div className="avatar-circle">AI</div>
        </div>
      )}
      <div className="message-content-wrapper">
        <div className="message-content">
          {/* 显示回答（带代码高亮） */}
          {displayAnswer && (
            <div className="answer-section">
              <MessageContent content={displayAnswer} streaming={streaming} />
            </div>
          )}

          {streaming && (
            <span className="typing-indicator">
              <span className="cursor">▊</span>
            </span>
          )}
        </div>
      </div>
      {isUser && (
        <div className="message-avatar">
          <div className="avatar-circle user">你</div>
        </div>
      )}
    </div>
  );
}, arePropsEqual);
