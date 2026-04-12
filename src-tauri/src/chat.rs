// src-tauri/src/chat.rs
use crate::backend::Message;

pub const INVALID_ASSISTANT_RESPONSE_ERROR: &str = "模型返回了内部推理文本，已自动丢弃。请重试。";
#[allow(dead_code)]
pub const RETRY_RESPONSE_GUARD_SYSTEM_PROMPT: &str = "上一次输出无效，因为模型暴露了内部思考。这一次请像正常助手一样直接回答用户，不要输出思考过程、推理步骤、计划、自述、前言或类似“好的，现在我要分析用户请求”这样的内部独白。问候要自然回应，提问要直接作答，不要只回复“好的”“收到”“明白”这类空泛确认。";

const RAW_REASONING_OPENINGS: &[&str] = &[
    "好",
    "嗯",
    "好的",
    "首先",
    "另外",
    "看起来",
    "让我",
    "基于",
    "根据",
    "接下来",
    "现在",
    "然后",
];

const RAW_REASONING_USER_CUES: &[&str] = &[
    "用户",
    "请求",
    "需求",
    "输入",
    "问题",
    "对话历史",
    "回应",
    "回答",
    "具体服务",
    "能力",
    "服务",
];

const RAW_REASONING_PLANNING_CUES: &[&str] = &[
    "我需要",
    "我应该",
    "我要",
    "我会",
    "我要分析",
    "我要考虑",
    "我要处理",
    "需要理解",
    "需要考虑",
    "引导用户",
    "测试我的反应",
    "使用场景",
    "身份",
    "打字错误",
    "看起来",
    "意味着",
    "确保回应",
    "保持友好",
    "开放的态度",
    "回顾之前的对话历史",
    "进一步了解",
];

#[derive(Clone, Debug)]
pub enum PromptFormat {
    ChatML,
    Llama3,
    Gemma,
    Mistral,
    DeepSeek,
}

/// 计算对话历史的 token 估算数量
/// 中文约 1 token/字符，英文约 1 token/4 字符
#[allow(dead_code)]
pub fn estimate_tokens(text: &str) -> usize {
    // 简单估算：中文字符 * 1 + 英文字符 / 4
    let chinese_chars = text
        .chars()
        .filter(|c| {
            let cp = *c as u32;
            (0x4E00..=0x9FFF).contains(&cp) || // CJK 统一汉字
        (0x3400..=0x4DBF).contains(&cp) || // CJK 扩展A
        (0x20000..=0x2A6DF).contains(&cp) // CJK 扩展B
        })
        .count();

    let total_chars = text.chars().count();
    let non_chinese = total_chars - chinese_chars;

    chinese_chars + (non_chinese / 4)
}

/// 智能截断对话历史，确保不超过最大 token 限制
/// 保留 system 指令和最近的消息，丢弃最旧的非 system 消息
#[allow(dead_code)]
pub fn truncate_messages(messages: &[Message], max_tokens: usize) -> Vec<Message> {
    if messages.is_empty() {
        return Vec::new();
    }

    let system_messages: Vec<Message> = messages
        .iter()
        .filter(|message| message.role == "system")
        .cloned()
        .collect();
    let mut result = Vec::new();
    let mut current_tokens: usize = system_messages
        .iter()
        .map(|message| estimate_tokens(&message.content).max(1))
        .sum();

    // 从最新消息开始倒序遍历，优先保留最近的对话
    for msg in messages.iter().rev() {
        if msg.role == "system" {
            continue;
        }

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

    let mut combined = system_messages;
    combined.extend(result);

    if combined.is_empty() {
        if let Some(last_message) = messages.last() {
            combined.push(last_message.clone());
        }
    }

    combined
}

fn count_phrase_matches(content: &str, phrases: &[&str]) -> usize {
    phrases
        .iter()
        .filter(|phrase| content.contains(**phrase))
        .count()
}

fn has_reasoning_opening(content: &str) -> bool {
    let trimmed = content.trim_start();
    RAW_REASONING_OPENINGS.iter().any(|prefix| {
        trimmed.starts_with(prefix)
            && trimmed[prefix.len()..]
                .chars()
                .next()
                .map(|ch| matches!(ch, '，' | ',' | '。' | '：' | ':' | ' ' | '\n'))
                .unwrap_or(true)
    })
}

fn is_likely_internal_reasoning_line(content: &str) -> bool {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return false;
    }

    let user_cue_count = count_phrase_matches(trimmed, RAW_REASONING_USER_CUES);
    let planning_cue_count = count_phrase_matches(trimmed, RAW_REASONING_PLANNING_CUES);

    if has_reasoning_opening(trimmed) && (user_cue_count > 0 || planning_cue_count > 0) {
        return true;
    }

    (trimmed.contains("用户") && planning_cue_count > 0) || user_cue_count + planning_cue_count >= 2
}

