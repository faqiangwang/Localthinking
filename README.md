# Local thinking - 本地大模型客户端

基于 Tauri + React + TypeScript 的本地大语言模型客户端应用。

## 特性

- 🚀 支持多种本地大模型（Qwen、Gemma、DeepSeek 等）
- 💾 智能模型管理和下载
- 🎨 现代化的用户界面
- 🔒 完全本地运行，保护隐私

## 许可证

本项目采用 **GPL-3.0 许可证** 开源。

### 使用权限

- ✅ **个人使用**：完全免费，可自由使用、修改和分发
- ✅ **学习研究**：可用于学习、研究和个人项目
- ✅ **开源项目**：可在遵循 GPL-3.0 的开源项目中使用

### 商业使用

- 🏢 **商业授权**：企业或商业用途需要获得商业授权

如需商业授权，请联系：
- 📧 邮箱：faqiangwang@163.com
- 💬 GitHub：[@faqiangwang](https://github.com/faqiangwang)

### 为什么选择 GPL-3.0？

GPL-3.0 确保了软件的自由开放性质，要求所有基于本项目的衍生作品也必须开源。这有助于：
- 保护开源社区的共同利益
- 促进知识和技术的共享
- 防止商业公司在不回馈社区的情况下将代码闭源

如果您的公司需要将本软件集成到商业产品中，请联系我们获取商业授权。

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
