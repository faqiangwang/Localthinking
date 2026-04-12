此目录已经包含可复现的 vendored `llama.cpp` Rust 绑定快照：

- `llama-cpp-2 0.1.143`
- `llama-cpp-sys-2 0.1.143`
- `llama-cpp-sys-2` 对应的上游仓库提交：`b25863e1422d0c8fe09b5efbcbc0481345b7d003`

当前本地补丁：

1. 根 `Cargo.toml` 通过 `[patch.crates-io]` 强制使用本目录。
2. `vendor/llama-cpp-2/src/model/params.rs` 的 `add_cpu_moe_override()` 已对齐到更新的 MoE tensor pattern，覆盖 `gate_up` 等现代架构张量。

构建方式：

```bash
cd src-tauri
cargo build -vv --no-default-features --features llama-cpp-2
```

如果后续要升级版本，推荐流程：

1. 从 Cargo registry 或上游仓库更新 `llama-cpp-2` / `llama-cpp-sys-2`。
2. 保留根 `[patch.crates-io]`。
3. 重新检查 `add_cpu_moe_override()` 是否仍需要本地补丁。
