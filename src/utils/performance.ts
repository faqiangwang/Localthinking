// src/utils/performance.ts
import { useCallback, useEffect, useRef } from 'react';

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

/**
 * 防抖 Hook - 延迟执行函数
 * @param fn 要执行的函数
 * @param delay 延迟时间（毫秒）
 * @returns 防抖后的函数
 */
export function useDebounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delay: number
): (...args: TArgs) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    []
  );

  return useCallback(
    (...args: TArgs) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        fn(...args);
      }, delay);
    },
    [fn, delay]
  );
}

/**
 * 节流 Hook - 限制函数执行频率
 * @param fn 要执行的函数
 * @param limit 限制时间（毫秒）
 * @returns 节流后的函数
 */
export function useThrottle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  limit: number
): (...args: TArgs) => void {
  const inThrottle = useRef(false);
  const lastArgs = useRef<TArgs | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    []
  );

  return useCallback(
    (...args: TArgs) => {
      if (!inThrottle.current) {
        fn(...args);
        inThrottle.current = true;
        timeoutRef.current = setTimeout(() => {
          inThrottle.current = false;
          if (lastArgs.current) {
            fn(...lastArgs.current);
            lastArgs.current = null;
          }
        }, limit);
      } else {
        lastArgs.current = args;
      }
    },
    [fn, limit]
  );
}

/**
 * 批处理 Hook - 批量执行函数以减少渲染次数
 * @param fn 要执行的函数
 * @param wait 等待时间（毫秒）
 * @returns 批处理后的函数
 */
export function useBatch<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  wait: number
): (...args: TArgs) => void {
  const argsQueue = useRef<TArgs[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    []
  );

  return useCallback(
    (...args: TArgs) => {
      argsQueue.current.push(args);

      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(() => {
          if (argsQueue.current.length > 0) {
            argsQueue.current.forEach(queuedArgs => {
              fn(...queuedArgs);
            });
            argsQueue.current = [];
          }
          timeoutRef.current = null;
        }, wait);
      }
    },
    [fn, wait]
  );
}

/**
 * 性能监控工具
 */
export class PerformanceMonitor {
  private static marks = new Map<string, number>();

  /**
   * 开始标记一个性能测量点
   * @param name 标记名称
   */
  static start(name: string) {
    this.marks.set(name, performance.now());
  }

  /**
   * 结束标记并返回耗时
   * @param name 标记名称
   * @returns 耗时（毫秒）
   */
  static end(name: string): number {
    const startTime = this.marks.get(name);
    if (startTime === undefined) {
      return 0;
    }

    const endTime = performance.now();
    const duration = endTime - startTime;
    this.marks.delete(name);

    return duration;
  }

  /**
   * 测量异步函数执行时间
   * @param name 标记名称
   * @param fn 异步函数
   * @returns 函数执行结果
   */
  static async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      return await fn();
    } finally {
      this.end(name);
    }
  }

  /**
   * 测量同步函数执行时间
   * @param name 标记名称
   * @param fn 同步函数
   * @returns 函数执行结果
   */
  static measureSync<T>(name: string, fn: () => T): T {
    this.start(name);
    try {
      return fn();
    } finally {
      this.end(name);
    }
  }
}

/**
 * 内存使用监控（仅在支持的环境中工作）
 */
export function getMemoryUsage(): {
  used: number;
  total: number;
  limit?: number;
} | null {
  const performanceWithMemory = performance as PerformanceWithMemory;

  if (performanceWithMemory.memory) {
    const memory = performanceWithMemory.memory;
    return {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
      limit: memory.jsHeapSizeLimit,
    };
  }
  return null;
}

/**
 * 检测设备性能等级
 * @returns 'low' | 'medium' | 'high'
 */
export function getDevicePerformance(): 'low' | 'medium' | 'high' {
  const cores = navigator.hardwareConcurrency || 2;

  const memory = (navigator as NavigatorWithDeviceMemory).deviceMemory || 4;

  if (cores <= 2 || memory <= 2) {
    return 'low';
  } else if (cores <= 4 || memory <= 4) {
    return 'medium';
  } else {
    return 'high';
  }
}
