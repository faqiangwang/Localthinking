fn main() {
    // Configure C++ compiler flags for llama-cpp-sys
    // Required for UTF-8 encoded source files
    // NOTE: previously this code unconditionally set `CXXFLAGS` to
    // "/utf-8", which injects an MSVC-specific flag into other
    // toolchains and causes build failures (e.g. `ar: illegal option -- D`).
    // Removing the unconditional set avoids passing MSVC flags on macOS/Linux.

    tauri_build::build()
}
