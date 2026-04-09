// src-tauri/src/chat.rs
use crate::backend::Message;

#[derive(Clone, Debug)]
pub enum PromptFormat {
    ChatML,
    Llama3,
    Gemma,
    Mistral,
}

/// 计算对话历史的 token 估算数量
/// 中文约 1 token/字符，英文约 1 token/4 字符
pub fn estimate_tokens(text: &str) -> usize {
    // 简单估算：中文字符 * 1 + 英文字符 / 4
    let chinese_chars = text.chars().filter(|c| {
        let cp = *c as u32;
        (0x4E00..=0x9FFF).contains(&cp) || // CJK 统一汉字
        (0x3400..=0x4DBF).contains(&cp) || // CJK 扩展A
        (0x20000..=0x2A6DF).contains(&cp) // CJK 扩展B
    }).count();

    let total_chars = text.chars().count();
    let non_chinese = total_chars - chinese_chars;

    chinese_chars + (non_chinese / 4)
}

/// 智能截断对话历史，确保不超过最大 token 限制
/// 保留最近的消息，丢弃最旧的消息
pub fn truncate_messages(messages: &[Message], max_tokens: usize) -> Vec<Message> {
    let mut result = Vec::new();
    let mut current_tokens = 0;

    // 从最新消息开始倒序遍历
    for msg in messages.iter().rev() {
        let msg_tokens = estimate_tokens(&msg.content);

        // 如果加上这条消息会超出限制，且已经有消息了，就停止
        if current_tokens + msg_tokens > max_tokens && !result.is_empty() {
            break;
        }

        current_tokens += msg_tokens;
        result.push(msg.clone());
    }

    // 反转回正确顺序（最旧的消息在前）
    result.reverse();
    result
}

/// 根据对话历史动态计算推荐的上下文大小
pub fn recommend_context_size(messages: &[Message]) -> usize {
    let total_tokens: usize = messages.iter()
        .map(|m| estimate_tokens(&m.content))
        .sum();

    // 根据对话历史大小推荐合适的上下文
    // 留出 50% 的余量给新生成的文本
    let recommended = total_tokens * 2;

    // 限制在合理范围内
    recommended.min(8192).max(1024)
}

#[allow(dead_code)]
pub fn detect_format(model_filename: &str) -> PromptFormat {
    let name = model_filename.to_lowercase();
    if name.contains("llama-3") || name.contains("llama3") {
        PromptFormat::Llama3
    } else if name.contains("gemma") {
        PromptFormat::Gemma
    } else if name.contains("mistral") {
        PromptFormat::Mistral
    } else {
        PromptFormat::ChatML // Qwen / DeepSeek / 默认
    }
}

pub fn build_prompt(fmt: &PromptFormat, messages: &[Message]) -> String {
    match fmt {
        PromptFormat::ChatML => {
            let mut s = String::new();
            for m in messages {
                s.push_str(&format!("<|im_start|>{}\n{}<|im_end|>\n", m.role, m.content));
            }
            s.push_str("<|im_start|>assistant\n");
            s
        }
        PromptFormat::Llama3 => {
            let mut s = String::from("<|begin_of_text|>");
            for m in messages {
                s.push_str(&format!(
                    "<|start_header_id|>{}<|end_header_id|>\n\n{}<|eot_id|>",
                    m.role, m.content
                ));
            }
            s.push_str("<|start_header_id|>assistant<|end_header_id|>\n\n");
            s
        }
        PromptFormat::Gemma => {
            // Gemma 2B 格式: <start_of_turn>user\ncontent<end_of_turn>
            let mut s = String::new();
            for m in messages {
                let role = match m.role.as_str() {
                    "user" => "user",
                    "assistant" | "bot" => "model",
                    _ => "user",
                };
                s.push_str(&format!("<start_of_turn>{}\n{}<end_of_turn>\n", role, m.content));
            }
            s.push_str("<start_of_turn>model\n");
            s
        }
        PromptFormat::Mistral => {
            // Mistral 格式: [INST] prompt [/INST] response [INST] prompt [/INST]
            let mut s = String::new();
            let mut is_first = true;
            for m in messages {
                match m.role.as_str() {
                    "user" => {
                        if !is_first {
                            s.push_str(" ");
                        }
                        s.push_str(&format!("[INST] {} [/INST]", m.content));
                    }
                    "assistant" | "bot" => {
                        s.push_str(&format!(" {}", m.content));
                    }
                    _ => {}
                }
                is_first = false;
            }
            s
        }
    }
}
