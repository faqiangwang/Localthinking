#!/usr/bin/env bash
set -euo pipefail

# 用途：对 vendored `llama-cpp-2` / `llama-cpp-sys-2` 快照进行最小化修补。
# 当前默认修补是同步 `add_cpu_moe_override()` 的正则，使其覆盖 `gate_up`
# 等更新的 MoE tensor 命名。

ROOT_DIR="$(dirname "$0")/vendor"
LLAMA_CRATE_DIR="$ROOT_DIR/llama-cpp-2"
LLAMA_SYS_DIR="$ROOT_DIR/llama-cpp-sys-2"

if [ ! -d "$LLAMA_CRATE_DIR" ] || [ ! -d "$LLAMA_SYS_DIR" ]; then
  echo "未找到 vendored crate 目录："
  echo "  $LLAMA_CRATE_DIR"
  echo "  $LLAMA_SYS_DIR"
  exit 1
fi

PARAMS_FILE="$LLAMA_CRATE_DIR/src/model/params.rs"

if [ ! -f "$PARAMS_FILE" ]; then
  echo "未找到目标文件：$PARAMS_FILE"
  exit 1
fi

echo "修补 $PARAMS_FILE"
cp "$PARAMS_FILE" "$PARAMS_FILE.bak" || true

python3 - <<'PY' "$PARAMS_FILE"
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = 'self.add_cpu_buft_override(c"\\\\.ffn_(up|down|gate)_(ch|)exps");'
new = 'self.add_cpu_buft_override(c"blk\\\\.\\\\d+\\\\.ffn_(up|down|gate_up|gate)_(ch|)exps");'
if old in text:
    path.write_text(text.replace(old, new))
PY

echo "修补完成。接下来运行："
echo
echo "  cd src-tauri"
echo "  cargo build -vv --no-default-features --features llama-cpp-2"

exit 0
