// eslint.config.js
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // 忽略文件
  { ignores: ['dist', 'node_modules', 'src-tauri/target'] },

  // JavaScript 规则
  js.configs.recommended,

  // TypeScript 规则
  ...tseslint.configs.recommended,

  // React Hooks 规则
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },

  // 项目特定规则
  {
    rules: {
      // 禁止 console 用于生产环境
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // 要求使用 const
      'prefer-const': 'error',
      // 禁止未使用的变量
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
