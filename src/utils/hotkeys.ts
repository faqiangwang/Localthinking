// src/utils/hotkeys.ts
// 快捷键系统

type HotkeyCallback = (e: KeyboardEvent) => void;

interface HotkeyConfig {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  callback: HotkeyCallback;
  description?: string;
}

class HotkeyManager {
  private hotkeys: HotkeyConfig[] = [];

  /**
   * 注册快捷键
   */
  register(config: HotkeyConfig): () => void {
    this.hotkeys.push(config);

    // 返回注销函数
    return () => {
      this.hotkeys = this.hotkeys.filter((h) => h !== config);
    };
  }

  /**
   * 处理键盘事件
   */
  handle(e: KeyboardEvent): void {
    for (const hotkey of this.hotkeys) {
      const match =
        hotkey.key.toLowerCase() === e.key.toLowerCase() &&
        (hotkey.ctrlKey === undefined || hotkey.ctrlKey === e.ctrlKey) &&
        (hotkey.shiftKey === undefined || hotkey.shiftKey === e.shiftKey) &&
        (hotkey.altKey === undefined || hotkey.altKey === e.altKey) &&
        (hotkey.metaKey === undefined || hotkey.metaKey === e.metaKey);

      if (match) {
        e.preventDefault();
        hotkey.callback(e);
        break;
      }
    }
  }

  /**
   * 获取所有已注册的快捷键
   */
  getHotkeys(): HotkeyConfig[] {
    return [...this.hotkeys];
  }
}

// 创建全局快捷键管理器实例
export const hotkeyManager = new HotkeyManager();

// 在全局注册键盘事件监听器
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    hotkeyManager.handle(e);
  });
}

// 便捷函数：注册快捷键
export function registerHotkey(config: HotkeyConfig): () => void {
  return hotkeyManager.register(config);
}

// 常用快捷键预设
export const HOTKEYS = {
  SAVE: { key: 's', ctrlKey: true, description: '保存' },
  NEW_CHAT: { key: 'n', ctrlKey: true, description: '新建对话' },
  TOGGLE_THEME: { key: 'd', ctrlKey: true, description: '切换主题' },
  SEARCH: { key: 'f', ctrlKey: true, description: '搜索' },
  DELETE: { key: 'Delete', description: '删除' },
  ESCAPE: { key: 'Escape', description: '取消/关闭' },
} as const;
