const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const QRCode = require('qrcode');
const { SSHManager } = require('./src/lib/ssh');
const { ConfigManager } = require('./src/lib/config');
const {
  createServerConfig,
  generateClientConfig,
  generateOptimizeScript,
} = require('./src/lib/xray-config');

let mainWindow;
const sshManager = new SSHManager();
const configManager = new ConfigManager();

// SSH 状态变化推送到渲染进程
sshManager.onStatusChange = (status) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ssh:status-change', status);
  }
};

// ==================== Error Boundary ====================
function wrapHandler(handler) {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      console.error('IPC Handler Error:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 800,
    minHeight: 580,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile('src/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  sshManager.disconnect();
  if (process.platform !== 'darwin') app.quit();
});

// ==================== IPC Handlers ====================

// 配置管理
ipcMain.handle('config:load', wrapHandler(async () => {
  return configManager.load();
}));

ipcMain.handle('config:save', wrapHandler(async (event, config) => {
  return configManager.save(config);
}));

// SSH 连接
ipcMain.handle('ssh:test', wrapHandler(async (event, vpsConfig) => {
  return sshManager.testConnection(vpsConfig);
}));

ipcMain.handle('ssh:connect', wrapHandler(async (event, vpsConfig) => {
  return sshManager.connect(vpsConfig);
}));

ipcMain.handle('ssh:disconnect', wrapHandler(async () => {
  return sshManager.disconnect();
}));

// Xray 管理
ipcMain.handle('xray:status', wrapHandler(async () => {
  return sshManager.exec('systemctl is-active xray && systemctl is-enabled xray');
}));

ipcMain.handle('xray:current-mode', wrapHandler(async () => {
  return sshManager.exec(
    'if [ -f /usr/local/etc/xray/config.json ]; then ' +
    'proto=$(python3 -c "import json; print(json.load(open(\'/usr/local/etc/xray/config.json\'))[\'outbounds\'][0][\'protocol\'])" 2>/dev/null || echo "unknown"); ' +
    'echo "$proto"; else echo "not_installed"; fi'
  );
}));

ipcMain.handle('xray:switch-mode', wrapHandler(async (event, mode) => {
  if (mode !== 'iproyal' && mode !== 'direct') {
    return { success: false, error: 'Invalid mode' };
  }
  const cmd = `cp /usr/local/etc/xray/modes/${mode}.json /usr/local/etc/xray/config.json && systemctl restart xray && sleep 1 && systemctl is-active xray`;
  return sshManager.exec(cmd);
}));

ipcMain.handle('xray:verify-ip', wrapHandler(async () => {
  return sshManager.exec('curl -s --max-time 10 https://ipinfo.io/ip');
}));

ipcMain.handle('xray:verify-iproyal', wrapHandler(async (event, iproyalConfig) => {
  const { address, port, username, password } = iproyalConfig;
  const cmd = `curl -s --max-time 10 --socks5-hostname "${username}:${password}@${address}:${port}" https://ipinfo.io/ip`;
  return sshManager.exec(cmd);
}));

// 一键部署
ipcMain.handle('deploy:run', wrapHandler(async (event, config) => {
  const { vps, iproyal, xray } = config;

  const steps = [];
  const runStep = async (name, cmd) => {
    const result = await sshManager.exec(cmd);
    steps.push({ name, result });
    return result;
  };

  try {
    // Step 1: 基础配置
    await runStep('系统更新', 'apt update -y && apt upgrade -y');
    await runStep('安装工具', 'apt install -y curl wget unzip jq');

    // Step 1.5: 启用 BBR 拥塞控制（优化高延迟/丢包环境）
    await runStep('启用 BBR',
      'grep -q "tcp_congestion_control=bbr" /etc/sysctl.conf || ' +
      '(echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf && ' +
      'echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf && sysctl -p)'
    );

    // Step 2: 安装 Xray
    await runStep('安装 Xray', 'bash <(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)');

    // Step 3: 生成凭证
    const uuid = await runStep('生成 UUID', 'xray uuid');
    const keys = await runStep('生成密钥对', 'xray x25519');
    const shortId = await runStep('生成 shortId', 'openssl rand -hex 8');

    // 解析密钥
    const keysData = keys.data || '';
    const privateKey = keysData.match(/PrivateKey:\s*(\S+)/i)?.[1] || keysData.match(/Private key:\s*(\S+)/i)?.[1] || '';
    const publicKey = keysData.match(/Password \(PublicKey\):\s*(\S+)/i)?.[1] || keysData.match(/Public key:\s*(\S+)/i)?.[1] || '';

    // Step 4: 创建配置目录
    await runStep('创建配置目录', 'mkdir -p /usr/local/etc/xray/modes');

    // Step 5: 生成 IPRoyal 模式配置
    const uuidStr = (uuid.data || '').trim();
    const shortIdStr = (shortId.data || '').trim();

    const iproyalConfig = JSON.stringify(createServerConfig({
      mode: 'iproyal',
      uuid: uuidStr,
      privateKey,
      shortId: shortIdStr,
      iproyal,
    }), null, 2);

    // Step 6: 生成直连模式配置
    const directConfig = JSON.stringify(createServerConfig({
      mode: 'direct',
      uuid: uuidStr,
      privateKey,
      shortId: shortIdStr,
      iproyal,
    }), null, 2);

    // 写入配置文件（用 heredoc 避免引号问题）
    await runStep('写入 IPRoyal 配置', `cat > /usr/local/etc/xray/modes/iproyal.json << 'XRAYEOF'\n${iproyalConfig}\nXRAYEOF`);
    await runStep('写入直连配置', `cat > /usr/local/etc/xray/modes/direct.json << 'XRAYEOF'\n${directConfig}\nXRAYEOF`);
    await runStep('应用初始配置', 'cp /usr/local/etc/xray/modes/iproyal.json /usr/local/etc/xray/config.json');

    // Step 7: 配置防火墙
    await runStep('配置防火墙', 'apt install -y ufw && ufw allow 22/tcp && ufw allow 443/tcp && ufw --force enable');

    // Step 8: 启动 Xray
    await runStep('启动 Xray', 'systemctl enable xray && systemctl restart xray && sleep 2 && systemctl is-active xray');

    // Step 9: 安装切换脚本
    const switchScript = `#!/bin/bash
CONFIG_DIR="/usr/local/etc/xray/modes"
ACTIVE_CONFIG="/usr/local/etc/xray/config.json"
BACKUP_CONFIG="/tmp/xray-config-backup.json"
case "$1" in
  iproyal) cp "$CONFIG_DIR/iproyal.json" "$ACTIVE_CONFIG" && systemctl restart xray && echo "switched to iproyal" ;;
  direct) cp "$CONFIG_DIR/direct.json" "$ACTIVE_CONFIG" && systemctl restart xray && echo "switched to direct" ;;
  status) proto=$(jq -r '.outbounds[0].protocol' "$ACTIVE_CONFIG" 2>/dev/null); echo "$proto" ;;
  verify) curl -s --max-time 10 https://ipinfo.io/ip ;;
  *) echo "usage: xray-switch {iproyal|direct|status|verify}" ;;
esac`;
    await runStep('安装切换脚本', `cat > /usr/local/bin/xray-switch << 'SWITCHEOF'\n${switchScript}\nSWITCHEOF && chmod +x /usr/local/bin/xray-switch`);

    return {
      success: true,
      data: {
        uuid: uuidStr,
        privateKey,
        publicKey,
        shortId: shortIdStr,
        vpsIP: vps.host,
        steps,
      },
    };
  } catch (error) {
    return { success: false, error: error.message, steps };
  }
}));

// 客户端配置生成
ipcMain.handle('client:generate-config', wrapHandler(async (event, params) => {
  return generateClientConfig(params);
}));

// 一键优化（BBR + Xray 配置热更新）
ipcMain.handle('ssh:optimize', wrapHandler(async (event, vpsConfig) => {
  const steps = [];
  const runStep = async (name, cmd) => {
    const result = await sshManager.exec(cmd);
    steps.push({ name, result });
    return result;
  };

  try {
    // Step 1: 启用 BBR
    await runStep('启用 BBR',
      'grep -q "tcp_congestion_control=bbr" /etc/sysctl.conf || ' +
      '(echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf && ' +
      'echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf && sysctl -p)'
    );

    // Step 2: 验证 BBR
    const bbrResult = await runStep('验证 BBR', 'sysctl net.ipv4.tcp_congestion_control');

    // Step 3: 读取当前配置并应用长连接优化字段
    const optimizeScript = generateOptimizeScript();

    await runStep('优化 Xray 配置', optimizeScript);

    // Step 4: 重启 Xray
    await runStep('重启 Xray', 'systemctl restart xray && sleep 2 && systemctl is-active xray');

    return { success: true, data: { bbr: bbrResult.data, steps } };
  } catch (error) {
    return { success: false, error: error.message, steps };
  }
}));

// 系统操作
ipcMain.handle('system:open-url', wrapHandler(async (event, url) => {
  shell.openExternal(url);
}));

// QR Code 生成
ipcMain.handle('qrcode:generate', wrapHandler(async (event, text) => {
  const dataUrl = await QRCode.toDataURL(text, {
    width: 256,
    margin: 2,
    color: {
      dark: '#1e1e2e',
      light: '#ffffff',
    },
  });
  return { success: true, dataUrl };
}));
