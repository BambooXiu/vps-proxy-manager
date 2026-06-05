const { Client } = require('ssh2');

class SSHManager {
  constructor() {
    this.conn = null;
    this.connected = false;
  }

  async connect(config) {
    return new Promise((resolve) => {
      if (this.conn) {
        this.conn.end();
      }

      this.conn = new Client();

      this.conn.on('ready', () => {
        this.connected = true;
        resolve({ success: true });
      });

      this.conn.on('error', (err) => {
        this.connected = false;
        resolve({ success: false, error: err.message });
      });

      this.conn.on('close', () => {
        this.connected = false;
      });

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
    if (this.conn) {
      this.conn.end();
      this.conn = null;
      this.connected = false;
    }
  }

  isConnected() {
    return this.connected;
  }
}

module.exports = { SSHManager };
