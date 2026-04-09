// src/utils/storage.ts
// localStorage 统一封装

class StorageManager {
  private prefix = 'localmind_';

  /**
   * 从 localStorage 获取数据
   */
  get<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(`${this.prefix}${key}`);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  /**
   * 向 localStorage 设置数据
   */
  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(`${this.prefix}${key}`, JSON.stringify(value));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
    }
  }

  /**
   * 从 localStorage 删除数据
   */
  remove(key: string): void {
    try {
      localStorage.removeItem(`${this.prefix}${key}`);
    } catch (error) {
      console.error('Failed to remove from localStorage:', error);
    }
  }

  /**
   * 清空所有 Local thinking 相关的数据
   */
  clear(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (key.startsWith(this.prefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error('Failed to clear localStorage:', error);
    }
  }

  /**
   * 检查某个 key 是否存在
   */
  has(key: string): boolean {
    return localStorage.getItem(`${this.prefix}${key}`) !== null;
  }
}

export const storage = new StorageManager();

// 预定义的 storage keys
export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  CUSTOM_MODELS: 'custom_models',
  SESSIONS: 'sessions',
  ACTIVE_SESSION: 'active_session',
  THEME: 'theme',
} as const;
