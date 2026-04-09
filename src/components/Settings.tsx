// src/components/Settings.tsx - 重新设计的设置页面
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ModelParams,
  AppSettings,
  VirtualMemoryInfo,
  SystemInfo,
  DEFAULT_MODEL_PARAMS,
  DEFAULT_APP_SETTINGS,
  API_CONFIG,
  STORAGE_KEYS,
} from "../types";
import "./Settings.css";
import { PerformanceMonitor } from "./PerformanceMonitor";

// 版本号
const APP_VERSION = "0.1.0";

export function Settings() {
  // 状态
  const [threads, setThreadsLocal] = useState(4);
  const [params, setParams] = useState<ModelParams>(DEFAULT_MODEL_PARAMS);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_APP_SETTINGS.system_prompt);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // API 配置
  const [apiEnabled, setApiEnabled] = useState(DEFAULT_APP_SETTINGS.api_enabled);
  const [apiPort, setApiPort] = useState<number>(API_CONFIG.DEFAULT_PORT);

  // 系统信息（延迟加载）
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [sysInfoLoading, setSysInfoLoading] = useState(true);

  // 虚拟内存信息
  const [vmInfo, setVmInfo] = useState<VirtualMemoryInfo | null>(null);
  const [vmLoading, setVmLoading] = useState(false);
  const [vmMessage, setVmMessage] = useState<string | null>(null);

  // 加载保存的设置
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        if (settings.model_params) setParams({ ...DEFAULT_MODEL_PARAMS, ...settings.model_params });
        if (settings.system_prompt) setSystemPrompt(settings.system_prompt);
        if (settings.api_enabled !== undefined) setApiEnabled(settings.api_enabled);
        if (settings.api_port !== undefined) setApiPort(settings.api_port);
      } catch (e) {
        console.warn("加载设置失败:", e);
      }
    }
  }, []);

  // 异步加载系统信息
  useEffect(() => {
    const loadInfo = async () => {
      try {
        const info = await invoke<SystemInfo>("system_info");
        setSystemInfo(info);
        setThreadsLocal(info.n_threads);
      } catch (e) {
        console.warn("获取系统信息失败:", e);
      } finally {
        setSysInfoLoading(false);
      }
    };
    // 延迟加载，避免阻塞
    const timer = setTimeout(loadInfo, 800);
    return () => clearTimeout(timer);
  }, []);

  // 加载虚拟内存信息
  useEffect(() => {
    const loadVm = async () => {
      try {
        const info = await invoke<VirtualMemoryInfo>("get_virtual_memory_info");
        setVmInfo(info);
      } catch (e) {
        console.warn("获取虚拟内存信息失败:", e);
      }
    };
    const timer = setTimeout(loadVm, 1200);
    return () => clearTimeout(timer);
  }, []);

  // 保存设置
  const saveSettings = () => {
    const settings: AppSettings = {
      model_params: params,
      system_prompt: systemPrompt,
      api_enabled: apiEnabled,
      api_port: apiPort,
    };
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  };

  // 重置所有会话
  const resetAllSessions = () => {
    if (confirm('确定要删除所有会话吗？这将清除所有对话历史，但会保留你的设置。')) {
      localStorage.removeItem(STORAGE_KEYS.SESSIONS);
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_SESSION);
      window.location.reload();
    }
  };

  // 应用线程设置
  const applyThreads = async () => {
    try {
      await invoke("set_threads", { n: threads });
    } catch (e) {
      console.warn("设置线程失败:", e);
    }
  };

  // 启用/禁用 API
  const toggleApi = async () => {
    try {
      await invoke("set_api_enabled", { enabled: !apiEnabled });
      setApiEnabled(!apiEnabled);
      saveSettings();
    } catch (e) {
      console.warn("切换 API 失败:", e);
    }
  };

  // 设置虚拟内存
  const handleSetVm = async () => {
    setVmLoading(true);
    setVmMessage(null);
    try {
      await invoke("set_virtual_memory", {
        config: { initial_mb: 8192, maximum_mb: 16384 }
      });
      setVmMessage("虚拟内存已设置，需要重启电脑生效");
    } catch (e) {
      setVmMessage(String(e));
    } finally {
      setVmLoading(false);
    }
  };

  // 启用自动虚拟内存
  const handleEnableAutoVm = async () => {
    setVmLoading(true);
    setVmMessage(null);
    try {
      await invoke("enable_auto_virtual_memory");
      setVmMessage("已启用自动管理，需要重启电脑生效");
    } catch (e) {
      setVmMessage(String(e));
    } finally {
      setVmLoading(false);
    }
  };

  return (
    <div className="settings-container">
      <h2>⚙️ 设置</h2>

      {/* 系统信息卡片 */}
      <div className="settings-card">
        <h3>🖥️ 系统信息</h3>
        {sysInfoLoading ? (
          <div className="loading-placeholder">
            <span className="loading-spinner"></span>
            加载中...
          </div>
        ) : systemInfo ? (
          <div className="info-grid">
            <div className="info-box">
              <span className="info-label">CPU 线程</span>
              <span className="info-value">{systemInfo.n_threads}</span>
            </div>
            <div className="info-box">
              <span className="info-label">物理核心</span>
              <span className="info-value">{systemInfo.physical_cores}</span>
            </div>
            <div className="info-box">
              <span className="info-label">逻辑核心</span>
              <span className="info-value">{systemInfo.logical_cores}</span>
            </div>
            <div className="info-box">
              <span className="info-label">运行模式</span>
              <span className="info-value">{systemInfo.gpu_acceleration ? "GPU" : "CPU"}</span>
            </div>
          </div>
        ) : null}

        {vmInfo && (
          <div className="info-grid" style={{ marginTop: "12px" }}>
            <div className="info-box">
              <span className="info-label">物理内存</span>
              <span className="info-value">{(vmInfo.total_physical_mb / 1024).toFixed(1)} GB</span>
            </div>
            <div className="info-box">
              <span className="info-label">可用内存</span>
              <span className="info-value">{(vmInfo.available_physical_mb / 1024).toFixed(1)} GB</span>
            </div>
            <div className="info-box">
              <span className="info-label">页面文件</span>
              <span className="info-value">{vmInfo.paging_enabled ? "自动" : "手动"}</span>
            </div>
          </div>
        )}
      </div>

      {/* 线程设置卡片 */}
      <div className="settings-card">
        <h3>🔧 推理线程数</h3>
        <p className="hint">建议 2-4 核，线程越多速度越快但占用内存越高</p>
        <div className="slider-control">
          <input
            type="range"
            min={1}
            max={Math.min(systemInfo?.logical_cores ?? 8, 8)}
            value={threads}
            onChange={(e) => setThreadsLocal(parseInt(e.target.value))}
          />
          <span className="slider-badge">{threads} 核</span>
        </div>
        <button onClick={applyThreads} className="btn-primary">
          应用设置
        </button>
      </div>

      {/* 模型参数卡片 */}
      <div className="settings-card">
        <h3>📐 模型参数</h3>

        <div className="param-item">
          <div className="param-header">
            <span>Temperature (创造性)</span>
            <span className="param-value">{params.temperature.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={params.temperature * 100}
            onChange={(e) => setParams({ ...params, temperature: parseInt(e.target.value) / 100 })}
          />
          <div className="param-range">
            <span>确定</span>
            <span>创造</span>
          </div>
        </div>

        <div className="param-item">
          <div className="param-header">
            <span>Top-P (采样)</span>
            <span className="param-value">{params.top_p.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={params.top_p * 100}
            onChange={(e) => setParams({ ...params, top_p: parseInt(e.target.value) / 100 })}
          />
        </div>

        <div className="param-item">
          <div className="param-header">
            <span>Repeat Penalty</span>
            <span className="param-value">{params.repeat_penalty.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="100"
            max="150"
            value={params.repeat_penalty * 100}
            onChange={(e) => setParams({ ...params, repeat_penalty: parseInt(e.target.value) / 100 })}
          />
        </div>

        <div className="param-item">
          <div className="param-header">
            <span>Max Tokens</span>
            <span className="param-value">{params.max_tokens}</span>
          </div>
          <input
            type="range"
            min="32"
            max="2048"
            step="32"
            value={params.max_tokens}
            onChange={(e) => setParams({ ...params, max_tokens: parseInt(e.target.value) })}
          />
        </div>
      </div>

      {/* 虚拟内存卡片 */}
      <div className="settings-card">
        <h3>💾 虚拟内存</h3>
        <p className="hint">建议启用自动管理或设置为物理内存的 1-2 倍大小</p>
        <div className="vm-buttons">
          <button onClick={handleEnableAutoVm} className="btn-secondary" disabled={vmLoading}>
            {vmLoading ? "处理中..." : "启用自动管理"}
          </button>
          <button onClick={handleSetVm} className="btn-secondary" disabled={vmLoading}>
            {vmLoading ? "处理中..." : "推荐 8GB-16GB"}
          </button>
        </div>
        {vmMessage && (
          <div className="vm-message">{vmMessage}</div>
        )}
      </div>

      {/* 性能监控卡片 */}
      <div className="settings-card">
        <h3>⚡ 性能监控</h3>
        <PerformanceMonitor />
      </div>

      {/* 系统提示词卡片 */}
      <div className="settings-card">
        <h3>💬 系统提示词</h3>
        <p className="hint">定义 AI 助手的专业领域和回复风格</p>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="定义 AI 助手的角色..."
          rows={4}
        />

        {/* 预设分类 */}
        <div className="prompt-categories">
          {/* 通用类 */}
          <div className="prompt-category">
            <h4>🌟 通用助手</h4>
            <div className="preset-buttons">
              <button onClick={() => setSystemPrompt("你是一个友好、专业的 AI 助手。你善于倾听、理解用户需求，并提供准确、有用的回答。你的回答简洁明了，逻辑清晰。")}>全能助手</button>
              <button onClick={() => setSystemPrompt("你是一个专业的中文助手，擅长用简洁清晰的语言回答问题。你了解中国文化，能用中文进行流畅的对话。")}>中文助手</button>
              <button onClick={() => setSystemPrompt("你是一个英语学习伙伴。你帮助用户练习英语，纠正语法错误，并提供地道的表达方式。你的回答使用中英双语。")}>英语学习</button>
            </div>
          </div>

          {/* 技术类 */}
          <div className="prompt-category">
            <h4>💻 技术开发</h4>
            <div className="preset-buttons">
              <button onClick={() => setSystemPrompt("你是一个资深的编程专家，精通多种编程语言（Python、JavaScript、Rust、Go 等）。你提供高质量、可维护的代码示例，并解释最佳实践和设计模式。")}>全栈开发</button>
              <button onClick={() => setSystemPrompt("你是一个算法和数据结构专家。你擅长分析算法复杂度，优化代码性能，并提供清晰的解决方案和代码实现。")}>算法专家</button>
              <button onClick={() => setSystemPrompt("你是一个数据库专家，精通 SQL、NoSQL 和数据库设计。你帮助用户优化查询性能、设计合理的数据库架构。")}>数据库专家</button>
              <button onClick={() => setSystemPrompt("你是一个 DevOps 专家，擅长 CI/CD、容器化、云服务部署和系统运维。你提供实用的自动化解决方案。")}>DevOps</button>
            </div>
          </div>

          {/* 数据类 */}
          <div className="prompt-category">
            <h4>📊 数据科学</h4>
            <div className="preset-buttons">
              <button onClick={() => setSystemPrompt("你是一个数据科学家，精通 Python 数据分析（pandas、numpy）、机器学习和数据可视化。你帮助用户分析数据、建立模型和解读结果。")}>数据科学家</button>
              <button onClick={() => setSystemPrompt("你是一个商业智能分析师，擅长从数据中发现商业洞察。你帮助用户理解数据趋势、制作报表和提供决策建议。")}>商业分析</button>
            </div>
          </div>

          {/* 创作类 */}
          <div className="prompt-category">
            <h4>✍️ 内容创作</h4>
            <div className="preset-buttons">
              <button onClick={() => setSystemPrompt("你是一个专业的写作教练，擅长帮助用户改进文章结构、提升表达能力和优化语言风格。你提供具体的修改建议和写作技巧。")}>写作教练</button>
              <button onClick={() => setSystemPrompt("你是一个创意写作助手，擅长小说、诗歌、剧本等文学创作。你帮助用户构思情节、塑造角色和打磨文字。")}>创意写作</button>
              <button onClick={() => setSystemPrompt("你是一个专业的内容营销专家，擅长撰写吸引人的标题、文章和广告文案。你了解SEO优化和用户心理。")}>内容营销</button>
            </div>
          </div>

          {/* 商业类 */}
          <div className="prompt-category">
            <h4>💼 商业咨询</h4>
            <div className="preset-buttons">
              <button onClick={() => setSystemPrompt("你是一个经验丰富的商业顾问，擅长战略规划、市场分析和商业模式设计。你提供专业的商业建议和可执行的方案。")}>商业顾问</button>
              <button onClick={() => setSystemPrompt("你是一个产品经理，擅长用户研究、产品设计和产品策略。你帮助用户定义产品需求、规划功能优先级和优化用户体验。")}>产品经理</button>
              <button onClick={() => setSystemPrompt("你是一个项目管理专家，精通敏捷开发、团队协作和项目规划。你帮助用户提高工作效率、管理项目风险和优化流程。")}>项目管理</button>
            </div>
          </div>

          {/* 专业服务类 */}
          <div className="prompt-category">
            <h4>🎯 专业服务</h4>
            <div className="preset-buttons">
              <button onClick={() => setSystemPrompt("你是一个专业的翻译，精通中英互译。你不仅翻译字面意思，还准确传达原文的语气、文化内涵和专业术语。")}>翻译专家</button>
              <button onClick={() => setSystemPrompt("你是一个UI/UX 设计师，擅长用户界面设计、交互设计和用户体验优化。你提供设计建议和最佳实践。")}>UI/UX 设计</button>
              <button onClick={() => setSystemPrompt("你是一个心理咨询师，擅长倾听和情感支持。你以同理心和专业的方法帮助用户理解和处理情绪问题。")}>心理咨询</button>
            </div>
          </div>

          {/* 学习类 */}
          <div className="prompt-category">
            <h4>📚 教育辅导</h4>
            <div className="preset-buttons">
              <button onClick={() => setSystemPrompt("你是一个耐心的私人教师，擅长用简单易懂的方式解释复杂概念。你使用举例、类比等方法帮助用户理解和掌握知识。")}>私人教师</button>
              <button onClick={() => setSystemPrompt("你是一个学术写作导师，擅长论文写作、研究报告和学术规范。你帮助用户提升学术写作能力和研究方法。")}>学术写作</button>
            </div>
          </div>
        </div>
      </div>

      {/* API 服务卡片 */}
      <div className="settings-card">
        <h3>🌐 API 服务</h3>
        <div className="api-toggle">
          <label className="toggle">
            <input
              type="checkbox"
              checked={apiEnabled}
              onChange={toggleApi}
            />
            <span className="toggle-slider"></span>
          </label>
          <span>{apiEnabled ? "已启用" : "已禁用"}</span>
        </div>
        <p className="hint">启用后可使用 OpenAI 兼容接口访问本地模型</p>
        <div className="api-endpoint">
          <code>POST http://127.0.0.1:{apiPort}/v1/chat/completions</code>
        </div>
      </div>

      {/* 保存按钮 */}
      <div className="settings-actions">
        <button onClick={saveSettings} className="btn-save">
          {settingsSaved ? "✓ 已保存" : "💾 保存所有设置"}
        </button>
        <button onClick={resetAllSessions} className="btn-reset" style={{ marginLeft: '10px', backgroundColor: '#ff6b6b' }}>
          🔄 重置所有会话
        </button>
      </div>

      {/* 关于卡片 */}
      <div className="settings-card about">
        <h3>ℹ️ 关于</h3>
        <div className="about-info">
          <div>Local thinking v{APP_VERSION}</div>
          <div className="tech-stack">Rust + Tauri 2.0 + llama.cpp</div>
        </div>
      </div>
    </div>
  );
}
