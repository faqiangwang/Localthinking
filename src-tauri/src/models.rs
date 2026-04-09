// src-tauri/src/models.rs
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager, Window};
use std::io::Write;

/// 下载进度更新间隔（毫秒）
const PROGRESS_UPDATE_INTERVAL_MS: u128 = 200;

/// 获取模型下载目录（应用数据目录下的 models 文件夹）
pub fn get_models_dir(app: &AppHandle) -> std::path::PathBuf {
    // 使用 map_err 来处理可能的错误，返回默认路径
    let data_dir = app.path().app_data_dir()
        .map_err(|e| eprintln!("警告: 无法获取应用数据目录: {}", e))
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let models_dir = data_dir.join("models");
    // 确保目录存在
    if let Err(e) = std::fs::create_dir_all(&models_dir) {
        eprintln!("警告: 无法创建模型目录: {}", e);
    }
    models_dir
}

pub async fn download_model(url: String, filename: String, app: AppHandle, window: Window) -> anyhow::Result<String> {
    eprintln!("[下载] 请求参数: url={}, filename={}", url, filename);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(7200))
        .build()
        .map_err(|e| anyhow::anyhow!("无法创建网络客户端: {}", e))?;

    // 使用应用数据目录存储模型
    let models_dir = get_models_dir(&app);
    let dest = models_dir.join(&filename);
    let dest_str = dest.to_string_lossy().to_string();
    eprintln!("[下载] 目标路径: {}", dest_str);

    // 断点续传：读取已下载大小
    let mut downloaded_size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    eprintln!("[下载] 已下载大小: {} bytes", downloaded_size);

    // 尝试断点续传
    let mut response = None;
    if downloaded_size > 0 {
        eprintln!("[下载] 尝试断点续传...");
        let req_range = client.get(&url).header("Range", format!("bytes={}-", downloaded_size));
        match req_range.send().await {
            Ok(resp) => {
                let status = resp.status();
                eprintln!("[下载] Range 响应状态码: {}", status.as_u16());
                // 206 Partial Content 表示支持断点续传
                // 200 OK 或其他表示不支持，需要重新下载
                if status.as_u16() == 206 {
                    response = Some(resp);
                } else {
                    // 服务器不支持 Range，删除不完整的文件，重新下载
                    eprintln!("[WARN] 服务器不支持断点续传 (状态码 {})，将从头开始下载", status.as_u16());
                    let _ = std::fs::remove_file(&dest);
                    downloaded_size = 0;
                }
            }
            Err(e) => {
                eprintln!("[WARN] Range 请求失败: {}，将从头开始下载", e);
                let _ = std::fs::remove_file(&dest);
                downloaded_size = 0;
            }
        }
    }

    // 如果没有 Range 响应，或者文件不存在，发起完整下载请求
    if response.is_none() {
        eprintln!("[下载] 发起完整下载请求...");
        let req = client.get(&url);
        response = Some(req.send().await.map_err(|e| {
            // 下载失败时，清理不完整的文件
            if dest.exists() {
                eprintln!("[清理] 下载失败，删除不完整的文件: {}", dest_str);
                let _ = std::fs::remove_file(&dest);
            }
            if e.is_timeout() {
                anyhow::anyhow!(
                    "下载超时（2小时）\n\n可能原因:\n1. 网络连接不稳定\n2. 下载速度太慢\n3. 服务器响应慢\n\n建议: 使用代理或重新下载"
                )
            } else if e.is_connect() {
                anyhow::anyhow!(
                    "无法连接到下载服务器\n\n可能原因:\n1. 网络连接问题\n2. 防火墙阻止\n3. 服务器不可用\n\n建议:\n1. 检查网络连接\n2. 尝试使用 VPN 或代理\n3. 稍后重试"
                )
            } else {
                anyhow::anyhow!(
                    "网络请求失败: {}\n\n建议检查网络连接后重试",
                    e
                )
            }
        })?);
    }

    let response = response.unwrap();

    // 检查 HTTP 状态码
    let status = response.status();
    if status.as_u16() != 200 && status.as_u16() != 206 {
        // HTTP 错误时，清理不完整的文件
        if dest.exists() {
            eprintln!("[清理] HTTP错误，删除不完整的文件: {}", dest_str);
            let _ = std::fs::remove_file(&dest);
        }
        return Err(anyhow::anyhow!(
            "服务器返回错误: {} {}\n\n可能原因:\n1. 模型文件不存在\n2. 该模型需要登录才能下载\n3. 网络问题\n\n建议:\n1. 稍后重试\n2. 手动下载模型文件后添加到本地",
            status.as_u16(),
            status.canonical_reason().unwrap_or("Unknown")
        ));
    }

    let content_length = response.content_length().unwrap_or(0);
    let total = content_length + downloaded_size;
    let mut done = downloaded_size;

    // 验证 total 的合理性
    if total == 0 {
        // 无法获取文件大小时，清理不完整的文件
        if dest.exists() {
            eprintln!("[清理] 无法获取文件大小，删除不完整的文件: {}", dest_str);
            let _ = std::fs::remove_file(&dest);
        }
        return Err(anyhow::anyhow!("无法获取文件大小，服务器未返回 Content-Length"));
    }

    eprintln!("[下载] 开始下载: 文件={}, 总大小={} bytes, 已下载={} bytes, 剩余={} bytes",
        filename, total, downloaded_size, content_length);

    // 检查文件是否可写
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&dest)
        .map_err(|e| {
            // 文件打开失败时，清理可能损坏的文件
            if dest.exists() {
                eprintln!("[清理] 文件打开失败，删除损坏的文件: {}", dest_str);
                let _ = std::fs::remove_file(&dest);
            }
            anyhow::anyhow!(
                "无法创建/写入文件: {}\n\n请检查:\n1. 磁盘空间是否充足\n2. 是否有写入权限\n3. 文件是否被其他程序占用",
                e
            )
        })?;

    let mut last_emit = std::time::Instant::now();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            // 下载中断时，清理不完整的文件
            if dest.exists() {
                eprintln!("[清理] 下载中断，删除不完整的文件: {}", dest_str);
                let _ = std::fs::remove_file(&dest);
            }
            anyhow::anyhow!(
                "下载中断: {}\n\n建议重新下载",
                e
            )
        })?;
        file.write_all(&chunk).map_err(|e| {
            // 写入失败时，清理损坏的文件
            if dest.exists() {
                eprintln!("[清理] 写入失败，删除损坏的文件: {}", dest_str);
                let _ = std::fs::remove_file(&dest);
            }
            anyhow::anyhow!(
                "写入文件失败: {}\n\n请检查磁盘空间",
                e
            )
        })?;
        done += chunk.len() as u64;

        // 验证进度：done 不应超过 total
        if done > total {
            eprintln!("[警告] 下载进度异常: done({}) > total({}), 可能是服务器返回的文件大小不准确", done, total);
            // 修正 total 值
            let corrected_total = done;
            // 限制 emit 频率
            if last_emit.elapsed().as_millis() > PROGRESS_UPDATE_INTERVAL_MS {
                if let Err(e) = window.emit(
                        "model://progress",
                        serde_json::json!({
                            "downloaded": done,
                            "total":      corrected_total,
                            "percent":    if corrected_total > 0 { (done as f64 / corrected_total as f64 * 100.0) as u32 } else { 0 },
                        }),
                    ) {
                    eprintln!("警告: 无法发送下载进度: {}", e);
                }
                last_emit = std::time::Instant::now();
            }
        } else {
            // 限制 emit 频率
            if last_emit.elapsed().as_millis() > PROGRESS_UPDATE_INTERVAL_MS {
                let percent = if total > 0 { (done as f64 / total as f64 * 100.0) as u32 } else { 0 };
                eprintln!("[下载] 进度: {} / {} ({}%)", done, total, percent);
                if let Err(e) = window.emit(
                        "model://progress",
                        serde_json::json!({
                            "downloaded": done,
                            "total":      total,
                            "percent":    percent,
                        }),
                    ) {
                    eprintln!("警告: 无法发送下载进度: {}", e);
                }
                last_emit = std::time::Instant::now();
            }
        }
    }
    if let Err(e) = window.emit(
            "model://progress",
            serde_json::json!({
                "downloaded": done, "total": total, "percent": 100
            }),
        ) {
        eprintln!("警告: 无法发送最终进度: {}", e);
    }

    // 验证下载的文件完整性
    let metadata = std::fs::metadata(&dest);
    if let Ok(meta) = metadata {
        let actual_size = meta.len();
        if actual_size != total {
            eprintln!("[错误] 下载完成但文件大小不匹配: 期望 {}, 实际 {}", total, actual_size);
            // 文件大小不匹配，删除损坏的文件
            eprintln!("[清理] 文件大小不匹配，删除损坏的文件: {}", dest_str);
            let _ = std::fs::remove_file(&dest);
            return Err(anyhow::anyhow!(
                "下载的文件大小不匹配\n\n期望: {} bytes\n实际: {} bytes\n\n文件可能损坏，已自动删除。请重新下载。",
                total, actual_size
            ));
        }
    }

    // 返回下载完成的文件路径
    Ok(dest_str)
}

/// 返回下载 URL（自动选择国内镜像）
pub fn resolve_url(repo_id: &str, filename: &str) -> String {
    // hf-mirror.com 为国内用户提供 HuggingFace 镜像
    format!(
        "https://hf-mirror.com/{}/resolve/main/{}",
        repo_id, filename
    )
}
