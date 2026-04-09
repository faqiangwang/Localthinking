// src/components/shared/Input.tsx
// 通用输入框组件

import { InputHTMLAttributes, forwardRef, useState } from 'react';
import styles from './Input.module.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      fullWidth = false,
      className = '',
      disabled,
      ...props
    },
    ref
  ) => {
    const [focused, setFocused] = useState(false);

    return (
      <div
        className={`${styles.container} ${fullWidth ? styles.fullWidth : ''} ${
          focused ? styles.focused : ''
        } ${error ? styles.error : ''} ${disabled ? styles.disabled : ''}`}
      >
        {label && <label className={styles.label}>{label}</label>}

        <input
          ref={ref}
          disabled={disabled}
          className={`${styles.input} ${className}`}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          {...props}
        />

        {error && <span className={styles.errorText}>{error}</span>}
        {helperText && !error && <span className={styles.helperText}>{helperText}</span>}
      </div>
    );
  }
);

Input.displayName = 'Input';
