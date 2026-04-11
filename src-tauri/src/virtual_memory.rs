// src-tauri/src/virtual_memory.rs
// Windows 虚拟内存（页面文件）管理

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VirtualMemoryInfo {
    pub total_physical_mb: u64,
    pub available_physical_mb: u64,
    pub current_paging_file_mb: u64,
    pub paging_file_path: String,
    pub paging_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VirtualMemoryConfig {
    pub initial_mb: u64,
    pub maximum_mb: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VirtualMemorySetResult {
    pub success: bool,
    pub message: String,
    pub requires_restart: bool,
}

/// 获取系统内存信息 - 简化版本，避免 PowerShell 阻塞
#[tauri::command]
pub fn get_virtual_memory_info() -> Result<VirtualMemoryInfo, String> {
    // 使用更简单的命令，减少执行时间
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            r#"
            $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
            $mem = Get-CimInstance Win32_PerfRawData_PerfOS_Memory -ErrorAction Stop
            @{
                T = [math]::Round($cs.TotalPhysicalMemory / 1MB, 0)
                A = [math]::Round($mem.AvailableBytes / 1MB, 0)
                P = if ($cs.AutomaticManagedPagingFile) { $true } else { $false }
            } | ConvertTo-Json -Compress
            "#,
        ])
        .output()
        .map_err(|e| format!("执行 PowerShell 失败: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "PowerShell 执行失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let json_str = json_str.trim();

    if json_str.is_empty() {
        return Err("PowerShell 返回空结果".to_string());
    }

    #[derive(Deserialize)]
    struct PsOutput {
        #[serde(alias = "T")]
        total: u64,
        #[serde(alias = "A")]
        available: u64,
        #[serde(alias = "P")]
        paging_enabled: bool,
    }

    let ps_output: PsOutput = serde_json::from_str(json_str)
        .map_err(|e| format!("解析内存信息失败: {} - 原始: {}", e, json_str))?;

    Ok(VirtualMemoryInfo {
        total_physical_mb: ps_output.total,
        available_physical_mb: ps_output.available,
        current_paging_file_mb: 0, // 简化：不再获取这个
        paging_file_path: if ps_output.paging_enabled {
            "自动管理".to_string()
        } else {
            "手动".to_string()
        },
        paging_enabled: ps_output.paging_enabled,
    })
}

/// 设置虚拟内存（需要管理员权限）
#[tauri::command]
pub fn set_virtual_memory(config: VirtualMemoryConfig) -> Result<VirtualMemorySetResult, String> {
    // 检查是否以管理员权限运行
    let is_admin = check_admin_privilege();

    if !is_admin {
        return Ok(VirtualMemorySetResult {
            success: false,
            message: "修改虚拟内存需要管理员权限。请右键以管理员身份运行应用程序。".to_string(),
            requires_restart: false,
        });
    }

    // 使用 PowerShell 设置虚拟内存
    let script = format!(
        r#"
        $cs = Get-CimInstance Win32_ComputerSystem
        $cs.AutomaticManagedPagingFile = $false

        $pfPath = "C:\pagefile.sys"
        $initialSize = {}
        $maximumSize = {}

        $cs | Set-CimInstance -Property @{{
            AutomaticManagedPagingFile = $false
            PagingFiles = @("$pfPath `$$initialSize `$$maximumSize")
        }}

        Write-Output "SUCCESS"
        "#,
        config.initial_mb, config.maximum_mb
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("执行 PowerShell 失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.contains("SUCCESS") {
        Ok(VirtualMemorySetResult {
            success: true,
            message: format!(
                "虚拟内存已设置为 {} MB - {} MB。需要重启电脑使更改生效。",
                config.initial_mb, config.maximum_mb
            ),
            requires_restart: true,
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Ok(VirtualMemorySetResult {
            success: false,
            message: format!("设置失败: {}", stderr),
            requires_restart: false,
        })
    }
}

/// 启用自动管理虚拟内存
#[tauri::command]
pub fn enable_auto_virtual_memory() -> Result<VirtualMemorySetResult, String> {
    let is_admin = check_admin_privilege();

    if !is_admin {
        return Ok(VirtualMemorySetResult {
            success: false,
            message: "修改虚拟内存需要管理员权限。请右键以管理员身份运行应用程序。".to_string(),
            requires_restart: false,
        });
    }

    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            r#"
            $cs = Get-CimInstance Win32_ComputerSystem
            $cs | Set-CimInstance -Property @{ AutomaticManagedPagingFile = $true }
            Write-Output "SUCCESS"
            "#,
        ])
        .output()
        .map_err(|e| format!("执行 PowerShell 失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    if stdout.contains("SUCCESS") {
        Ok(VirtualMemorySetResult {
            success: true,
            message: "已启用自动管理虚拟内存。需要重启电脑使更改生效。".to_string(),
            requires_restart: true,
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let error_msg = if stderr.is_empty() {
            "设置失败，请检查系统配置".to_string()
        } else {
            format!("设置失败: {}", stderr.trim())
        };
        Ok(VirtualMemorySetResult {
            success: false,
            message: error_msg,
            requires_restart: false,
        })
    }
}

/// 检查是否具有管理员权限
fn check_admin_privilege() -> bool {
    let output = Command::new("net").args(["session"]).output();

    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}
