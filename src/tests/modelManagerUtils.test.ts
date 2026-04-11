import { describe, expect, it } from 'vitest';
import {
  createScannedLocalModelEntry,
  extractRepoIdFromDownloadUrl,
  isMissingModelFileError,
} from '../components/modelManagerUtils';

describe('modelManagerUtils', () => {
  it('应从下载地址中解析 repoId 和文件名', () => {
    expect(
      extractRepoIdFromDownloadUrl(
        'https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/model.gguf'
      )
    ).toEqual({
      repoId: 'Qwen/Qwen2.5-7B-Instruct-GGUF',
      filename: 'model.gguf',
    });
  });

  it('无法解析的地址返回 null', () => {
    expect(extractRepoIdFromDownloadUrl('not-a-url')).toBeNull();
    expect(extractRepoIdFromDownloadUrl('https://example.com/file.gguf')).toBeNull();
  });

  it('应识别缺失文件错误', () => {
    expect(isMissingModelFileError('文件不存在')).toBe(true);
    expect(isMissingModelFileError('No such file or directory')).toBe(true);
    expect(isMissingModelFileError('下载失败')).toBe(false);
  });

  it('应将扫描结果转换为本地模型条目', () => {
    const entry = createScannedLocalModelEntry({
      name: 'demo.gguf',
      path: '/tmp/demo.gguf',
      size_gb: 1.23,
      parameters: '7B',
    });

    expect(entry.name).toBe('demo.gguf');
    expect(entry.path).toBe('/tmp/demo.gguf');
    expect(entry.size).toBe('1.23 GB');
    expect(entry.id).toBeTruthy();
  });
});
