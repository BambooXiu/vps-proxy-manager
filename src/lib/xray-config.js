const RECOMMENDED_POLICY = {
  handshake: 12,
  connIdle: 900,
  uplinkOnly: 5,
  downlinkOnly: 10,
  statsUserUplink: false,
  statsUserDownlink: false,
  bufferSize: 512,
};

const OPENAI_PROXY_DOMAINS = [
  'domain:openai.com',
  'domain:chatgpt.com',
  'domain:oaistatic.com',
  'domain:oaiusercontent.com',
];

function createInbound({ uuid, privateKey, shortId }) {
  return {
    tag: 'vless-in',
    listen: '0.0.0.0',
    port: 443,
    protocol: 'vless',
    settings: {
      clients: [{ id: uuid, flow: 'xtls-rprx-vision' }],
      decryption: 'none',
    },
    streamSettings: {
      network: 'tcp',
      security: 'reality',
      realitySettings: {
        dest: 'www.microsoft.com:443',
        serverNames: ['www.microsoft.com', 'microsoft.com'],
        privateKey,
        shortIds: [shortId],
      },
      sockopt: { tcpFastOpen: true, mark: 0, tcpKeepAliveInterval: 30 },
    },
    sniffing: { enabled: true, destOverride: ['http', 'tls'] },
  };
}

function createDns() {
  return {
    servers: [
      { address: 'https://8.8.8.8/dns-query', outboundTag: 'proxy' },
      { address: 'https://1.1.1.1/dns-query', outboundTag: 'proxy' },
    ],
  };
}

function createProxyOutbound(mode, iproyal) {
  if (mode === 'direct') {
    return { tag: 'proxy', protocol: 'freedom' };
  }

  return {
    tag: 'proxy',
    protocol: 'socks',
    settings: {
      servers: [{
        address: iproyal.address,
        port: parseInt(iproyal.port, 10),
        users: [{ user: iproyal.username, pass: iproyal.password }],
      }],
    },
  };
}

function createServerConfig({ mode, uuid, privateKey, shortId, iproyal }) {
  return {
    log: {
      loglevel: 'warning',
      access: '/var/log/xray/access.log',
      error: '/var/log/xray/error.log',
    },
    dns: createDns(),
    inbounds: [createInbound({ uuid, privateKey, shortId })],
    outbounds: [
      createProxyOutbound(mode, iproyal),
      { tag: 'block', protocol: 'blackhole' },
      { tag: 'direct', protocol: 'freedom' },
    ],
    policy: {
      levels: { '0': RECOMMENDED_POLICY },
      system: { statsInboundUplink: false, statsInboundDownlink: false },
    },
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
        { type: 'field', protocol: ['bittorrent'], outboundTag: 'block' },
        { type: 'field', domain: OPENAI_PROXY_DOMAINS, outboundTag: 'proxy' },
        { type: 'field', inboundTag: ['vless-in'], outboundTag: 'proxy' },
      ],
    },
  };
}

