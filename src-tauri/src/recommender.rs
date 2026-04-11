// src-tauri/src/recommender.rs
use crate::sysinfo::HardwareInfo;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRecommendation {
    pub name: String,
    pub filename: String, // GGUF 文件名
    pub size_gb: f32,
    pub quant: String,  // "Q4_K_M" 等
    pub params: String, // "7B" 等
    pub tier: RecommendTier,
    pub reason: String,     // 推荐理由，展示给用户
    pub speed_note: String, // 预期速度描述
    pub download_url: String,
    pub is_draft: bool, // 是否为 Speculative Decoding 草稿模型
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RecommendTier {
    Best,     // 最推荐，绿色
    Good,     // 次推荐，蓝色
    Marginal, // 勉强可用，黄色
    TooLarge, // 不可用，灰色
}

// 候选模型库
fn model_catalog() -> Vec<ModelRecommendation> {
    vec![
        // ========== 草稿模型 ==========
        ModelRecommendation {
            name:         "Qwen2.5-0.5B（草稿模型）".into(),
            filename:     "qwen2.5-0.5b-instruct-q4_k_m.gguf".into(),
            size_gb:      0.4,
            quant:        "Q4_K_M".into(),
            params:       "0.5B".into(),
            tier:         RecommendTier::Good,
            reason:       "超小模型，配合 7B 使用可大幅提速".into(),
            speed_note:   "50–80 tok/s，仅用于加速".into(),
            download_url: "https://hf-mirror.com/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf".into(),
            is_draft:     true,
        },

        // ========== 超轻量模型（1-2GB）==========
        ModelRecommendation {
            name:         "Gemma-2-2B（轻量首选）".into(),
            filename:     "gemma-2-2b-it-Q4_K_M.gguf".into(),
            size_gb:      1.5,
            quant:        "Q4_K_M".into(),
            params:       "2B".into(),
            tier:         RecommendTier::Good,
            reason:       "体积小，响应快，低配机器首选".into(),
            speed_note:   "10–20 tok/s".into(),
            download_url: "https://hf-mirror.com/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf".into(),
            is_draft:     false,
        },
        ModelRecommendation {
            name:         "Phi-3-mini-4K（微软小模型）".into(),
            filename:     "Phi-3-mini-4k-instruct-q4.gguf".into(),
            size_gb:      2.4,
            quant:        "Q4".into(),
            params:       "3.8B".into(),
            tier:         RecommendTier::Good,
            reason:       "微软出品，英语能力强，适合日常对话".into(),
            speed_note:   "8–15 tok/s".into(),
            download_url: "https://hf-mirror.com/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf".into(),
            is_draft:     false,
        },

        // ========== 中等模型（3-5GB）==========
        ModelRecommendation {
            name:         "Qwen2.5-7B（中文王者）".into(),
            filename:     "qwen2.5-7b-instruct-q4_k_m.gguf".into(),
            size_gb:      4.5,
            quant:        "Q4_K_M".into(),
            params:       "7B".into(),
            tier:         RecommendTier::Best,
            reason:       "中文能力强，质量与速度最佳平衡".into(),
            speed_note:   "3–6 tok/s".into(),
            download_url: "https://hf-mirror.com/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf".into(),
            is_draft:     false,
        },
        ModelRecommendation {
            name:         "Qwen2.5-7B IQ4_XS（压缩版）".into(),
            filename:     "qwen2.5-7b-instruct-iq4_xs.gguf".into(),
            size_gb:      3.9,
            quant:        "IQ4_XS".into(),
            params:       "7B".into(),
            tier:         RecommendTier::Best,
            reason:       "比 Q4_K_M 小 10%，质量相当，内存紧张时优先".into(),
            speed_note:   "3–7 tok/s".into(),
            download_url: "https://hf-mirror.com/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-iq4_xs.gguf".into(),
            is_draft:     false,
        },
        ModelRecommendation {
            name:         "Qwen2.5-7B Q3_K_M（极速版）".into(),
            filename:     "qwen2.5-7b-instruct-q3_k_m.gguf".into(),
            size_gb:      3.3,
            quant:        "Q3_K_M".into(),
            params:       "7B".into(),
            tier:         RecommendTier::Good,
            reason:       "低配机器加速版，质量略降但速度更快".into(),
            speed_note:   "4–8 tok/s".into(),
            download_url: "https://hf-mirror.com/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q3_k_m.gguf".into(),
            is_draft:     false,
        },
        ModelRecommendation {
            name:         "Llama-3.1-8B（Meta 开源）".into(),
            filename:     "Llama-3.1-8B-Instruct-Q4_K_M.gguf".into(),
            size_gb:      4.7,
            quant:        "Q4_K_M".into(),
            params:       "8B".into(),
            tier:         RecommendTier::Good,
            reason:       "Meta 最新开源，综合能力强".into(),
            speed_note:   "3–5 tok/s".into(),
            download_url: "https://hf-mirror.com/bartowski/Llama-3.1-8B-Instruct-GGUF/resolve/main/Llama-3.1-8B-Instruct-Q4_K_M.gguf".into(),
            is_draft:     false,
        },
        ModelRecommendation {
            name:         "Qwen2.5-Coder-7B（代码专用）".into(),
            filename:     "qwen2.5-coder-7b-instruct-q4_k_m.gguf".into(),
            size_gb:      4.4,
            quant:        "Q4_K_M".into(),
            params:       "7B".into(),
            tier:         RecommendTier::Good,
            reason:       "代码生成专用，编程任务首选".into(),
            speed_note:   "3–5 tok/s".into(),
            download_url: "https://hf-mirror.com/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf".into(),
            is_draft:     false,
        },

        // ========== 推理增强模型（5-7GB）==========
        ModelRecommendation {
            name:         "DeepSeek-R1-Distill-Qwen-8B（推理增强）".into(),
            filename:     "DeepSeek-R1-Distill-Qwen-8B-Q4_K_M.gguf".into(),
            size_gb:      4.9,
            quant:        "Q4_K_M".into(),
            params:       "8B".into(),
            tier:         RecommendTier::Good,
            reason:       "逻辑推理能力强，适合分析类任务".into(),
            speed_note:   "2–5 tok/s".into(),
            download_url: "https://hf-mirror.com/bartowski/DeepSeek-R1-Distill-Qwen-8B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-8B-Q4_K_M.gguf".into(),
            is_draft:     false,
        },
        ModelRecommendation {
            name:         "DeepSeek-R1-Distill-Llama-8B（推理模型）".into(),
            filename:     "DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf".into(),
            size_gb:      5.0,
            quant:        "Q4_K_M".into(),
            params:       "8B".into(),
            tier:         RecommendTier::Good,
            reason:       "基于 Llama 的推理模型，英文推理能力强".into(),
            speed_note:   "2–4 tok/s".into(),
            download_url: "https://hf-mirror.com/bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF/resolve/main/DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf".into(),
            is_draft:     false,
        },

        // ========== 大参数模型（6-10GB）==========
        ModelRecommendation {
            name:         "Qwen2.5-14B Q3_K_M（大参数低配版）".into(),
            filename:     "qwen2.5-14b-instruct-q3_k_m.gguf".into(),
            size_gb:      6.5,
            quant:        "Q3_K_M".into(),
            params:       "14B".into(),
            tier:         RecommendTier::Marginal,
            reason:       "参数量更大但量化激进，质量有损失".into(),
            speed_note:   "1–2 tok/s，较慢".into(),
            download_url: "https://hf-mirror.com/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q3_k_m.gguf".into(),
            is_draft:     false,
        },
        ModelRecommendation {
            name:         "Qwen2.5-14B Q4_K_M（大参数标准版）".into(),
            filename:     "qwen2.5-14b-instruct-q4_k_m.gguf".into(),
            size_gb:      9.0,
            quant:        "Q4_K_M".into(),
            params:       "14B".into(),
            tier:         RecommendTier::Marginal,
            reason:       "高质量 14B 模型，需要 16GB+ 内存".into(),
            speed_note:   "1–3 tok/s，质量更好".into(),
            download_url: "https://hf-mirror.com/Qwen/Qwen2.5-14B-Instruct-GGUF/resolve/main/qwen2.5-14b-instruct-q4_k_m.gguf".into(),
            is_draft:     false,
        },
        ModelRecommendation {
            name:         "DeepSeek-R1-Distill-Qwen-14B（大推理模型）".into(),
            filename:     "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf".into(),
            size_gb:      9.1,
            quant:        "Q4_K_M".into(),
            params:       "14B".into(),
            tier:         RecommendTier::Marginal,
            reason:       "强大的推理能力，适合复杂分析".into(),
            speed_note:   "1–2 tok/s".into(),
            download_url: "https://hf-mirror.com/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf".into(),
            is_draft:     false,
        },

        // ========== 超大模型（10GB+）==========
        ModelRecommendation {
            name:         "Qwen2.5-32B Q3_K_M（超大模型）".into(),
            filename:     "qwen2.5-32b-instruct-q3_k_m.gguf".into(),
            size_gb:      13.0,
            quant:        "Q3_K_M".into(),
            params:       "32B".into(),
            tier:         RecommendTier::TooLarge,
            reason:       "需要 16GB+ 内存，推荐 32GB 使用".into(),
            speed_note:   "0.5–1 tok/s".into(),
            download_url: "https://hf-mirror.com/Qwen/Qwen2.5-32B-Instruct-GGUF/resolve/main/qwen2.5-32b-instruct-q3_k_m.gguf".into(),
            is_draft:     false,
        },
        ModelRecommendation {
            name:         "Qwen2.5-32B Q4_K_M（超大标准版）".into(),
            filename:     "qwen2.5-32b-instruct-q4_k_m.gguf".into(),
            size_gb:      20.0,
            quant:        "Q4_K_M".into(),
            params:       "32B".into(),
            tier:         RecommendTier::TooLarge,
            reason:       "需要 24GB+ 内存".into(),
            speed_note:   "不适合当前配置".into(),
            download_url: "https://hf-mirror.com/Qwen/Qwen2.5-32B-Instruct-GGUF/resolve/main/qwen2.5-32b-instruct-q4_k_m.gguf".into(),
            is_draft:     false,
        },

        // ========== 特殊用途模型 ==========
        ModelRecommendation {
            name:         "Gemma-2-27B（谷歌大模型）".into(),
            filename:     "gemma-2-27b-it-Q4_K_M.gguf".into(),
            size_gb:      16.0,
            quant:        "Q4_K_M".into(),
            params:       "27B".into(),
            tier:         RecommendTier::TooLarge,
            reason:       "Google 最新大模型，需要 20GB+ 内存".into(),
            speed_note:   "0.5–1 tok/s".into(),
            download_url: "https://hf-mirror.com/bartowski/gemma-2-27b-it-GGUF/resolve/main/gemma-2-27b-it-Q4_K_M.gguf".into(),
            is_draft:     false,
        },
    ]
}

pub fn recommend(hw: &HardwareInfo) -> Vec<ModelRecommendation> {
    // 可分配给模型的内存 = 可用内存 - 1.5GB 系统保留
    let usable_gb = (hw.available_ram_gb - 1.5).max(0.0);

    model_catalog()
        .into_iter()
        .map(|mut m| {
            // 根据可用内存重新定级
            if m.size_gb > usable_gb {
                m.tier = RecommendTier::TooLarge;
                m.reason = format!(
                    "需要 {:.0}GB 可用内存，当前仅 {:.0}GB",
                    m.size_gb, usable_gb
                );
            } else if m.size_gb > usable_gb * 0.75 {
                // 内存占用超过 75%，降级为 Marginal
                if m.tier == RecommendTier::Best {
                    m.tier = RecommendTier::Good;
                }
                m.reason = format!("{}（内存较紧张）", m.reason);
            }

            // 根据 CPU 指令集调整速度描述
            if hw.has_avx512 {
                m.speed_note = format!("{}（AVX-512 加速）", m.speed_note);
            } else if hw.has_avx2 {
                m.speed_note = format!("{}（AVX2 加速）", m.speed_note);
            }

            m
        })
        // 排序：Best > Good > Marginal > TooLarge，同级按体积升序
        .collect::<Vec<_>>()
        .into_iter()
        .filter(|m| m.tier != RecommendTier::TooLarge || m.size_gb <= usable_gb + 2.0)
        .collect()
}