pub fn is_likely_internal_reasoning_message(content: &str) -> bool {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return false;
    }

    let user_cue_count = count_phrase_matches(trimmed, RAW_REASONING_USER_CUES);
    let planning_cue_count = count_phrase_matches(trimmed, RAW_REASONING_PLANNING_CUES);

    if has_reasoning_opening(trimmed) && user_cue_count >= 1 && planning_cue_count >= 1 {
        return true;
    }

    let sentence_parts: Vec<&str> = trimmed
        .split(|ch| matches!(ch, '。' | '！' | '？' | '\n' | '!' | '?'))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();

    let reasoning_parts = sentence_parts
        .iter()
        .filter(|part| is_likely_internal_reasoning_line(part))
        .count();

    reasoning_parts >= 2 && reasoning_parts >= sentence_parts.len().div_ceil(2)
}

fn strip_reasoning_markup(content: &str) -> String {
    content
        .replace("<think>", "")
        .replace("</think>", "")
        .replace("<Think>", "")
        .replace("</Think>", "")
        .replace("<思考>", "")
        .replace("</思考>", "")
        .replace("<回答>", "")
        .replace("</回答>", "")
}

pub fn sanitize_assistant_message_content(content: &str) -> Option<String> {
    let normalized = content.replace('\r', "");
    let normalized = normalized.trim();
    if normalized.is_empty() {
        return None;
    }

    let mut candidate = if let Some(idx) = normalized.rfind("</think>") {
        normalized[idx + "</think>".len()..].trim().to_string()
    } else if let Some(idx) = normalized.find("<回答>") {
        normalized[idx + "<回答>".len()..]
            .replace("</回答>", "")
            .trim()
            .to_string()
    } else if let Some(idx) = normalized.rfind("回答：") {
        normalized[idx + "回答：".len()..].trim().to_string()
    } else if let Some(idx) = normalized.rfind("回答:") {
        normalized[idx + "回答:".len()..].trim().to_string()
    } else if normalized.contains("<think>")
        || normalized.contains("<思考>")
        || normalized.starts_with("思考：")
        || normalized.starts_with("思考:")
    {
        strip_reasoning_markup(normalized)
            .trim()
            .trim_start_matches("思考：")
            .trim_start_matches("思考:")
            .to_string()
    } else {
        normalized.to_string()
    };

    candidate = candidate.trim().to_string();
    if candidate.is_empty() || is_likely_internal_reasoning_message(&candidate) {
        None
    } else {
        Some(candidate)
    }
}

pub fn extract_visible_assistant_content(content: &str, streaming: bool) -> String {
    let normalized = content.replace('\r', "");
    let normalized = normalized.trim();
    if normalized.is_empty() {
        return String::new();
    }

    if let Some(idx) = normalized.rfind("</think>") {
        return normalized[idx + "</think>".len()..].trim().to_string();
    }

    if let Some(idx) = normalized.find("<回答>") {
        return normalized[idx + "<回答>".len()..]
            .replace("</回答>", "")
            .trim()
            .to_string();
    }

    if let Some(idx) = normalized.rfind("回答：") {
        return normalized[idx + "回答：".len()..].trim().to_string();
    }

    if let Some(idx) = normalized.rfind("回答:") {
        return normalized[idx + "回答:".len()..].trim().to_string();
    }

    if normalized.contains("<think>")
        || normalized.contains("<思考>")
        || normalized.starts_with("思考：")
        || normalized.starts_with("思考:")
    {
        return String::new();
    }

    if is_likely_internal_reasoning_message(normalized) {
        if streaming {
            String::new()
        } else {
            sanitize_assistant_message_content(normalized).unwrap_or_default()
        }
    } else {
        normalized.to_string()
    }
}

pub fn sanitize_messages_for_inference(messages: &[Message]) -> Vec<Message> {
    messages
        .iter()
        .filter_map(|message| {
            if message.role != "assistant" {
                return Some(message.clone());
            }

            sanitize_assistant_message_content(&message.content).map(|content| Message {
                role: message.role.clone(),
                content,
            })
        })
        .collect()
}

#[allow(dead_code)]
pub fn build_retry_messages(messages: &[Message]) -> Vec<Message> {
    let mut sanitized = sanitize_messages_for_inference(messages);
    inject_system_prompt(&mut sanitized, RETRY_RESPONSE_GUARD_SYSTEM_PROMPT);
    sanitized
}

