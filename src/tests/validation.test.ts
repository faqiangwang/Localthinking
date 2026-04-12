import { describe, it, expect } from 'vitest';
import {
  isValidAppSettings,
  isValidModelParams,
  isValidChatSession,
  isValidMessage,
  DEFAULT_APP_SETTINGS,
  DEFAULT_MODEL_PARAMS,
  DEFAULT_SYSTEM_PROMPT,
  LEGACY_DEFAULT_MODEL_PARAMS,
  LEGACY_REASONING_SYSTEM_PROMPT,
  normalizeModelParams,
  normalizeAppSettings,
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

    it('应该拒绝不支持的 flash_attention 值', () => {
      const invalid = {
        model_params: DEFAULT_MODEL_PARAMS,
        system_prompt: 'test',
        flash_attention: 'invalid',
        api_enabled: true,
        api_port: 8080,
      };
      expect(isValidAppSettings(invalid)).toBe(false);
    });

    it('应该拒绝 api_port 类型错误', () => {
      const invalid = {
        model_params: DEFAULT_MODEL_PARAMS,
        system_prompt: 'test',
        flash_attention: 'auto',
        api_enabled: true,
        api_port: '8080', // 应该是 number
      };
      expect(isValidAppSettings(invalid)).toBe(false);
    });
  });

  describe('normalizeAppSettings', () => {
    it('应该将旧的强制思考提示迁移为新的默认提示', () => {
      const normalized = normalizeAppSettings({
        model_params: DEFAULT_MODEL_PARAMS,
        system_prompt: LEGACY_REASONING_SYSTEM_PROMPT,
        flash_attention: 'auto',
        api_enabled: true,
        api_port: 8080,
      });

      expect(normalized.system_prompt).toBe(DEFAULT_SYSTEM_PROMPT);
    });

    it('应该保留用户自定义的系统提示', () => {
      const normalized = normalizeAppSettings({
        model_params: DEFAULT_MODEL_PARAMS,
        system_prompt: '请用一句话回答。',
        flash_attention: 'off',
        api_enabled: true,
        api_port: 8080,
      });

      expect(normalized.system_prompt).toBe('请用一句话回答。');
      expect(normalized.flash_attention).toBe('off');
    });

    it('应该将缺失的 flash_attention 迁移为 auto', () => {
      const normalized = normalizeAppSettings({
        model_params: DEFAULT_MODEL_PARAMS,
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        api_enabled: true,
        api_port: 8080,
      });

      expect(normalized.flash_attention).toBe('auto');
    });
  });

  describe('normalizeModelParams', () => {
    it('应该将旧的默认参数迁移为新的吞吐优先默认值', () => {
      expect(normalizeModelParams(LEGACY_DEFAULT_MODEL_PARAMS)).toEqual(DEFAULT_MODEL_PARAMS);
    });

    it('应该保留用户自定义的模型参数', () => {
      const customParams = {
        ...LEGACY_DEFAULT_MODEL_PARAMS,
        max_tokens: 1024,
      };

      expect(normalizeModelParams(customParams)).toEqual(customParams);
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
