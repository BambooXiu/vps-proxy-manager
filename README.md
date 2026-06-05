# VPS Proxy Manager

macOS 桌面应用，用于管理 VPS 代理模式切换。

## 功能

- 🔄 一键切换 IPRoyal / 直连模式
- 📊 实时查看连接状态和出口 IP
- ⚙️ VPS 和 IPRoyal 配置管理
- 📱 生成客户端配置和二维码
- 🚀 一键部署 Xray 到 VPS

## 安装

### 开发模式

```bash
npm install
npm start
```

### 构建 DMG

```bash
npm run build:dmg
```

构建完成后，DMG 文件在 `dist/` 目录中。

## 使用说明

1. **配置 VPS**: 在设置页面填入 VPS 的 SSH 连接信息
2. **配置 IPRoyal**: 填入 IPRoyal 代理地址、端口、用户名、密码
3. **一键部署**: 在部署页面点击"开始部署"，自动安装 Xray 并配置代理
4. **模式切换**: 在仪表盘页面切换 IPRoyal / 直连模式
5. **客户端配置**: 部署完成后，在客户端页面获取配置链接和二维码

## 架构

```
用户设备 (Windows/macOS/Android/iOS)
        │
        │ VLESS + Reality
        ▼
RackNerd VPS (New York) 运行 Xray-core
        │
        │ SOCKS5
        ▼
IPRoyal 194.50.146.79 (US Delaware)
        │
        ▼
海外网站
```

## 技术栈

- Electron
- SSH2 (VPS 连接)
- QRCode (二维码生成)

## 项目结构

```
vps-proxy-manager/
├── main.js              # Electron 主进程
├── preload.js           # 预加载脚本
├── src/
│   ├── index.html       # 主界面
│   ├── styles.css       # 样式
│   ├── renderer.js      # 渲染进程逻辑
│   └── lib/
│       ├── ssh.js       # SSH 连接管理
│       └── config.js    # 配置管理
├── assets/              # 资源文件
└── package.json         # 项目配置
```