fn inject_system_prompt(messages: &mut Vec<Message>, system_prompt: &str) {
    if let Some(first_message) = messages.first_mut() {
        if first_message.role == "system" {
            if !first_message.content.contains(system_prompt) {
                let original = first_message.content.trim();
                first_message.content = if original.is_empty() {
                    system_prompt.to_string()
                } else {
                    format!("{system_prompt}\n\n{original}")
                };
            }
            return;
        }
    }

    messages.insert(
        0,
        Message {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        },
    );
}

/// 根据对话历史动态计算推荐的上下文大小
#[allow(dead_code)]
pub fn recommend_context_size(messages: &[Message]) -> usize {
    let total_tokens: usize = messages.iter().map(|m| estimate_tokens(&m.content)).sum();

    // 根据对话历史大小推荐合适的上下文
    // 留出 50% 的余量给新生成的文本
    let recommended = total_tokens * 2;

    // 限制在合理范围内
    recommended.min(8192).max(1024)
}

#[allow(dead_code)]
pub fn detect_format(model_filename: &str) -> PromptFormat {
    let name = model_filename.to_lowercase();
    if name.contains("deepseek-r1-distill-llama") || name.contains("distill-llama") {
        PromptFormat::Llama3
    } else if name.contains("deepseek-r1-distill-qwen") || name.contains("distill-qwen") {
        PromptFormat::ChatML
    } else if name.contains("llama-3") || name.contains("llama3") {
        PromptFormat::Llama3
    } else if name.contains("gemma") {
        PromptFormat::Gemma
    } else if name.contains("mistral") {
        PromptFormat::Mistral
    } else if name.contains("deepseek") {
        PromptFormat::DeepSeek
    } else {
        PromptFormat::ChatML // Qwen / 默认
    }
}

pub fn build_prompt(fmt: &PromptFormat, messages: &[Message]) -> String {
    match fmt {
        PromptFormat::ChatML => {
            let mut s = String::new();
            for m in messages {
                s.push_str(&format!(
                    "<|im_start|>{}\n{}<|im_end|>\n",
                    m.role, m.content
                ));
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
                s.push_str(&format!(
                    "<start_of_turn>{}\n{}<end_of_turn>\n",
                    role, m.content
                ));
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
        PromptFormat::DeepSeek => {
            // DeepSeek-R1 格式 (注意: BOS token 会由 str_to_token 自动添加)
            let mut s = String::new();
            for m in messages {
                match m.role.as_str() {
                    "user" => {
                        s.push_str(&format!("User: {}\n\n", m.content));
                    }
                    "assistant" | "bot" => {
                        s.push_str(&format!("Assistant: {}\n\n", m.content));
                    }
                    _ => {}
                }
            }
            s.push_str("Assistant: ");
            s
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_retry_messages, detect_format, is_likely_internal_reasoning_message,
        sanitize_assistant_message_content, sanitize_messages_for_inference, PromptFormat,
        RETRY_RESPONSE_GUARD_SYSTEM_PROMPT,
    };
    use crate::backend::Message;

    #[test]
    fn detects_distill_llama_as_llama3() {
        let fmt = detect_format("DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf");
        assert!(matches!(fmt, PromptFormat::Llama3));
    }

    #[test]
    fn detects_distill_qwen_as_chatml() {
        let fmt = detect_format("DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf");
        assert!(matches!(fmt, PromptFormat::ChatML));
    }

    #[test]
    fn sanitizes_reasoning_wrapped_assistant_content() {
        let content = "<think>先分析一下</think>你好，我可以帮助你。";
        assert_eq!(
            sanitize_assistant_message_content(content),
            Some("你好，我可以帮助你。".to_string())
        );
    }

    #[test]
    fn rejects_raw_internal_reasoning_monologue() {
        let content = "好的，现在我要处理用户的请求。首先，我需要分析用户的需求。";
        assert!(is_likely_internal_reasoning_message(content));
        assert_eq!(sanitize_assistant_message_content(content), None);
    }

    #[test]
    fn sanitizes_messages_without_injecting_extra_guard() {
        let sanitized = sanitize_messages_for_inference(&[
            Message {
                role: "user".to_string(),
                content: "你好".to_string(),
            },
            Message {
                role: "assistant".to_string(),
                content: "好的，现在我要处理用户的请求。首先，我需要分析用户的需求。".to_string(),
            },
        ]);

        assert_eq!(sanitized.len(), 1);
        assert_eq!(sanitized[0].role, "user");
    }

    #[test]
    fn retry_messages_adds_stricter_retry_guard() {
        let sanitized = build_retry_messages(&[Message {
            role: "user".to_string(),
            content: "你好".to_string(),
        }]);

        assert_eq!(sanitized[0].role, "system");
        assert_eq!(sanitized[1].role, "user");
        assert_eq!(sanitized[1].content, "你好");
        assert_eq!(sanitized[0].content, RETRY_RESPONSE_GUARD_SYSTEM_PROMPT);
    }
}
