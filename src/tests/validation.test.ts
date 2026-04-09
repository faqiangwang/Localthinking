import { describe, it, expect } from 'vitest';
import {
  isValidAppSettings,
  isValidModelParams,
  isValidChatSession,
  isValidMessage,
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODEL_PARAMS,
} from '../types';

describe('类型验证函数', () => {
  describe('isValidMessage', () => {
    it('应该验证有效的消息', () => {
      const validMessage = { role: 'user', content: 'Hello' };
      expect(isValidMessage(validMessage)).toBe(true);
    });

    it('应该拒绝无效的 role', () => {
      const invalidMessage = { role: 'invalid', content: 'Hello' };
      expect(isValidMessage(invalidMessage)).toBe(false);
    });

    it('应该拒绝缺少 content 的消息', () => {
      const invalidMessage = { role: 'user' };
      expect(isValidMessage(invalidMessage)).toBe(false);
    });

    it('应该拒绝 null', () => {
      expect(isValidMessage(null)).toBe(false);
    });
  });

  describe('isValidModelParams', () => {
    it('应该验证有效的模型参数', () => {
      expect(isValidModelParams(DEFAULT_MODEL_PARAMS)).toBe(true);
    });

    it('应该拒绝缺少字段的参数', () => {
      const invalid = { temperature: 0.7 };
      expect(isValidModelParams(invalid)).toBe(false);
    });

    it('应该拒绝错误类型的参数', () => {
      const invalid = {
        temperature: '0.7', // 应该是 number
        top_p: 0.9,
        max_tokens: 2048,
        ctx_size: 2048,
        repeat_penalty: 1.1,
      };
      expect(isValidModelParams(invalid)).toBe(false);
    });
  });

  describe('isValidAppSettings', () => {
    it('应该验证有效的应用设置', () => {
      expect(isValidAppSettings(DEFAULT_APP_SETTINGS)).toBe(true);
    });

    it('应该拒绝缺少 model_params 的设置', () => {
      const invalid = {
        system_prompt: 'test',
        api_enabled: true,
        api_port: 8080,
      };
      expect(isValidAppSettings(invalid)).toBe(false);
    });

    it('应该拒绝 api_port 类型错误', () => {
      const invalid = {
        model_params: DEFAULT_MODEL_PARAMS,
        system_prompt: 'test',
        api_enabled: true,
        api_port: '8080', // 应该是 number
      };
      expect(isValidAppSettings(invalid)).toBe(false);
    });
  });

  describe('isValidChatSession', () => {
    it('应该验证有效的会话', () => {
      const validSession = {
        id: '123',
        name: 'Test Session',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      expect(isValidChatSession(validSession)).toBe(true);
    });

    it('应该拒绝缺少 id 的会话', () => {
      const invalid = {
        name: 'Test',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      expect(isValidChatSession(invalid)).toBe(false);
    });

    it('应该拒绝消息数组包含无效消息', () => {
      const invalid = {
        id: '123',
        name: 'Test',
        messages: [{ role: 'invalid', content: 'test' }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      expect(isValidChatSession(invalid)).toBe(false);
    });
  });
});
