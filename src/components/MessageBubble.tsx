// src/components/MessageBubble.tsx
import { Message } from "../types";
import { memo, useState, useEffect, useRef } from "react";
import { MessageContent } from "./MessageBubble/CodeHighlighter";

interface MessageBubbleProps {
  message: Message;
  streaming?: boolean;
}

// 解析思考过程和回答
function parseContent(content: string, hasPartialThinking: boolean, hasPartialAnswer: boolean) {
  const thinkingRegex = /<思考>([\s\S]*?)<\/思考>/;
  const answerRegex = /<回答>([\s\S]*?)<\/回答>/;

  let thinking = null;
  let answer = content;

  // 如果正在生成思考过程（流式输出）
  if (hasPartialThinking) {
    const thinkingStartRegex = /<思考>([\s\S]*)/;
    const partialMatch = content.match(thinkingStartRegex);
    if (partialMatch) {
      const contentText = partialMatch[1].trim();
      // 只有当有实际内容时才设置 thinking
      thinking = contentText || null;
    }
  } else if (hasPartialAnswer) {
    // 如果正在生成回答（流式输出）
    const thinkingMatch = content.match(thinkingRegex);
    const answerStartRegex = /<回答>([\s\S]*)/;
    const answerMatch = content.match(answerStartRegex);

    thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
    const answerText = answerMatch ? answerMatch[1].trim() : '';
    answer = answerText || content;
  } else {
    // 完整的思考过程和回答
    const thinkingMatch = content.match(thinkingRegex);
    const answerMatch = content.match(answerRegex);

    const thinkingText = thinkingMatch ? thinkingMatch[1].trim() : '';
    thinking = thinkingText || null;
    const answerText = answerMatch ? answerMatch[1].trim() : '';
    answer = answerText || content;
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

  // 检测 thinking 是否已完成（检测到 </思考> 标签）
  useEffect(() => {
    const hasThinkingEndTag = message.content.includes('</思考>');
    const hadThinkingEndTag = prevContentRef.current.includes('</思考>');

    if (hasThinkingEndTag && !hadThinkingEndTag) {
      setIsThinkingComplete(true);
    }

    prevContentRef.current = message.content;
  }, [message.content]);

  // 检测流式输出中是否正在生成 thinking
  const hasPartialThinking = !isThinkingComplete && message.content.includes('<思考>') && !message.content.includes('</思考>');

  // 检测流式输出中是否正在生成回答
  const hasPartialAnswer = message.content.includes('<回答>') && !message.content.includes('</回答>');

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
