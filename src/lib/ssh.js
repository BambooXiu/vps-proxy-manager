const { Client } = require('ssh2');

class SSHManager {
  constructor() {
    this.conn = null;
    this.connected = false;
    this.config = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 2000;
    this.onStatusChange = null;
    this.isReconnecting = false;
  }

  setStatus(status, message = '') {
    if (this.onStatusChange) {
      this.onStatusChange({ status, message });
    }
  }

  async connect(config) {
    return new Promise((resolve) => {
      if (this.conn) {
        this.conn.end();
      }

      this.config = config;
      this.conn = new Client();

      this.conn.on('ready', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.setStatus('connected', '已连接');
        resolve({ success: true });
      });

      this.conn.on('error', (err) => {
        this.connected = false;
        this.setStatus('error', err.message);
        if (!this.isReconnecting) {
          resolve({ success: false, error: err.message });
        }
      });

      this.conn.on('close', () => {
        this.connected = false;
        if (!this.isReconnecting) {
          this.setStatus('disconnected', '连接断开');
          this.tryReconnect();
        }
      });

      this.setStatus('connecting', '连接中...');

      const connConfig = {
        host: config.host,
        port: parseInt(config.port) || 22,
        username: config.username,
        readyTimeout: 10000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };

      if (config.privateKey) {
        connConfig.privateKey = config.privateKey;
      } else if (config.password) {
        connConfig.password = config.password;
      }

      this.conn.connect(connConfig);
    });
  }

  async tryReconnect() {
    if (!this.config || this.isReconnecting) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus('failed', '重连失败，请手动刷新');
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.setStatus('reconnecting', `重连中 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));

    try {
      await this.connect(this.config);
    } catch (error) {
      this.isReconnecting = false;
      this.tryReconnect();
    }
  }

  async testConnection(config) {
    try {
      const connResult = await this.connect(config);
      if (!connResult.success) {
        return { success: false, error: connResult.error || 'Connection failed' };
      }
      const result = await this.exec('echo "connected" && uname -a');
      this.disconnect();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message || error.error || 'Connection failed' };
    }
  }

  async exec(command) {
    return new Promise((resolve) => {
      if (!this.conn || !this.connected) {
        resolve({ success: false, data: '', error: 'Not connected' });
        return;
      }

      this.conn.exec(command, (err, stream) => {
        if (err) {
          resolve({ success: false, data: '', error: err.message });
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        stream.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true, data: stdout.trim() });
          } else {
            resolve({ success: false, data: stdout.trim(), error: stderr.trim() });
          }
        });
      });
    });
  }

  disconnect() {
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    if (this.conn) {
      this.conn.end();
      this.conn = null;
      this.connected = false;
      this.setStatus('disconnected', '已断开');
    }
  }

  isConnected() {
    return this.connected;
  }
}

module.exports = { SSHManager };
