import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { HardwareInfo, ModelRecommendation, ModelRecommendationResponse } from "../types";
import "./ModelRecommender.css";

const TIER_LABEL: Record<string, string> = {
  Best:     "最推荐",
  Good:     "推荐",
  Marginal: "内存不足",
  TooLarge: "不可用",
};

export function ModelRecommender({ onSelect }: { onSelect: (m: ModelRecommendation) => void }) {
  const [hw,   setHw]   = useState<HardwareInfo | null>(null);
  const [recs, setRecs] = useState<ModelRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRecommendations = async () => {
      try {
        const result = await invoke<ModelRecommendationResponse>("get_model_recommendations");
        setHw(result.hardware);
        const order = { Best: 0, Good: 1, Marginal: 2, TooLarge: 3 };
        setRecs(result.recommendations.sort((a, b) => order[a.tier] - order[b.tier]));
      } catch (err) {
        console.error("获取推荐信息失败:", err);
        setError("无法获取智能推荐信息，请使用推荐下载选项");
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendations();
  }, []);

  if (loading) {
    return (
      <div className="recommendation-loading">
        <div className="loading-spinner"></div>
        <div className="loading-text">正在检测硬件并生成推荐...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="recommendation-error">
        <div className="message">{error}</div>
        <div className="error-hint">
          智能推荐功能需要后端支持。<br />
          您可以使用"推荐下载"选项选择模型。
        </div>
      </div>
    );
  }

  return (
    <div className="model-recommender">
      {/* 硬件摘要 */}
      {hw && (
        <div className="hardware-summary">
          <div className="hardware-badge">
            RAM {hw.total_ram_gb.toFixed(0)} GB
          </div>
          <div className="hardware-badge">
            可用 ~{hw.available_ram_gb.toFixed(0)} GB
          </div>
          <div className="hardware-badge">
            {hw.cpu_cores} 物理核心
          </div>
          <div className="hardware-badge">
            {hw.has_avx512 ? "AVX-512" : hw.has_avx2 ? "AVX2" : "无向量加速"}
          </div>
        </div>
      )}

      {/* 推荐列表 */}
      <div className="model-recommendations">
        {recs.map(m => {
          const unavail = m.tier === "TooLarge";
          return (
            <div
              key={m.filename}
              className={`recommendation-card tier-${m.tier.toLowerCase().replace("_", "-")}`}
              onClick={() => !unavail && onSelect(m)}
            >
              {/* 标题行 */}
              <div className="card-header">
                {m.is_draft ? (
                  <span className="tier-badge draft">草稿模型</span>
                ) : (
                  <span className={`tier-badge ${m.tier.toLowerCase()}`}>
                    {TIER_LABEL[m.tier]}
                  </span>
                )}
                <span className="model-name">{m.name}</span>
              </div>

              {/* 元数据 */}
              <div className="card-metadata">
                <div className="metadata-item">
                  <span className="label">大小</span>
                  <span className="value">{m.size_gb} GB</span>
                </div>
                <div className="metadata-item">
                  <span className="label">参数</span>
                  <span className="value">{m.params}</span>
                </div>
                <div className="metadata-item">
                  <span className="label">量化</span>
                  <span className="value">{m.quant}</span>
                </div>
              </div>

              {/* 推荐理由 */}
              <div className="card-reason">{m.reason}</div>

              {/* 速度提示 */}
              <div className="card-speed-note">
                {m.speed_note}
              </div>

              {/* 操作按钮 */}
              {!unavail && (
                <div className="card-actions">
                  <button
                    className="download-btn"
                    onClick={e => {
                      e.stopPropagation();
                      onSelect(m);
                    }}
                  >
                    下载模型
                  </button>
                  <div className="memory-remaining">
                    下载后剩余 ~{(hw!.available_ram_gb - m.size_gb - 1.5).toFixed(1)} GB
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部提示 */}
      <div className="recommendation-footer">
        <strong>推荐路径：</strong>先下载推荐模型，再下载草稿模型，
        启用 Speculative Decoding 后可提升速度。
      </div>
    </div>
  );
}
