// src/utils/performance.ts
import { useCallback, useRef } from "react";

/**
 * 防抖 Hook - 延迟执行函数
 * @param fn 要执行的函数
 * @param delay 延迟时间（毫秒）
 * @returns 防抖后的函数
 */
export function useDebounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    (...args: Parameters<T>) => {
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
export function useThrottle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  const inThrottle = useRef(false);
  const lastArgs = useRef<Parameters<T> | null>(null);

  return useCallback(
    (...args: Parameters<T>) => {
      if (!inThrottle.current) {
        fn(...args);
        inThrottle.current = true;
        setTimeout(() => {
          inThrottle.current = false;
          // 如果在节流期间有新的调用，执行最后一次
          if (lastArgs.current) {
            fn(...lastArgs.current);
            lastArgs.current = null;
          }
        }, limit);
      } else {
        // 保存最后一次调用的参数
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
export function useBatch<T extends (...args: any[]) => any>(
  fn: T,
  wait: number
): (...args: Parameters<T>) => void {
  const argsQueue = useRef<Parameters<T>[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    (...args: Parameters<T>) => {
      argsQueue.current.push(args);

      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(() => {
          // 批量执行所有排队的调用
          if (argsQueue.current.length > 0) {
            argsQueue.current.forEach((queuedArgs) => {
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
  static async measure<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T> {
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
  if ('memory' in performance && (performance as any).memory) {
    const memory = (performance as any).memory;
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
  // 基于硬件并发数判断
  const cores = navigator.hardwareConcurrency || 2;

  // 基于内存判断（如果可用）
  const memory = (navigator as any).deviceMemory || 4; // GB

  if (cores <= 2 || memory <= 2) {
    return 'low';
  } else if (cores <= 4 || memory <= 4) {
    return 'medium';
  } else {
    return 'high';
  }
}
