import { useState, useEffect } from 'react';
import type { HardwareInfo } from '../types';
import './FeedbackManager.css';

interface Feedback {
  type: string;
  text: string;
  hardware: HardwareInfo | null;
  timestamp: number;
}

interface FeedbackStats {
  total: number;
  helpful: number;
  notHelpful: number;
  needMoreModels: number;
  other: number;
}

const EMPTY_STATS: FeedbackStats = {
  total: 0,
  helpful: 0,
  notHelpful: 0,
  needMoreModels: 0,
  other: 0,
};

export function FeedbackManager() {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats>(EMPTY_STATS);
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    loadFeedbacks();
  }, []);

  const loadFeedbacks = () => {
    const stored = localStorage.getItem('model_feedbacks');
    if (!stored) {
      setFeedbacks([]);
      setStats(EMPTY_STATS);
      return;
    }

    try {
      const data = JSON.parse(stored) as Feedback[];
      setFeedbacks(data);

      const newStats: FeedbackStats = {
        total: data.length,
        helpful: data.filter(f => f.type === 'helpful').length,
        notHelpful: data.filter(f => f.type === 'not-helpful').length,
        needMoreModels: data.filter(f => f.type === 'need-more-models').length,
        other: data.filter(f => f.type === 'other').length,
      };
      setStats(newStats);
    } catch {
      setFeedbacks([]);
      setStats(EMPTY_STATS);
    }
  };

  const exportFeedbacks = () => {
    const dataStr = JSON.stringify(feedbacks, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `model-feedbacks-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearFeedbacks = () => {
    if (window.confirm('确定要清空所有反馈吗？')) {
      localStorage.removeItem('model_feedbacks');
      setFeedbacks([]);
      setStats(EMPTY_STATS);
    }
  };

  const deleteFeedback = (index: number) => {
    const updated = feedbacks.filter((_, i) => i !== index);
    localStorage.setItem('model_feedbacks', JSON.stringify(updated));
    loadFeedbacks();
  };

  const filteredFeedbacks = feedbacks.filter(f => (filter === 'all' ? true : f.type === filter));

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  };

  const getFeedbackTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      helpful: '👍 有帮助',
      'not-helpful': '👎 不够准确',
      'need-more-models': '➕ 需要更多模型',
      other: '💭 其他建议',
    };
    return labels[type] || type;
  };

  const getFeedbackTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      helpful: '#34c759',
      'not-helpful': '#ff3b30',
      'need-more-models': '#378ADD',
      other: '#888780',
    };
    return colors[type] || '#888780';
  };

  return (
    <div className="feedback-manager">
      <div className="feedback-header">
        <h2>📊 用户反馈管理</h2>
        <div className="feedback-actions">
          <button onClick={exportFeedbacks} className="export-btn">
            📥 导出反馈
          </button>
          <button onClick={clearFeedbacks} className="clear-btn">
            🗑️ 清空反馈
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="stats-grid">
        <div className="stat-card total">
          <div className="stat-number">{stats.total}</div>
          <div className="stat-label">总反馈数</div>
        </div>
        <div className="stat-card helpful">
          <div className="stat-number">{stats.helpful}</div>
          <div className="stat-label">👍 有帮助</div>
        </div>
        <div className="stat-card not-helpful">
          <div className="stat-number">{stats.notHelpful}</div>
          <div className="stat-label">👎 不够准确</div>
        </div>
        <div className="stat-card need-more">
          <div className="stat-number">{stats.needMoreModels}</div>
          <div className="stat-label">➕ 需要更多模型</div>
        </div>
        <div className="stat-card other">
          <div className="stat-number">{stats.other}</div>
          <div className="stat-label">💭 其他建议</div>
        </div>
      </div>

      {/* 滤器 */}
      <div className="filter-bar">
        <span className="filter-label">筛选：</span>
        {['all', 'helpful', 'not-helpful', 'need-more-models', 'other'].map(type => (
          <button
            key={type}
            className={`filter-btn ${filter === type ? 'active' : ''}`}
            onClick={() => setFilter(type)}
          >
            {type === 'all' ? '全部' : getFeedbackTypeLabel(type)}
          </button>
        ))}
      </div>

      {/* 反馈列表 */}
      {filteredFeedbacks.length === 0 ? (
        <div className="no-feedbacks">
          <div className="icon">📭</div>
          <div className="message">{filter === 'all' ? '暂无反馈数据' : '该分类下暂无反馈'}</div>
        </div>
      ) : (
        <div className="feedback-list">
          {filteredFeedbacks.map((feedback, index) => (
            <div
              key={index}
              className="feedback-item"
              onClick={() => setSelectedFeedback(feedback)}
            >
              <div
                className="feedback-type-badge"
                style={{ background: getFeedbackTypeColor(feedback.type) }}
              >
                {getFeedbackTypeLabel(feedback.type)}
              </div>
              <div className="feedback-summary">
                <div className="feedback-time">{formatDate(feedback.timestamp)}</div>
                {feedback.text && (
                  <div className="feedback-preview">
                    {feedback.text.length > 50
                      ? feedback.text.substring(0, 50) + '...'
                      : feedback.text}
                  </div>
                )}
                {feedback.hardware && (
                  <div className="feedback-hardware">
                    💾 {feedback.hardware.total_ram_gb?.toFixed(0)}GB RAM | ⚙️{' '}
                    {feedback.hardware.cpu_cores} 核心 | 🚀{' '}
                    {feedback.hardware.has_avx512
                      ? 'AVX-512'
                      : feedback.hardware.has_avx2
                        ? 'AVX2'
                        : '无加速'}
                  </div>
                )}
              </div>
              <button
                className="delete-feedback-btn"
                onClick={e => {
                  e.stopPropagation();
                  deleteFeedback(index);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 详情对话框 */}
      {selectedFeedback && (
        <div className="feedback-modal" onClick={() => setSelectedFeedback(null)}>
          <div className="feedback-modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>反馈详情</h3>
              <button onClick={() => setSelectedFeedback(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-row">
                <span className="detail-label">类型：</span>
                <span
                  className="detail-value"
                  style={{ color: getFeedbackTypeColor(selectedFeedback.type) }}
                >
                  {getFeedbackTypeLabel(selectedFeedback.type)}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">时间：</span>
                <span className="detail-value">{formatDate(selectedFeedback.timestamp)}</span>
              </div>
              {selectedFeedback.hardware && (
                <>
                  <div className="detail-section-title">硬件配置</div>
                  <div className="hardware-grid">
                    <div className="hardware-item">
                      <span className="hardware-label">总内存</span>
                      <span className="hardware-value">
                        {selectedFeedback.hardware.total_ram_gb?.toFixed(0)} GB
                      </span>
                    </div>
                    <div className="hardware-item">
                      <span className="hardware-label">可用内存</span>
                      <span className="hardware-value">
                        {selectedFeedback.hardware.available_ram_gb?.toFixed(0)} GB
                      </span>
                    </div>
                    <div className="hardware-item">
                      <span className="hardware-label">CPU 核心</span>
                      <span className="hardware-value">
                        {selectedFeedback.hardware.cpu_cores} 核
                      </span>
                    </div>
                    <div className="hardware-item">
                      <span className="hardware-label">SIMD</span>
                      <span className="hardware-value">
                        {selectedFeedback.hardware.has_avx512
                          ? 'AVX-512'
                          : selectedFeedback.hardware.has_avx2
                            ? 'AVX2'
                            : '无加速'}
                      </span>
                    </div>
                    <div className="hardware-item">
                      <span className="hardware-label">CPU</span>
                      <span className="hardware-value">{selectedFeedback.hardware.cpu_brand}</span>
                    </div>
                  </div>
                </>
              )}
              {selectedFeedback.text && (
                <>
                  <div className="detail-section-title">详细内容</div>
                  <div className="feedback-text-content">{selectedFeedback.text}</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
