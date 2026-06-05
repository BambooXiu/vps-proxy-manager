// ==================== State ====================
let config = {
  vps: { host: '', port: '22', username: 'root', password: '', privateKey: '' },
  iproyal: { address: '', port: '', username: '', password: '' },
  deploy: { uuid: '', privateKey: '', publicKey: '', shortId: '', vpsIP: '', deployed: false },
};

let connected = false;
let connecting = false;

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  setupNavigation();
  setupEventListeners();
  updateUI();

  // 启动后自动连接 VPS
  if (config.vps.host) {
    refreshDashboard();
  }
});

// ==================== Config ====================
async function loadConfig() {
  const result = await window.api.config.load();
  if (result.success && result.data) {
    config = { ...config, ...result.data };
  }
}

async function saveConfig() {
  const result = await window.api.config.save(config);
  if (result.success) {
    notify('配置已保存', 'success');
  } else {
    notify('保存失败: ' + result.error, 'error');
  }
}

// ==================== Navigation ====================
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      switchPage(page);
    });
  });
}

function switchPage(page) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.getElementById(`page-${page}`)?.classList.add('active');
}

// ==================== Event Listeners ====================
function setupEventListeners() {
  // Dashboard
  document.getElementById('btnRefresh').addEventListener('click', refreshDashboard);
  document.getElementById('btnModeIproyal').addEventListener('click', () => switchMode('iproyal'));
  document.getElementById('btnModeDirect').addEventListener('click', () => switchMode('direct'));
  document.getElementById('btnVerifyIP').addEventListener('click', verifyIP);
  document.getElementById('btnCheckXray').addEventListener('click', checkXrayStatus);

  // Settings
  document.getElementById('vpsAuthType').addEventListener('change', (e) => {
    document.getElementById('vpsPasswordGroup').classList.toggle('hidden', e.target.value !== 'password');
    document.getElementById('vpsKeyGroup').classList.toggle('hidden', e.target.value !== 'key');
  });
  document.getElementById('btnTestSSH').addEventListener('click', testSSH);
  document.getElementById('btnSaveVPS').addEventListener('click', saveVPSSettings);
  document.getElementById('btnSaveIPRoyal').addEventListener('click', saveIPRoyalSettings);

  // Client
  document.getElementById('btnCopyLink').addEventListener('click', copyVLESSLink);
  document.getElementById('btnCopyFullConfig').addEventListener('click', copyFullConfig);

  // Deploy
  document.getElementById('btnDeploy').addEventListener('click', runDeploy);
}

// ==================== UI Update ====================
function updateUI() {
  // Fill settings form
  document.getElementById('vpsHost').value = config.vps.host;
  document.getElementById('vpsPort').value = config.vps.port;
  document.getElementById('vpsUsername').value = config.vps.username;
  document.getElementById('vpsPassword').value = config.vps.password;
  document.getElementById('vpsPrivateKey').value = config.vps.privateKey;
  document.getElementById('iproyalAddress').value = config.iproyal.address;
  document.getElementById('iproyalPort').value = config.iproyal.port;
  document.getElementById('iproyalUsername').value = config.iproyal.username;
  document.getElementById('iproyalPassword').value = config.iproyal.password;

  // Connection status
  updateConnectionStatus();

  // Deploy checklist
  updateDeployChecklist();

  // Client page
  updateClientPage();
}

function updateConnectionStatus() {
  const statusEl = document.getElementById('connectionStatus');
  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('span');

  if (connecting) {
    dot.className = 'status-dot connecting';
    text.textContent = '连接中';
  } else if (connected) {
    dot.className = 'status-dot connected';
    text.textContent = '已连接';
  } else {
    dot.className = 'status-dot disconnected';
    text.textContent = '未连接';
  }
}

function updateDeployChecklist() {
  const vpsOk = config.vps.host && config.vps.username;
  const iproyalOk = config.iproyal.address && config.iproyal.port && config.iproyal.username;

  const checkVPS = document.getElementById('checkVPS');
  const checkIPRoyal = document.getElementById('checkIPRoyal');
  const btnDeploy = document.getElementById('btnDeploy');

  checkVPS.className = `check-item ${vpsOk ? 'checked' : 'unchecked'}`;
  checkVPS.querySelector('.check-icon').textContent = vpsOk ? '●' : '○';

  checkIPRoyal.className = `check-item ${iproyalOk ? 'checked' : 'unchecked'}`;
  checkIPRoyal.querySelector('.check-icon').textContent = iproyalOk ? '●' : '○';

  btnDeploy.disabled = !(vpsOk && iproyalOk);
}

