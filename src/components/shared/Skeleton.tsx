// src/components/shared/Skeleton.tsx
// 骨架屏组件

import { HTMLAttributes } from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave';
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  animation = 'pulse',
  className = '',
  ...props
}: SkeletonProps) {
  const style = {
    width,
    height,
  };

  return (
    <div
      className={`${styles.skeleton} ${styles[variant]} ${styles[animation]} ${className}`}
      style={style}
      {...props}
    />
  );
}

// 骨架屏文本行组件
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`${styles.textContainer} ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} variant="text" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

// 骨架屏列表项组件
export function SkeletonListItem({ className = '' }: { className?: string }) {
  return (
    <div className={`${styles.listItem} ${className}`}>
      <Skeleton variant="circular" width={40} height={40} />
      <div style={{ flex: 1, gap: '8px', display: 'flex', flexDirection: 'column' }}>
        <Skeleton variant="text" height={16} />
        <Skeleton variant="text" height={14} style={{ width: '60%' }} />
      </div>
    </div>
  );
}
