// src-tauri/src/sysinfo.rs
use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub total_ram_gb:     f32,
    pub available_ram_gb: f32,
    pub cpu_brand:        String,
    pub cpu_cores:        u32,       // 物理核心数
    pub has_avx2:         bool,
    pub has_avx512:       bool,
    pub os:               String,
}

pub fn detect_hardware() -> HardwareInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let total_ram_gb     = sys.total_memory()     as f32 / 1024.0 / 1024.0 / 1024.0;
    let available_ram_gb = sys.available_memory()  as f32 / 1024.0 / 1024.0 / 1024.0;

    let cpu = sys.cpus().first();
    let cpu_brand = cpu.map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown CPU".to_string());
    let cpu_cores = num_cpus::get_physical() as u32;

    // 检测 AVX 指令集（x86 平台）
    #[cfg(target_arch = "x86_64")]
    let (has_avx2, has_avx512) = {
        (is_x86_feature_detected!("avx2"), is_x86_feature_detected!("avx512f"))
    };
    #[cfg(not(target_arch = "x86_64"))]
    let (has_avx2, has_avx512) = (false, false);

    HardwareInfo {
        total_ram_gb,
        available_ram_gb,
        cpu_brand,
        cpu_cores,
        has_avx2,
        has_avx512,
        os: System::long_os_version().unwrap_or_else(|| "Unknown".to_string()),
    }
}