function updateClientPage() {
  const infoBox = document.querySelector('.client-info-box');
  const qrSection = document.getElementById('qrSection');
  const configSection = document.getElementById('configSection');

  if (config.deploy.deployed) {
    infoBox.style.display = 'none';
    qrSection.style.display = 'block';
    configSection.style.display = 'block';
    generateClientConfig();
  } else {
    infoBox.style.display = 'flex';
    qrSection.style.display = 'none';
    configSection.style.display = 'none';
  }
}

// ==================== Dashboard ====================
async function refreshDashboard() {
  if (!config.vps.host) {
    notify('请先配置 VPS 连接信息', 'error');
    return;
  }

  // 防止重复点击
  if (connecting) return;

  // 设置刷新中状态
  connecting = true;
  updateConnectionStatus();
  const btnRefresh = document.getElementById('btnRefresh');
  btnRefresh.disabled = true;
  btnRefresh.querySelector('.btn-text').textContent = '刷新中';

  // 清空仪表盘数据
  document.getElementById('dashConnectionState').textContent = '连接中...';
  document.getElementById('dashConnectionState').style.color = 'var(--text-muted)';
  document.getElementById('dashCurrentMode').textContent = '--';
  document.getElementById('dashExitIP').textContent = '--';

  try {
    // Connect
    const connResult = await window.api.ssh.connect(config.vps);
    if (!connResult.success) {
      notify('连接失败: ' + connResult.error, 'error');
      connected = false;
      connecting = false;
      updateConnectionStatus();
      btnRefresh.disabled = false;
      btnRefresh.querySelector('.btn-text').textContent = '刷新';
      document.getElementById('dashConnectionState').textContent = '连接失败';
      document.getElementById('dashConnectionState').style.color = 'var(--red)';
      return;
    }

    connected = true;
    connecting = false;
    updateConnectionStatus();

    // Get Xray status
    const xrayStatus = await window.api.xray.status();
    const dashState = document.getElementById('dashConnectionState');
    if (xrayStatus.success && xrayStatus.data.includes('active')) {
      dashState.textContent = '运行中';
      dashState.style.color = 'var(--green)';
    } else {
      dashState.textContent = '未运行';
      dashState.style.color = 'var(--red)';
    }

    // Get current mode
    const modeResult = await window.api.xray.currentMode();
    const dashMode = document.getElementById('dashCurrentMode');
    if (modeResult.success) {
      const proto = modeResult.data;
      if (proto === 'socks' || proto === 'http') {
        dashMode.textContent = 'IPRoyal';
        dashMode.style.color = 'var(--green)';
        document.getElementById('btnModeIproyal').classList.add('active');
        document.getElementById('btnModeDirect').classList.remove('active');
      } else if (proto === 'freedom') {
        dashMode.textContent = '直连';
        dashMode.style.color = 'var(--yellow)';
        document.getElementById('btnModeDirect').classList.add('active');
        document.getElementById('btnModeIproyal').classList.remove('active');
      } else {
        dashMode.textContent = '未知';
      }
    }

    // Get exit IP
    const ipResult = await window.api.xray.verifyIp();
    document.getElementById('dashExitIP').textContent = ipResult.success ? ipResult.data : '--';

  } catch (error) {
    notify('刷新失败: ' + (error.message || error), 'error');
    connecting = false;
    connected = false;
    updateConnectionStatus();
  } finally {
    btnRefresh.disabled = false;
    btnRefresh.querySelector('.btn-text').textContent = '刷新';
  }
}

async function switchMode(mode) {
  // 如果未连接，先尝试连接
  if (!connected) {
    if (!config.vps.host) {
      notify('请先配置 VPS 连接信息', 'error');
      return;
    }
    try {
      const connResult = await window.api.ssh.connect(config.vps);
      if (!connResult.success) {
        notify('连接 VPS 失败', 'error');
        return;
      }
      connected = true;
      updateConnectionStatus();
    } catch (e) {
      notify('连接 VPS 失败: ' + (e.message || e), 'error');
      return;
    }
  }

  try {
    const result = await window.api.xray.switchMode(mode);
    if (result.success) {
      notify(`已切换到 ${mode === 'iproyal' ? 'IPRoyal' : '直连'} 模式`, 'success');
      document.getElementById('btnModeIproyal').classList.toggle('active', mode === 'iproyal');
      document.getElementById('btnModeDirect').classList.toggle('active', mode === 'direct');

      const dashMode = document.getElementById('dashCurrentMode');
      dashMode.textContent = mode === 'iproyal' ? 'IPRoyal' : '直连';
      dashMode.style.color = mode === 'iproyal' ? 'var(--green)' : 'var(--yellow)';

      // Refresh IP
      setTimeout(async () => {
        const ipResult = await window.api.xray.verifyIp();
        document.getElementById('dashExitIP').textContent = ipResult.success ? ipResult.data : '--';
      }, 1500);
    } else {
      notify('切换失败: ' + (result.error || result.data), 'error');
    }
  } catch (error) {
    notify('切换失败: ' + (error.message || error), 'error');
  }
}

