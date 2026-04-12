// src/components/MessageBubble.tsx
import { Message } from "../types";
import { memo, useState, useEffect, useRef } from "react";
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

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// 解析思考过程和回答
function parseContent(content: string, hasPartialThinking: boolean, hasPartialAnswer: boolean) {
  let thinking = null;
  let answer = content;
  const pattern = THINKING_BLOCK_PATTERNS.find(
    candidate =>
      content.match(candidate.thinking) ||
      content.match(candidate.partialThinking) ||
      candidate.answerMarkers.some(marker => content.includes(marker))
  );

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
  } else if (pattern) {
    // 完整的思考过程和回答
    thinking = trimOrNull(thinkingMatch?.[1]);
    answer = trimOrNull(answerMatch?.[1]) || '';
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
  const [showThinking, setShowThinking] = useState(true);
  const [isThinkingComplete, setIsThinkingComplete] = useState(false);
  const prevContentRef = useRef(message.content);

  // 检测 thinking 是否已完成（检测到 </思考> 标签或"回答："标记）
  useEffect(() => {
    const hasThinkingEndTag =
      message.content.includes('</思考>') || message.content.toLowerCase().includes('</think>');
    const hadThinkingEndTag =
      prevContentRef.current.includes('</思考>') ||
      prevContentRef.current.toLowerCase().includes('</think>');
    const hasAnswerMarker =
      message.content.includes('回答：') ||
      message.content.includes('回答:') ||
      message.content.includes('<回答>');
    const hadAnswerMarker =
      prevContentRef.current.includes('回答：') ||
      prevContentRef.current.includes('回答:') ||
      prevContentRef.current.includes('<回答>');

    if ((hasThinkingEndTag && !hadThinkingEndTag) || (hasAnswerMarker && !hadAnswerMarker)) {
      setIsThinkingComplete(true);
    }

    prevContentRef.current = message.content;
  }, [message.content]);

  // 检测流式输出中是否正在生成 thinking
  const lowerContent = message.content.toLowerCase();
  const hasPartialThinking =
    !isThinkingComplete &&
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
  const { thinking, answer } = parseContent(message.content, hasPartialThinking, hasPartialAnswer);

  return (
    <div className={`message-bubble ${isUser ? "user-message" : "assistant-message"} ${streaming ? "streaming" : ""}`}>
      {!isUser && (
        <div className="message-avatar">
          <div className="avatar-circle">AI</div>
        </div>
      )}
      <div className="message-content-wrapper">
        <div className="message-content">
          {/* 显示思考过程 */}
          {(thinking || hasPartialThinking) && !isUser && (
            <div className="thinking-section">
              <div
                className="thinking-header"
                onClick={() => setShowThinking(!showThinking)}
              >
                <span className="thinking-icon">
                  {hasPartialThinking && streaming ? '⏳' : '💭'}
                </span>
                <span className="thinking-title">
                  {hasPartialThinking && streaming ? '正在思考...' : '思考过程'}
                </span>
                <span className={`thinking-toggle ${showThinking ? 'expanded' : 'collapsed'}`}>
                  {showThinking ? '▼' : '▶'}
                </span>
              </div>
              <div className={`thinking-content ${showThinking ? 'expanded' : 'collapsed'}`}>
                {thinking ? (
                  thinking.split('\n').map((line, i) => (
                    <p key={i}>{line || '\u00A0'}</p>
                  ))
                ) : hasPartialThinking ? (
                  <p>{'\u00A0'}</p>
                ) : null}
                {hasPartialThinking && streaming && (
                  <p className="thinking-streaming-cursor">▊</p>
                )}
              </div>
            </div>
          )}

          {/* 显示回答（带代码高亮） */}
          {answer && (
            <div className="answer-section">
              <MessageContent content={answer} streaming={streaming} />
            </div>
          )}

          {streaming && !hasPartialThinking && (
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
