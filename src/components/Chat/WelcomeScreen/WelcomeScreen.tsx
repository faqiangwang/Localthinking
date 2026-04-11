// src/components/Chat/WelcomeScreen/WelcomeScreen.tsx
// 欢迎界面组件

import { ModelParams } from '../../../types';
import styles from './WelcomeScreen.module.css';

interface WelcomeScreenProps {
  modelLoaded: boolean;
  modelParams: ModelParams;
}

export function WelcomeScreen({ modelLoaded, modelParams }: WelcomeScreenProps) {
  return (
    <div className={styles.welcomeMessage}>
      <h3>欢迎使用 Local thinking</h3>
      <p>选择一个会话开始对话，或创建新对话</p>

      {!modelLoaded && (
        <div className={styles.modelWarning}>
          <p>⚠️ 还未加载模型</p>
          <p>请前往「模型」页面加载模型后再开始对话</p>
        </div>
      )}

      <div className={styles.modelParamsHint}>
        <span>当前参数：</span>
        <span>Temperature: {modelParams.temperature}</span>
        <span>Top-P: {modelParams.top_p}</span>
        <span>Max Tokens: {modelParams.max_tokens}</span>
        <span>Context: {modelParams.ctx_size}</span>
        <span>Repeat Penalty: {modelParams.repeat_penalty}</span>
      </div>
    </div>
  );
}