async function verifyIP() {
  if (!connected) {
    if (!config.vps.host) {
      notify('请先配置 VPS 连接信息', 'error');
      return;
    }
    try {
      const connResult = await window.api.ssh.connect(config.vps);
      if (!connResult.success) {
        notify('连接 VPS 失败', 'error');
        return;
      }
      connected = true;
      updateConnectionStatus();
    } catch (e) {
      notify('连接 VPS 失败: ' + (e.message || e), 'error');
      return;
    }
  }

  try {
    const result = await window.api.xray.verifyIp();
    if (result.success) {
      document.getElementById('dashExitIP').textContent = result.data;
      notify('出口 IP: ' + result.data, 'success');
    } else {
      notify('验证失败', 'error');
    }
  } catch (error) {
    notify('验证失败: ' + (error.message || error), 'error');
  }
}

async function checkXrayStatus() {
  if (!connected) {
    if (!config.vps.host) {
      notify('请先配置 VPS 连接信息', 'error');
      return;
    }
    try {
      const connResult = await window.api.ssh.connect(config.vps);
      if (!connResult.success) {
        notify('连接 VPS 失败', 'error');
        return;
      }
      connected = true;
      updateConnectionStatus();
    } catch (e) {
      notify('连接 VPS 失败: ' + (e.message || e), 'error');
      return;
    }
  }

  try {
    const result = await window.api.xray.status();
    if (result.success) {
      const lines = result.data.split('\n');
      const active = lines[0];
      const enabled = lines[1];

      const dashState = document.getElementById('dashConnectionState');
      if (active === 'active') {
        dashState.textContent = '运行中';
        dashState.style.color = 'var(--green)';
        notify(`Xray 运行中 (${enabled === 'enabled' ? '已启用开机自启' : '未启用自启'})`, 'success');
      } else {
        dashState.textContent = '未运行';
        dashState.style.color = 'var(--red)';
        notify('Xray 未运行', 'error');
      }
    }
  } catch (error) {
    notify('检查失败: ' + (error.message || error), 'error');
  }
}

