const fs = require('fs');
const path = require('path');
const os = require('os');

class ConfigManager {
  constructor() {
    this.configDir = path.join(os.homedir(), '.vps-proxy-manager');
    this.configFile = path.join(this.configDir, 'config.json');
    this.config = null;
  }

  ensureDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  load() {
    try {
      this.ensureDir();
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf-8');
        this.config = JSON.parse(data);
        return { success: true, data: this.config };
      }
      return { success: true, data: this.getDefault() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  save(config) {
    try {
      this.ensureDir();
      this.config = config;
      fs.writeFileSync(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  getDefault() {
    return {
      vps: {
        host: '',
        port: '22',
        username: 'root',
        password: '',
        privateKey: '',
      },
      iproyal: {
        address: '',
        port: '',
        username: '',
        password: '',
      },
      deploy: {
        uuid: '',
        privateKey: '',
        publicKey: '',
        shortId: '',
        vpsIP: '',
        deployed: false,
      },
    };
  }
}

module.exports = { ConfigManager };
