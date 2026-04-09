fn main() {
    // Configure C++ compiler flags for llama-cpp-sys
    // Required for UTF-8 encoded source files
    std::env::set_var("CXXFLAGS", "/utf-8");

    tauri_build::build()
}