// ==================== Settings ====================
async function testSSH() {
  const vpsConfig = getVPSFormValues();

  if (!vpsConfig.host) {
    notify('请输入 VPS 主机地址', 'error');
    return;
  }

  const btn = document.getElementById('btnTestSSH');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading"></span> 测试中...';

  try {
    const result = await window.api.ssh.test(vpsConfig);
    if (result.success) {
      connected = true;
      updateConnectionStatus();
      notify('连接成功', 'success');
    } else {
      notify('连接失败: ' + result.error, 'error');
    }
  } catch (error) {
    notify('连接失败: ' + (error.message || error.error || error), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

function getVPSFormValues() {
  const authType = document.getElementById('vpsAuthType').value;
  return {
    host: document.getElementById('vpsHost').value.trim(),
    port: document.getElementById('vpsPort').value.trim() || '22',
    username: document.getElementById('vpsUsername').value.trim() || 'root',
    password: authType === 'password' ? document.getElementById('vpsPassword').value : '',
    privateKey: authType === 'key' ? document.getElementById('vpsPrivateKey').value.trim() : '',
  };
}

async function saveVPSSettings() {
  config.vps = getVPSFormValues();
  await saveConfig();
  updateDeployChecklist();
}

async function saveIPRoyalSettings() {
  config.iproyal = {
    address: document.getElementById('iproyalAddress').value.trim(),
    port: document.getElementById('iproyalPort').value.trim(),
    username: document.getElementById('iproyalUsername').value.trim(),
    password: document.getElementById('iproyalPassword').value,
  };
  await saveConfig();
  updateDeployChecklist();
}

// ==================== Client ====================
async function generateClientConfig() {
  if (!config.deploy.deployed) return;

  try {
    const result = await window.api.client.generateConfig({
      vpsIP: config.deploy.vpsIP,
      uuid: config.deploy.uuid,
      publicKey: config.deploy.publicKey,
      shortId: config.deploy.shortId,
    });

    if (result.vlessLink) {
      document.getElementById('vlessLink').value = result.vlessLink;

      // Generate QR code
      await generateQRCode(result.vlessLink);

      // Fill config table
      const tbody = document.getElementById('configTableBody');
      const m = result.manual;
      tbody.innerHTML = `
        <tr><td>地址</td><td>${m.address}</td></tr>
        <tr><td>端口</td><td>${m.port}</td></tr>
        <tr><td>协议</td><td>${m.protocol}</td></tr>
        <tr><td>UUID</td><td>${m.uuid}</td></tr>
        <tr><td>流控</td><td>${m.flow}</td></tr>
        <tr><td>传输方式</td><td>${m.transport}</td></tr>
        <tr><td>安全</td><td>${m.security}</td></tr>
        <tr><td>SNI</td><td>${m.sni}</td></tr>
        <tr><td>PublicKey</td><td>${m.publicKey}</td></tr>
        <tr><td>ShortId</td><td>${m.shortId}</td></tr>
        <tr><td>Fingerprint</td><td>${m.fingerprint}</td></tr>
        <tr><td>MUX</td><td>开启 (并发 ${m.mux.concurrency}, XUDP ${m.mux.xudpConcurrency})</td></tr>
        <tr><td>TCP FastOpen</td><td>开启</td></tr>
        <tr><td>KeepAlive</td><td>30s</td></tr>
      `;

      // Store full config for copy
      window._fullConfig = result.fullConfig;
    }
  } catch (error) {
    console.error('Generate config error:', error);
  }
}

async function generateQRCode(text) {
  try {
    const result = await window.api.qrcode.generate(text);
    if (result.success) {
      const canvas = document.getElementById('qrCanvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
      };
      img.src = result.dataUrl;
    }
  } catch (error) {
    console.error('QR code generation failed:', error);
  }
}

function copyVLESSLink() {
  const link = document.getElementById('vlessLink').value;
  navigator.clipboard.writeText(link).then(() => {
    notify('已复制到剪贴板', 'success');
  }).catch(() => {
    // Fallback
    const textarea = document.getElementById('vlessLink');
    textarea.select();
    document.execCommand('copy');
    notify('已复制到剪贴板', 'success');
  });
}

function copyFullConfig() {
  if (!window._fullConfig) {
    notify('请先生成客户端配置', 'warning');
    return;
  }
  navigator.clipboard.writeText(window._fullConfig).then(() => {
    notify('完整配置已复制，可直接粘贴到 v2rayN 导入', 'success');
  }).catch(() => {
    // Fallback: create temporary textarea
    const ta = document.createElement('textarea');
    ta.value = window._fullConfig;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    notify('完整配置已复制', 'success');
  });
}

// ==================== Deploy ====================
async function runDeploy() {
  const btnDeploy = document.getElementById('btnDeploy');
  const deployLog = document.getElementById('deployLog');
  const logContent = document.getElementById('logContent');

  btnDeploy.disabled = true;
  btnDeploy.innerHTML = '<span class="loading"></span> 部署中...';
  deployLog.style.display = 'block';
  logContent.innerHTML = '';

  function addLog(msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;
  }

  addLog('开始部署...');

  try {
    // First connect to VPS
    addLog('连接 VPS...');
    const connResult = await window.api.ssh.connect(config.vps);
    if (!connResult.success) {
      addLog('连接失败: ' + connResult.error, 'error');
      return;
    }
    connected = true;
    updateConnectionStatus();
    addLog('VPS 连接成功', 'success');

    // Run deployment
    addLog('执行部署脚本...');
    const result = await window.api.deploy.run({
      vps: config.vps,
      iproyal: config.iproyal,
    });

    if (result.success) {
      addLog('部署完成!', 'success');

      // Save deploy info
      config.deploy = {
        uuid: result.data.uuid,
        privateKey: result.data.privateKey,
        publicKey: result.data.publicKey,
        shortId: result.data.shortId,
        vpsIP: result.data.vpsIP,
        deployed: true,
      };
      await saveConfig();

      addLog(`UUID: ${result.data.uuid}`, 'info');
      addLog(`PublicKey: ${result.data.publicKey}`, 'info');
      addLog(`ShortId: ${result.data.shortId}`, 'info');

      // Show steps
      if (result.data.steps) {
        result.data.steps.forEach(step => {
          addLog(`[${step.name}] ${step.result.success ? '✓' : '✗'}`, step.result.success ? 'success' : 'error');
        });
      }

      notify('部署成功!', 'success');
      updateClientPage();
    } else {
      addLog('部署失败: ' + result.error, 'error');
      if (result.steps) {
        result.steps.forEach(step => {
          addLog(`[${step.name}] ${step.result.success ? '✓' : '✗'}`, step.result.success ? 'success' : 'error');
        });
      }
      notify('部署失败', 'error');
    }
  } catch (error) {
    addLog('部署异常: ' + (error.message || error), 'error');
    notify('部署异常', 'error');
  } finally {
    btnDeploy.disabled = false;
    btnDeploy.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      开始部署
    `;
  }
}

// ==================== Notification ====================
function notify(message, type = 'info') {
  const el = document.getElementById('notification');
  const text = document.getElementById('notificationText');
  text.textContent = message;
  el.className = `notification show ${type}`;

  setTimeout(() => {
    el.className = 'notification';
  }, 3000);
}
