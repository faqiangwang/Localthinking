# Local thinking - 本地大模型客户端

基于 Tauri + React + TypeScript 的本地大语言模型客户端应用。

## 特性

- 🚀 支持多种本地大模型（Qwen、Gemma、DeepSeek 等）
- 💾 智能模型管理和下载
- 🎨 现代化的用户界面
- 🔒 完全本地运行，保护隐私

## 开发

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建应用

```bash
npm run tauri build
```

## GitHub Actions 自动打包

项目配置了 GitHub Actions，可以自动为所有平台打包应用：

### 支持的平台

- ✅ **Windows** (x86_64) - MSI 和 NSIS 安装包
- ✅ **macOS** (Universal) - DMG 和 APP
- ✅ **Linux** (x86_64) - AppImage 和 DEB

### 如何创建发布版本

1. **提交代码到 GitHub**

```bash
git add .
git commit -m "Your commit message"
git push
```

2. **创建版本标签**

```bash
# 创建标签（例如 v1.0.0）
git tag v1.0.0

# 推送标签到 GitHub
git push origin v1.0.0
```

3. **自动构建**

推送标签后，GitHub Actions 会自动：
- 构建 Windows、macOS 和 Linux 版本
- 创建 GitHub Release（草稿状态）
- 上传所有安装包

4. **发布版本**

- 访问 GitHub 仓库的 "Releases" 页面
- 找到草稿版本的 Release
- 检查构建的文件
- 点击 "Publish release" 发布

### 手动触发构建

你也可以在 GitHub 上手动触发构建：

1. 访问仓库的 "Actions" 标签页
2. 选择 "Release" 或 "Build and Release" 工作流
3. 点击 "Run workflow" 按钮
4. 选择分支并点击运行

### 下载安装包

构建完成后，可以在以下位置找到安装包：

- **GitHub Releases** - 所有平台的正式发布版本
- **Actions Artifacts** - 开发版本的构建产物

## 推荐的 IDE 设置

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
