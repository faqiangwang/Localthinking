把 `llama.cpp` 源放到此目录以启用本地修补

说明：
1. 在项目根路径下，创建目录 `src-tauri/vendor/llama-cpp-2`，并将上游的 `llama.cpp` 源（或者你自己的 fork）完整拷贝到该目录。
2. 运行仓库中已有的补丁脚本以移除/保护 MSVC-only 标志：
   chmod +x src-tauri/apply_llama_patch.sh
   src-tauri/apply_llama_patch.sh
3. 在具备 `cmake` 的主机上运行：
   cd src-tauri
   cargo build -vv --no-default-features --features llama-cpp-2

提示：如果你希望我替你 clone 并应用补丁（需网络），告诉我我会尝试；当前环境网络被阻断，所以请手动把源码放到这里，或在一台可联网机器上完成。