function generateClientConfig({ vpsIP, uuid, publicKey, shortId }) {
  const vlessLink = `vless://${uuid}@${vpsIP}:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=${publicKey}&sid=${shortId}&type=tcp#VPS-Proxy-NoMUX`;

  const fullConfig = JSON.stringify({
    log: { loglevel: 'warning' },
    dns: {
      servers: [
        { address: 'https://8.8.8.8/dns-query', domains: ['geosite:geolocation-!cn'] },
        { address: 'https://223.5.5.5/dns-query', domains: ['geosite:cn'] },
      ],
    },
    inbounds: [
      {
        tag: 'socks',
        port: 10808,
        listen: '127.0.0.1',
        protocol: 'socks',
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
        settings: { auth: 'noauth', udp: true },
      },
      {
        tag: 'http',
        port: 10809,
        listen: '127.0.0.1',
        protocol: 'http',
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
        settings: { auth: 'noauth', udp: true },
      },
    ],
    outbounds: [
      {
        tag: 'proxy',
        protocol: 'vless',
        settings: {
          vnext: [{
            address: vpsIP,
            port: 443,
            users: [{
              id: uuid,
              alterId: 0,
              email: 't@t.tt',
              security: 'auto',
              encryption: 'none',
              flow: 'xtls-rprx-vision',
            }],
          }],
        },
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            show: false,
            fingerprint: 'chrome',
            serverName: 'www.microsoft.com',
            publicKey,
            shortId,
            spiderX: '',
          },
          sockopt: { tcpFastOpen: true, tcpKeepAliveInterval: 30 },
        },
        mux: { enabled: false, concurrency: -1 },
      },
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'block', protocol: 'blackhole', settings: {} },
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        { type: 'field', inboundTag: ['api'], outboundTag: 'api' },
        { type: 'field', outboundTag: 'direct', domain: ['domain:alidns.com', 'domain:doh.pub', 'domain:dot.pub', 'domain:360.cn', 'domain:onedns.net'] },
        { type: 'field', outboundTag: 'direct', ip: ['223.5.5.5', '223.6.6.6', '2400:3200::1', '2400:3200:baba::1', '119.29.29.29', '1.12.12.12', '120.53.53.53', '2402:4e00::', '2402:4e00:1::', '180.76.76.76', '2400:da00::6666', '114.114.114.114', '114.114.115.115', '114.114.114.119', '114.114.115.119', '114.114.114.110', '114.114.115.110', '180.184.1.1', '180.184.2.2', '101.226.4.6', '218.30.118.6', '123.125.81.6', '140.207.198.6', '1.2.4.8', '210.2.4.8', '52.80.66.66', '117.50.22.22', '2400:7fc0:849e:200::4', '2404:c2c0:85d8:901::4', '117.50.10.10', '52.80.52.52', '2400:7fc0:849e:200::8', '2404:c2c0:85d8:901::8', '117.50.60.30', '52.80.60.30'] },
        { type: 'field', outboundTag: 'direct', ip: ['geoip:cn'] },
        { type: 'field', outboundTag: 'direct', domain: ['geosite:cn'] },
        { type: 'field', port: '443', network: 'udp', outboundTag: 'block' },
        { type: 'field', outboundTag: 'proxy', domain: OPENAI_PROXY_DOMAINS },
        { type: 'field', outboundTag: 'proxy', domain: ['geosite:geolocation-!cn'] },
      ],
    },
  }, null, 2);

  return {
    vlessLink,
    fullConfig,
    manual: {
      address: vpsIP,
      port: 443,
      protocol: 'VLESS',
      uuid,
      flow: 'xtls-rprx-vision',
      transport: 'tcp',
      security: 'reality',
      sni: 'www.microsoft.com',
      publicKey,
      shortId,
      fingerprint: 'chrome',
      mux: {
        enabled: false,
        note: '关闭 MUX；Reality + Vision 开启 MUX 会导致连接失败或长连接重连',
      },
      optimizations: {
        tcpFastOpen: true,
        sockopt: { tcpKeepAliveInterval: 30 },
      },
    },
  };
}

function generateOptimizeScript() {
  const policy = JSON.stringify(JSON.stringify(RECOMMENDED_POLICY));
  const openaiDomains = JSON.stringify(JSON.stringify(OPENAI_PROXY_DOMAINS));

  return `
python3 - <<'PY'
import json
import os

CONFIG = '/usr/local/etc/xray/config.json'
MODES_DIR = '/usr/local/etc/xray/modes'
POLICY = json.loads(${policy})
OPENAI_PROXY_DOMAINS = json.loads(${openaiDomains})

def ensure_rule(rules, rule):
    for existing in rules:
        if existing == rule:
            return
    rules.append(rule)

def optimize(path):
    if not os.path.exists(path):
        return
    with open(path) as f:
        cfg = json.load(f)

    for inbound in cfg.get('inbounds', []):
        stream_settings = inbound.setdefault('streamSettings', {})
        stream_settings['sockopt'] = {
            'tcpFastOpen': True,
            'mark': 0,
            'tcpKeepAliveInterval': 30,
        }
        inbound['sniffing'] = {'enabled': True, 'destOverride': ['http', 'tls']}

    cfg['policy'] = {
        'levels': {'0': POLICY},
        'system': {'statsInboundUplink': False, 'statsInboundDownlink': False},
    }

    cfg.pop('observatory', None)

    routing = cfg.setdefault('routing', {})
    routing['domainStrategy'] = 'AsIs'
    rules = routing.setdefault('rules', [])
    openai_rule = {'type': 'field', 'domain': OPENAI_PROXY_DOMAINS, 'outboundTag': 'proxy'}
    inbound_rule = {'type': 'field', 'inboundTag': ['vless-in'], 'outboundTag': 'proxy'}
    if inbound_rule in rules and openai_rule not in rules:
        rules.insert(rules.index(inbound_rule), openai_rule)
    else:
        ensure_rule(rules, openai_rule)

    with open(path, 'w') as f:
        json.dump(cfg, f, indent=2)
        f.write('\\n')
    print(f'optimized: {path}')

optimize(CONFIG)
if os.path.isdir(MODES_DIR):
    for filename in os.listdir(MODES_DIR):
        if filename.endswith('.json'):
            optimize(os.path.join(MODES_DIR, filename))
PY
`;
}

module.exports = {
  OPENAI_PROXY_DOMAINS,
  RECOMMENDED_POLICY,
  createServerConfig,
  generateClientConfig,
  generateOptimizeScript,
};
