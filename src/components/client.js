// ==================== Client Component ====================

window.App = window.App || {};

(function() {
  let _fullConfig = null;

  function updateClientPage(config) {
    const infoBox = document.querySelector('.client-info-box');
    const qrSection = document.getElementById('qrSection');
    const configSection = document.getElementById('configSection');

    if (config.deploy.deployed) {
      infoBox.style.display = 'none';
      qrSection.style.display = 'block';
      configSection.style.display = 'block';
      generateClientConfig(config);
    } else {
      infoBox.style.display = 'flex';
      qrSection.style.display = 'none';
      configSection.style.display = 'none';
    }
  }

  async function generateClientConfig(config) {
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
        await generateQRCode(result.vlessLink);

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
          <tr><td>MUX</td><td>${m.mux.enabled ? '开启' : (m.mux.note || '关闭')}</td></tr>
          <tr><td>TCP FastOpen</td><td>开启</td></tr>
          <tr><td>KeepAlive</td><td>30s</td></tr>
        `;

        _fullConfig = result.fullConfig;
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
      App.notify('已复制到剪贴板', 'success');
    }).catch(() => {
      const textarea = document.getElementById('vlessLink');
      textarea.select();
      document.execCommand('copy');
      App.notify('已复制到剪贴板', 'success');
    });
  }

  function copyFullConfig() {
    if (!_fullConfig) {
      App.notify('请先生成客户端配置', 'warning');
      return;
    }
    navigator.clipboard.writeText(_fullConfig).then(() => {
      App.notify('完整配置已复制，可直接粘贴到 v2rayN 导入', 'success');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = _fullConfig;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      App.notify('完整配置已复制', 'success');
    });
  }

  function init() {
    document.getElementById('btnCopyLink').addEventListener('click', copyVLESSLink);
    document.getElementById('btnCopyFullConfig').addEventListener('click', copyFullConfig);
  }

  window.App.client = { init, updateClientPage };
})();
