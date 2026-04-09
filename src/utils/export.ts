// src/utils/export.ts
// 消息导出功能

import { ChatSession } from '../types';

/**
 * 导出聊天记录为 Markdown 格式
 */
export function exportChatToMarkdown(session: ChatSession): string {
  let markdown = `# ${session.name}\n\n`;
  markdown += `导出时间: ${new Date().toLocaleString('zh-CN')}\n\n`;
  markdown += `---\n\n`;

  for (const message of session.messages) {
    if (message.role === 'system') continue;

    const roleName = message.role === 'user' ? '用户' : '助手';
    markdown += `## ${roleName}\n\n`;
    markdown += `${message.content}\n\n`;
    markdown += `---\n\n`;
  }

  return markdown;
}

/**
 * 导出聊天记录为 JSON 格式
 */
export function exportChatToJSON(session: ChatSession): string {
  return JSON.stringify(session, null, 2);
}

/**
 * 导出聊天记录为文本格式
 */
export function exportChatToText(session: ChatSession): string {
  let text = `${session.name}\n`;
  text += `${'='.repeat(50)}\n\n`;

  for (const message of session.messages) {
    if (message.role === 'system') continue;

    const roleName = message.role === 'user' ? '用户' : '助手';
    text += `[${roleName}]\n`;
    text += `${message.content}\n\n`;
  }

  return text;
}

/**
 * 触发文件下载
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 导出聊天会话
 */
export function exportSession(session: ChatSession, format: 'markdown' | 'json' | 'text'): void {
  let content: string;
  let filename: string;
  let mimeType: string;

  const timestamp = new Date().toISOString().slice(0, 10);

  switch (format) {
    case 'markdown':
      content = exportChatToMarkdown(session);
      filename = `${session.name}_${timestamp}.md`;
      mimeType = 'text/markdown';
      break;
    case 'json':
      content = exportChatToJSON(session);
      filename = `${session.name}_${timestamp}.json`;
      mimeType = 'application/json';
      break;
    case 'text':
      content = exportChatToText(session);
      filename = `${session.name}_${timestamp}.txt`;
      mimeType = 'text/plain';
      break;
  }

  downloadFile(content, filename, mimeType);
}
