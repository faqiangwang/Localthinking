// src/types/index.ts
// 统一的类型定义文件

// ============ 模型参数 ============
export interface ModelParams {
  temperature: number;   // 0.0 - 2.0
  top_p: number;        // 0.0 - 1.0
  max_tokens: number;   // 1 - 8192
  ctx_size: number;     // 512 - 8192
  repeat_penalty: number; // 1.0 - 2.0
}

// ============ 应用设置 ============
export interface AppSettings {
  model_params: ModelParams;
  system_prompt: string;
  api_enabled: boolean;
  api_port: number;
}

// ============ API 状态 ============
export interface ApiStatus {
  enabled: boolean;
  port: number;
  running: boolean;
  base_url: string;
}

// ============ 虚拟内存信息 ============
export interface VirtualMemoryInfo {
  total_physical_mb: number;
  available_physical_mb: number;
  current_paging_file_mb: number;
  paging_file_path: string;
  paging_enabled: boolean;
}

// ============ 虚拟内存设置结果 ============
export interface VirtualMemorySetResult {
  success: boolean;
  message: string;
  requires_restart: boolean;
}

// ============ 系统信息 ============
export interface SystemInfo {
  n_threads: number;
  physical_cores: number;
  logical_cores: number;
  ctx_size: number;
  gpu_acceleration: boolean;
}

// ============ 聊天消息 ============
export interface Message {
  id?: string; // 可选的唯一 ID，用于 React key
  role: "user" | "assistant" | "system";
  content: string;
}

// ============ 下载进度 ============
export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

// ============ 下载结果 ============
export interface DownloadResult {
  success: boolean;
  path?: string;
  error?: string;
}

// ============ 模型信息 ============
export interface ModelInfo {
  name: string;
  path: string;
  size_gb: number;
  parameters: string;
}

// ============ 硬件信息 ============
export interface HardwareInfo {
  total_ram_gb:     number;
  available_ram_gb: number;
  cpu_brand:        string;
  cpu_cores:        number;
  has_avx2:         boolean;
  has_avx512:       boolean;
  os:               string;
}

// ============ 模型推荐 ============
export interface ModelRecommendation {
  name:         string;
  filename:     string;
  size_gb:      number;
  quant:        string;
  params:       string;
  tier:         "Best" | "Good" | "Marginal" | "TooLarge";
  reason:       string;
  speed_note:   string;
  download_url: string;
  is_draft:     boolean;
}

// ============ 模型推荐响应 ============
export interface ModelRecommendationResponse {
  hardware:        HardwareInfo;
  recommendations: ModelRecommendation[];
}

// ============ 会话信息 ============
export interface ChatSession {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// ============ 常量定义 ============
export const DEFAULT_MODEL_PARAMS: ModelParams = {
  temperature: 0.7,
  top_p: 0.9,
  max_tokens: 2048,
  ctx_size: 2048,
  repeat_penalty: 1.1,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  model_params: DEFAULT_MODEL_PARAMS,
  system_prompt: `你是一个AI助手。回答每个问题时，都要先写出思考过程，再写出最终答案。

格式要求：
思考：你的思考过程
回答：你的最终答案

示例：
思考：用户问的是关于递归的问题。我需要解释什么是递归，然后给出一个例子。
回答：递归是一种编程技巧...

重要：每次回答都必须包含"思考："和"回答："两部分！`,
  api_enabled: true,
  api_port: 8080,
};

// API 配置常量
export const API_CONFIG = {
  DEFAULT_PORT: 8080,
  MIN_PORT: 1024,
  MAX_PORT: 65535,
} as const;

// 模型参数范围常量
export const PARAM_RANGES = {
  temperature: { min: 0, max: 200, step: 1 },       // 0.0 - 2.0
  top_p: { min: 0, max: 100, step: 1 },             // 0.0 - 1.0
  repeat_penalty: { min: 100, max: 200, step: 1 }, // 1.0 - 2.0
  max_tokens: { min: 128, max: 8192, step: 128 },
  ctx_size: { min: 512, max: 8192, step: 256 },
} as const;

// localStorage keys
export const STORAGE_KEYS = {
  SETTINGS: "localmind_settings",
  CUSTOM_MODELS: "localmind_custom_models",
  SESSIONS: "localmind_sessions",
  ACTIVE_SESSION: "localmind_active_session",
} as const;

// 虚拟内存默认值常量 (单位: MB)
export const VIRTUAL_MEMORY_DEFAULTS = {
  INITIAL_SIZE_MB: 8192,   // 初始分页文件大小 8GB
  MAX_SIZE_MB: 16384,      // 最大分页文件大小 16GB
  MIN_INITIAL_SIZE_MB: 4096, // 最小初始大小 4GB
} as const;

// ============ JSON 验证工具函数 ============

/**
 * 验证 AppSettings 对象结构
 */
export function isValidAppSettings(obj: unknown): obj is AppSettings {
  if (typeof obj !== "object" || obj === null) return false;
  const s = obj as Record<string, unknown>;

  // 验证 model_params
  if (!isValidModelParams(s.model_params)) return false;

  // 验证基本字段
  if (typeof s.system_prompt !== "string") return false;
  if (typeof s.api_enabled !== "boolean") return false;
  if (typeof s.api_port !== "number") return false;

  return true;
}

/**
 * 验证 ModelParams 对象结构
 */
export function isValidModelParams(obj: unknown): obj is ModelParams {
  if (typeof obj !== "object" || obj === null) return false;
  const s = obj as Record<string, unknown>;

  if (typeof s.temperature !== "number") return false;
  if (typeof s.top_p !== "number") return false;
  if (typeof s.max_tokens !== "number") return false;
  if (typeof s.ctx_size !== "number") return false;
  if (typeof s.repeat_penalty !== "number") return false;

  return true;
}

/**
 * 验证 ChatSession 对象结构
 */
export function isValidChatSession(obj: unknown): obj is ChatSession {
  if (typeof obj !== "object" || obj === null) return false;
  const s = obj as Record<string, unknown>;

  if (typeof s.id !== "string") return false;
  if (typeof s.name !== "string") return false;
  if (!Array.isArray(s.messages)) return false;
  if (typeof s.createdAt !== "number") return false;
  if (typeof s.updatedAt !== "number") return false;

  // 验证每条消息
  for (const msg of s.messages) {
    if (!isValidMessage(msg)) return false;
  }

  return true;
}

/**
 * 验证 Message 对象结构
 */
export function isValidMessage(obj: unknown): obj is Message {
  if (typeof obj !== "object" || obj === null) return false;
  const s = obj as Record<string, unknown>;

  if (typeof s.role !== "string") return false;
  if (!["user", "assistant", "system"].includes(s.role)) return false;
  if (typeof s.content !== "string") return false;

  return true;
}

/**
 * 安全解析 JSON，返回默认值或抛出有意义的错误
 */
export function safeParseJSON<T>(
  json: string,
  validator: (obj: unknown) => obj is T,
  fallback: T
): T {
  try {
    const parsed = JSON.parse(json);
    if (validator(parsed)) {
      return parsed;
    }
    return fallback;
  } catch (e) {
    return fallback;
  }
}
