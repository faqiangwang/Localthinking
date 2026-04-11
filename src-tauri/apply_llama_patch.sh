#!/usr/bin/env bash
set -euo pipefail

# 用途：对本地 vendor/llama-cpp-2 源进行最小化修补，移除或保护 MSVC-only 标志（如 /utf-8）。
# 使用场景：主机无法联网或无法直接安装 cmake 时，先准备修补好的源码，待环境准备完再构建。

VENDOR_DIR="$(dirname "$0")/vendor/llama-cpp-2"

if [ ! -d "$VENDOR_DIR" ]; then
  echo "未找到源码目录：$VENDOR_DIR"
  echo "请将 llama.cpp 源码放到该目录，或在有网络时运行："
  echo "  git clone https://github.com/ggerganov/llama.cpp $VENDOR_DIR"
  exit 1
fi

echo "应用最小化修补到 $VENDOR_DIR"

# 1) 移除所有出现的 /utf-8 标志（MSVC-only）
#    macOS 的 sed 需要 -i ''，其他系统可能需要 -i
find "$VENDOR_DIR" -type f -name CMakeLists.txt -print0 | while IFS= read -r -d '' f; do
  echo "修补 $f"
  # 备份
  cp "$f" "$f.bak" || true
  # 删除出现的 /utf-8
  sed -E "s#(/utf-8)##g" "$f.bak" > "$f"
done

# 2) 其他常见 MSVC-only 选项（示例）：/Z7 /utf-8 /GL
#    这里做一次保守替换（删除斜杠开头的 MSVC 样式标志），仅作为示例
#    你可以按需扩展或把更复杂的 CMake 条件逻辑加入文件

# 注意：自动替换可能不完全安全——建议在版本控制下 review 改动。

echo "修补完成。请检查改动并在 src-tauri/Cargo.toml 中添加：\n\n[patch.crates-io]\nllama-cpp-2 = { path = \"src-tauri/vendor/llama-cpp-2\" }\n\n然后在具备 cmake 的主机上运行：\n\ncd src-tauri\ncargo build -vv --no-default-features --features llama-cpp-2\n"

exit 0
