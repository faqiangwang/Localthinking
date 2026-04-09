// src/components/ModelManager.tsx - 简洁专业风格，带完善错误提示
import { useState, useEffect } from "react";
import { useModel } from "../hooks/useModel";
import { useDownload } from "../hooks/useDownload";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { STORAGE_KEYS } from "../types";
import { DownloadProgress } from "./DownloadProgress";
import { ModelRecommender } from "./ModelRecommender";
import styles from "./ModelManager.module.css";

interface ModelOption {
  name: string;
  repoId: string;
  filename: string;
  size: string;
  description: string;
}

interface CustomModel {
  id: string;
  name: string;
  path: string;
  size: string;
}

interface ErrorInfo {
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
  details?: string;
}

function isValidCustomModel(obj: unknown): obj is CustomModel {
  if (typeof obj !== "object" || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return typeof s.id === "string" && typeof s.name === "string" &&
         typeof s.path === "string" && typeof s.size === "string";
}

function extractFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

// 解析错误消息，提取关键信息
function parseErrorMessage(error: string): ErrorInfo {
  const lowerError = error.toLowerCase();

  // 模型文件不存在
  if (lowerError.includes("不存在") || lowerError.includes("not exist") || lowerError.includes("no such file")) {
    return {
      type: "error",
      title: "模型文件不存在",
      message: "指定的模型文件未找到",
      details: error
    };
  }

  // 内存不足
  if (lowerError.includes("内存") || lowerError.includes("memory") || lowerError.includes("oom")) {
    return {
      type: "error",
      title: "内存不足",
      message: "系统内存不足以加载此模型",
      details: "建议：关闭其他程序、减少线程数、或使用更小的模型"
    };
  }

  // 网络超时
  if (lowerError.includes("超时") || lowerError.includes("timeout")) {
    return {
      type: "error",
      title: "下载超时",
      message: "网络连接超时，下载失败",
      details: "建议：检查网络连接、稍后重试、或使用代理"
    };
  }

  // 无法连接
  if (lowerError.includes("连接") || lowerError.includes("connect")) {
    return {
      type: "error",
      title: "无法连接服务器",
      message: "无法连接到下载服务器",
      details: "建议：检查网络连接、稍后重试"
    };
  }

  // 模型加载失败
  if (lowerError.includes("加载失败") || lowerError.includes("failed to load") || lowerError.includes("load error")) {
    return {
      type: "error",
      title: "模型加载失败",
      message: "模型文件无法正常加载",
      details: error
    };
  }

  // 服务器错误
  if (lowerError.includes("服务器") || lowerError.includes("server") || lowerError.includes("404") || lowerError.includes("403")) {
    return {
      type: "error",
      title: "服务器错误",
      message: "下载服务器返回错误",
      details: "建议：稍后重试、或手动下载模型"
    };
  }

  // 磁盘空间不足
  if (lowerError.includes("磁盘") || lowerError.includes("space") || lowerError.includes("disk")) {
    return {
      type: "error",
      title: "磁盘空间不足",
      message: "存储空间不足以保存模型文件",
      details: "建议：清理磁盘空间"
    };
  }

  // 默认错误
  return {
    type: "error",
    title: "操作失败",
    message: error.split("\n")[0],
    details: error
  };
}

const RECOMMENDED_MODELS: ModelOption[] = [
  {
    name: "Qwen2.5-0.5B (Q4)",
    repoId: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    filename: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    size: "350 MB",
    description: "超轻量，快速响应",
  },
  {
    name: "Qwen2.5-1.5B (Q4)",
    repoId: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
    filename: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    size: "990 MB",
    description: "轻量级，中文优化",
  },
  {
    name: "Qwen2.5-7B-Instruct (Q4)",
    repoId: "Qwen/Qwen2.5-7B-Instruct-GGUF",
    filename: "qwen2.5-7b-instruct-q4_k_m.gguf",
    size: "4.4 GB",
    description: "通用对话，中文优化",
  },
  {
    name: "Qwen2.5-Coder-7B (Q4)",
    repoId: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    filename: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    size: "4.4 GB",
    description: "代码生成专用",
  },
  {
    name: "DeepSeek-R1-Distill-Qwen-8B (Q4)",
    repoId: "bartowski/DeepSeek-R1-Distill-Qwen-8B-GGUF",
    filename: "DeepSeek-R1-Distill-Qwen-8B-Q4_K_M.gguf",
    size: "4.9 GB",
    description: "逻辑推理强（推荐）",
  },
  {
    name: "DeepSeek-R1-Distill-Llama-8B (Q4)",
    repoId: "bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF",
    filename: "DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf",
    size: "5.0 GB",
    description: "英文推理强",
  },
  {
    name: "Gemma-2-2B (Q4)",
    repoId: "bartowski/gemma-2-2b-it-GGUF",
    filename: "gemma-2-2b-it-Q4_K_M.gguf",
    size: "1.5 GB",
    description: "轻量快速",
  },
];

export function ModelManager() {
  const { modelLoaded, modelPath, loading: modelLoading, loadModel } = useModel();
  const { progress, downloading, downloadModel, formatBytes } = useDownload();
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [activeTab, setActiveTab] = useState<"recommended" | "custom" | "smart">("smart");
  const [downloadingModelName, setDownloadingModelName] = useState<string | null>(null);
  const [notification, setNotification] = useState<ErrorInfo | null>(null);

  // 自动清除通知
  useEffect(() => {
    if (notification && notification.type !== "error") {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // 加载自定义模型列表
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CUSTOM_MODELS);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setCustomModels(parsed.filter(isValidCustomModel));
        }
      } catch (e) {
        console.warn("加载自定义模型失败:", e);
      }
    }
  }, []);

  // 显示下载成功消息
  const showSuccess = (message: string) => {
    setNotification({ type: "success", title: "成功", message });
  };

  // 显示错误消息
  const showError = (error: string) => {
    const parsed = parseErrorMessage(error);
    setNotification(parsed);
  };

  // 清除错误
  const clearError = () => {
    setNotification(null);
  };

  const handleDownload = async (model: ModelOption) => {
    console.log('[下载] 点击下载按钮:', model);
    clearError();
    setDownloadingModelName(model.name);

    const result = await downloadModel(model.repoId, model.filename);

    setDownloadingModelName(null);

    if (result.success && result.path) {
      const fileName = extractFileName(result.path);
      if (!customModels.some((m) => m.path === result.path)) {
        const newModel: CustomModel = {
          id: Date.now().toString(),
          name: fileName,
          path: result.path,
          size: model.size,
        };
        const updatedModels = [...customModels, newModel];
        setCustomModels(updatedModels);
        localStorage.setItem(STORAGE_KEYS.CUSTOM_MODELS, JSON.stringify(updatedModels));
      }
      showSuccess(`"${model.name}" 下载完成`);
      setActiveTab("custom");
    }
  };

  const handleBrowseModel = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "GGUF Model", extensions: ["gguf"] }],
      });

      if (selected && typeof selected === "string") {
        if (customModels.some((m) => m.path === selected)) {
          showError("此模型已在列表中");
          return;
        }
        const newModel: CustomModel = {
          id: Date.now().toString(),
          name: extractFileName(selected),
          path: selected,
          size: "未知",
        };
        const updatedModels = [...customModels, newModel];
        setCustomModels(updatedModels);
        localStorage.setItem(STORAGE_KEYS.CUSTOM_MODELS, JSON.stringify(updatedModels));
        showSuccess("模型已添加");
      }
    } catch (e) {
      console.error("选择文件失败:", e);
    }
  };

  const handleLoadCustomModel = async (model: CustomModel) => {
    clearError();
    await loadModel(model.path);
  };

  const handleRemoveCustomModel = async (id: string) => {
    const model = customModels.find(m => m.id === id);
    if (!model) return;

    // 如果正在使用此模型，不允许删除
    if (modelPath === model.path) {
      showError("无法删除正在使用的模型，请先切换到其他模型");
      return;
    }

    try {
      // 调用后端删除文件
      await invoke("delete_model_file", { filePath: model.path });

      // 从列表中移除
      const updatedModels = customModels.filter((m) => m.id !== id);
      setCustomModels(updatedModels);
      localStorage.setItem(STORAGE_KEYS.CUSTOM_MODELS, JSON.stringify(updatedModels));

      showSuccess(`"${model.name}" 已删除`);
    } catch (e) {
      showError(String(e));
    }
  };

  const handleScanModels = async () => {
    clearError();
    try {
      const scanned = await invoke<any[]>("scan_models");

      if (scanned.length === 0) {
        setNotification({
          type: "info",
          title: "扫描完成",
          message: "未找到模型文件",
          details: "请将 GGUF 模型文件放在以下目录：\n- 用户目录/LocalMind/models/\n- 下载目录/\n- 文档目录/LocalMind/models/"
        });
        return;
      }

      let addedCount = 0;
      const updatedModels = [...customModels];

      for (const model of scanned) {
        // 检查是否已存在
        if (!customModels.some((m) => m.path === model.path)) {
          updatedModels.push({
            id: Date.now().toString() + Math.random(),
            name: model.name,
            path: model.path,
            size: model.size_gb > 0 ? `${model.size_gb.toFixed(2)} GB` : "未知",
          });
          addedCount++;
        }
      }

      if (addedCount > 0) {
        setCustomModels(updatedModels);
        localStorage.setItem(STORAGE_KEYS.CUSTOM_MODELS, JSON.stringify(updatedModels));
        showSuccess(`扫描完成，新增 ${addedCount} 个模型`);
      } else {
        setNotification({
          type: "info",
          title: "扫描完成",
          message: "未发现新模型",
          details: `已找到 ${scanned.length} 个模型，但都在列表中`
        });
      }
    } catch (e) {
      showError(String(e));
    }
  };

  // 监听模型加载状态变化
  useEffect(() => {
    if (modelLoaded && !modelLoading) {
      // 模型加载成功
    }
  }, [modelLoaded, modelLoading]);

  return (
    <div className={styles.modelManagerSimple}>
      {/* 标题区 */}
      <div className={styles.modelTitleRow}>
        <h2>模型管理</h2>
        <span className={`${styles.modelStatusTag} ${modelLoaded ? styles.loaded : ""}`}>
          {modelLoaded ? "已加载" : "未加载"}
        </span>
      </div>

      {/* 下载进度 */}
      {downloading && progress && (
        <DownloadProgress progress={progress} formatBytes={formatBytes} />
      )}

      {/* 通知消息 */}
      {notification && (
        <div className={`${styles.notification} ${styles[`notification${notification.type.charAt(0).toUpperCase() + notification.type.slice(1)}`]}`}>
          <div className={styles.notificationContent}>
            <div className={styles.notificationTitle}>{notification.title}</div>
            <div className={styles.notificationMessage}>{notification.message}</div>
            {notification.details && (
              <div className={styles.notificationDetails}>{notification.details}</div>
            )}
          </div>
          <button className={styles.notificationClose} onClick={clearError}>x</button>
        </div>
      )}

      {/* 标签切换 */}
      <div className={styles.modelTabBar}>
        <button
          className={activeTab === "smart" ? styles.active : ""}
          onClick={() => { setActiveTab("smart"); clearError(); }}
        >
          智能推荐
        </button>
        <button
          className={activeTab === "recommended" ? styles.active : ""}
          onClick={() => { setActiveTab("recommended"); clearError(); }}
        >
          推荐下载
        </button>
        <button
          className={activeTab === "custom" ? styles.active : ""}
          onClick={() => { setActiveTab("custom"); clearError(); }}
        >
          本地模型 ({customModels.length})
        </button>
      </div>

      {/* 智能推荐 */}
      {activeTab === "smart" && (
        <div className={styles.modelContent}>
          <ModelRecommender onSelect={async (model: any) => {
            clearError();
            setDownloadingModelName(model.name);
            try {
              const url = model.download_url;
              const urlParts = url.split('/');
              const filename = urlParts[urlParts.length - 1];
              let repoId = "";
              if (url.includes("/Qwen/")) repoId = url.match(/\/Qwen\/[^/]+/)?.[0]?.substring(1) || "";
              else if (url.includes("/bartowski/")) repoId = url.match(/\/bartowski\/[^/]+/)?.[0]?.substring(1) || "";
              else if (url.includes("/deepseek-ai/")) repoId = url.match(/\/deepseek-ai\/[^/]+/)?.[0]?.substring(1) || "";

              if (repoId && filename) {
                const result = await downloadModel(repoId, filename);
                if (result.success && result.path) {
                  const fileName = extractFileName(result.path);
                  if (!customModels.some((m) => m.path === result.path)) {
                    const newModel: CustomModel = {
                      id: Date.now().toString(),
                      name: fileName,
                      path: result.path,
                      size: `${model.size_gb.toFixed(1)} GB`,
                    };
                    const updatedModels = [...customModels, newModel];
                    setCustomModels(updatedModels);
                    localStorage.setItem(STORAGE_KEYS.CUSTOM_MODELS, JSON.stringify(updatedModels));
                  }
                  showSuccess(`"${model.name}" 下载完成`);
                  setActiveTab("custom");
                } else if (result.error) {
                  showError(result.error);
                }
              }
            } catch (error) {
              showError(String(error));
            } finally {
              setDownloadingModelName(null);
            }
          }} />
        </div>
      )}

      {/* 推荐模型列表 */}
      {activeTab === "recommended" && (
        <div className={styles.modelContent}>
          <table className={styles.modelTable}>
            <thead>
              <tr>
                <th>模型名称</th>
                <th>大小</th>
                <th>描述</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {RECOMMENDED_MODELS.map((model) => (
                <tr key={model.filename}>
                  <td className={styles.modelNameCell}>{model.name}</td>
                  <td>{model.size}</td>
                  <td className={styles.modelDescCell}>{model.description}</td>
                  <td>
                    <button
                      className={styles.modelBtn}
                      onClick={() => {
                        console.log('[下载] 按钮被点击，当前状态:', { downloading, modelLoading });
                        handleDownload(model);
                      }}
                      disabled={downloading || modelLoading}
                      title={downloading ? "正在下载中..." : modelLoading ? "正在加载模型..." : "点击下载"}
                    >
                      {downloading && downloadingModelName === model.name ? "下载中..." : modelLoading ? "加载中..." : "下载"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 本地模型列表 */}
      {activeTab === "custom" && (
        <div className={styles.modelContent}>
          <div className={styles.modelToolbar}>
            <button className={`${styles.modelBtn} ${styles.add}`} onClick={handleBrowseModel}>
              + 添加本地模型
            </button>
            <button className={`${styles.modelBtn}`} onClick={handleScanModels}>
              🔍 扫描模型目录
            </button>
          </div>

          {customModels.length === 0 ? (
            <div className={styles.modelEmpty}>
              <p>暂无本地模型</p>
              <p className={styles.hint}>点击上方按钮添加 GGUF 模型文件</p>
            </div>
          ) : (
            <table className={styles.modelTable}>
              <thead>
                <tr>
                  <th>文件名称</th>
                  <th>大小</th>
                  <th>路径</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {customModels.map((model) => (
                  <tr key={model.id} className={modelPath === model.path ? styles.active : ""}>
                    <td className={styles.modelNameCell}>
                      {modelPath === model.path && <span className={styles.activeDot}></span>}
                      {model.name}
                    </td>
                    <td>{model.size}</td>
                    <td className={styles.modelPathCell} title={model.path}>
                      {model.path}
                    </td>
                    <td>
                      <button
                        className={`${styles.modelBtn} ${modelPath === model.path ? styles.loaded : ""}`}
                        onClick={() => handleLoadCustomModel(model)}
                        disabled={modelLoading}
                      >
                        {modelPath === model.path ? "已加载" : "加载"}
                      </button>
                      <button
                        className={`${styles.modelBtn} ${styles.remove}`}
                        onClick={() => handleRemoveCustomModel(model.id)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
