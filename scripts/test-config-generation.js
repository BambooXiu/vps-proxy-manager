const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  createServerConfig,
  generateClientConfig,
  generateOptimizeScript,
  RECOMMENDED_POLICY,
  TIGER_PROXY_DOMAINS,
} = require('../src/lib/xray-config');

const sample = {
  vpsIP: '203.0.113.10',
  uuid: '11111111-1111-4111-8111-111111111111',
  privateKey: 'sample-private-key',
  publicKey: 'sample-public-key',
  shortId: '0123456789abcdef',
  iproyal: {
    address: 'proxy.example.test',
    port: '12345',
    username: 'user',
    password: 'pass',
  },
};

function getProxyOutbound(config) {
  return config.outbounds.find((outbound) => outbound.tag === 'proxy');
}

function testClientMuxDisabled() {
  const generated = generateClientConfig(sample);
  const fullConfig = JSON.parse(generated.fullConfig);
  const proxy = getProxyOutbound(fullConfig);

  assert.strictEqual(proxy.protocol, 'vless');
  assert.deepStrictEqual(proxy.mux, { enabled: false, concurrency: -1 });
  assert.strictEqual(generated.manual.mux.enabled, false);
  assert.match(generated.manual.mux.note, /关闭/);
}

function testServerPolicyForLongLivedConnections() {
  const iproyalConfig = createServerConfig({
    mode: 'iproyal',
    uuid: sample.uuid,
    privateKey: sample.privateKey,
    shortId: sample.shortId,
    iproyal: sample.iproyal,
  });

  assert.deepStrictEqual(iproyalConfig.policy.levels['0'], RECOMMENDED_POLICY);
  assert.strictEqual(iproyalConfig.observatory, undefined);
  assert.deepStrictEqual(
    iproyalConfig.inbounds[0].streamSettings.sockopt,
    { tcpFastOpen: true, mark: 0, tcpKeepAliveInterval: 30 }
  );
}

function testOptimizeScriptUsesPythonJsonParsing() {
  const script = generateOptimizeScript();

  assert.match(script, /json\.loads/);
  assert.match(script, /CONFIG = '\/usr\/local\/etc\/xray\/config\.json'/);
  assert.match(script, /MODES_DIR = '\/usr\/local\/etc\/xray\/modes'/);
  assert.doesNotMatch(script, /POLICY = \\{[^\\n]*false/);
}

function testRealitySniChanged() {
  const iproyalConfig = createServerConfig({
    mode: 'iproyal',
    uuid: sample.uuid,
    privateKey: sample.privateKey,
    shortId: sample.shortId,
    iproyal: sample.iproyal,
  });

  const reality = iproyalConfig.inbounds[0].streamSettings.realitySettings;
  assert.strictEqual(reality.dest, 'www.apple.com:443');
  assert.deepStrictEqual(reality.serverNames, ['www.apple.com', 'apple.com']);

  const generated = generateClientConfig(sample);
  const fullConfig = JSON.parse(generated.fullConfig);
  const proxy = getProxyOutbound(fullConfig);
  assert.strictEqual(proxy.streamSettings.realitySettings.serverName, 'www.apple.com');
  assert.match(generated.vlessLink, /sni=www\.apple\.com/);
  assert.strictEqual(generated.manual.sni, 'www.apple.com');
}

function testPackageLockVersionMatchesPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));

  assert.strictEqual(packageLock.version, packageJson.version);
  assert.strictEqual(packageLock.packages[''].version, packageJson.version);
}

function testClientImportNoteExplainsRoutingRequiresFullConfig() {
  const generated = generateClientConfig(sample);

  assert.match(generated.clientImportNote, /完整配置/);
  assert.match(generated.clientImportNote, /微信直连/);
  assert.match(generated.clientImportNote, /二维码|VLESS/);
}

function testClientFullConfigRoutesDnsThroughDnsOutbound() {
  const generated = generateClientConfig(sample);
  const fullConfig = JSON.parse(generated.fullConfig);
  const dnsOutbound = fullConfig.outbounds.find((outbound) => outbound.tag === 'dns-out');

  assert.ok(dnsOutbound, 'full client config should include a dns-out outbound');
  assert.strictEqual(dnsOutbound.protocol, 'dns');
  assert.deepStrictEqual(fullConfig.routing.rules[0], {
    type: 'field',
    port: '53',
    outboundTag: 'dns-out',
  });
  assert.strictEqual(fullConfig.dns.queryStrategy, 'UseIPv4');
  assert.ok(
    fullConfig.dns.servers.some((server) => (
      server.address === '223.5.5.5' &&
      server.outboundTag === 'direct' &&
      server.domains.includes('domain:weixin.qq.com')
    )),
    'WeChat DNS should use a direct domestic DNS server'
  );
  assert.ok(
    fullConfig.dns.servers.some((server) => (
      server.address === '8.8.8.8' &&
      server.outboundTag === 'proxy' &&
      server.domains.includes('geosite:geolocation-!cn')
    )),
    'foreign DNS should use the proxy path'
  );
}

function testClientFullConfigKeepsExplicitDirectRulesBeforeProxyRules() {
  const generated = generateClientConfig(sample);
  const fullConfig = JSON.parse(generated.fullConfig);
  const rules = fullConfig.routing.rules;
  const wechatDomainIndex = rules.findIndex((rule) => (
    rule.outboundTag === 'direct' &&
    rule.domain &&
    rule.domain.includes('domain:weixin.qq.com') &&
    rule.domain.includes('domain:tencent.com') &&
    !rule.domain.includes('geosite:cn')
  ));
  const privateIpIndex = rules.findIndex((rule) => (
    rule.outboundTag === 'direct' &&
    rule.ip &&
    rule.ip.includes('geoip:private') &&
    !rule.ip.includes('geoip:cn')
  ));
  const udp443BlockIndex = rules.findIndex((rule) => (
    rule.outboundTag === 'block' &&
    rule.port === '443' &&
    rule.network === 'udp'
  ));
  const openAiProxyIndex = rules.findIndex((rule) => (
    rule.outboundTag === 'proxy' &&
    rule.domain &&
    rule.domain.includes('domain:openai.com')
  ));
  const foreignProxyIndex = rules.findIndex((rule) => (
    rule.outboundTag === 'proxy' &&
    rule.domain &&
    rule.domain.includes('geosite:geolocation-!cn')
  ));

  assert.strictEqual(fullConfig.outbounds[0].tag, 'proxy', 'unmatched traffic should default to the proxy outbound');
  assert.ok(wechatDomainIndex > 0, 'explicit WeChat/Tencent domain direct rule should exist after DNS routing');
  assert.ok(privateIpIndex > wechatDomainIndex, 'private IP direct rule should follow the domain direct rule');
  assert.ok(udp443BlockIndex > privateIpIndex, 'UDP 443 block should not preempt explicit direct rules');
  assert.ok(openAiProxyIndex > udp443BlockIndex, 'OpenAI proxy rule should stay after direct and UDP block rules');
  assert.ok(foreignProxyIndex > openAiProxyIndex, 'foreign proxy rule should stay after OpenAI proxy rule');
  assert.deepStrictEqual(rules[privateIpIndex].ip, ['geoip:private']);
  assert.ok(
    rules.every((rule) => !rule.domain || !rule.domain.includes('geosite:cn')),
    'full client config should not broadly direct all China domains'
  );
  assert.ok(
    rules.every((rule) => !rule.ip || !rule.ip.includes('geoip:cn')),
    'full client config should not broadly direct all China IPs'
  );
  assert.ok(
    fullConfig.dns.servers.some((server) => (
      server.address === '8.8.8.8' &&
      server.outboundTag === 'proxy' &&
      !server.domains
    )),
    'unmatched DNS queries should use a proxy-routed overseas DNS server'
  );
}

function testTigerDomainsUseClientProxyBeforeDomesticDirectRules() {
  const expectedTigerDomains = [
    'domain:itiger.com',
    'domain:itigerup.com',
    'domain:laohu8.com',
    'domain:tigerbbs.com',
    'domain:itigergrowtha.com',
    'domain:tigerfintech.com',
    'domain:tigerbrokers.com',
    'domain:tigerbrokers.com.sg',
    'domain:tigerbrokers.com.au',
    'domain:tigerbrokers.nz',
    'domain:tigertrade.app',
    'domain:tigeresop.com',
  ];
  assert.deepStrictEqual(TIGER_PROXY_DOMAINS, expectedTigerDomains);

  const generated = generateClientConfig(sample);
  const fullConfig = JSON.parse(generated.fullConfig);
  assert.ok(
    fullConfig.dns.servers.some((server) => (
      server.address === '8.8.8.8' &&
      server.outboundTag === 'proxy' &&
      server.domains.includes('domain:itiger.com')
    )),
    'Tiger Brokers DNS should use a proxy-routed overseas DNS server'
  );

  const clientRules = fullConfig.routing.rules;
  const tigerClientIndex = clientRules.findIndex((rule) => (
    rule.outboundTag === 'proxy' &&
    rule.domain &&
    rule.domain.includes('domain:itiger.com') &&
    rule.domain.includes('domain:laohu8.com') &&
    rule.domain.includes('domain:tigerbrokers.com.au')
  ));
  const wechatClientIndex = clientRules.findIndex((rule) => (
    rule.outboundTag === 'direct' &&
    rule.domain &&
    rule.domain.includes('domain:weixin.qq.com')
  ));

  assert.ok(tigerClientIndex > 0, 'Tiger Brokers proxy rule should exist after DNS routing');
  assert.ok(
    tigerClientIndex < wechatClientIndex,
    'Tiger Brokers proxy rule should preempt domestic direct rules'
  );
}

function testTigerDomainsDoNotRequireServerRoutingChanges() {
  const serverConfig = createServerConfig({
    mode: 'iproyal',
    uuid: sample.uuid,
    privateKey: sample.privateKey,
    shortId: sample.shortId,
    iproyal: sample.iproyal,
  });

  assert.ok(
    serverConfig.routing.rules.some((rule) => (
      rule.outboundTag === 'proxy' &&
      rule.inboundTag &&
      rule.inboundTag.includes('vless-in')
    )),
    'server should keep the existing catch-all proxy rule for VLESS inbound traffic'
  );
  assert.ok(
    serverConfig.routing.rules.every((rule) => (
      !rule.domain || !rule.domain.includes('domain:itiger.com')
    )),
    'Tiger Brokers should not require a dedicated server-side routing rule'
  );

  const script = generateOptimizeScript();
  assert.doesNotMatch(script, /TIGER_PROXY_DOMAINS/);
  assert.doesNotMatch(script, /tiger_rule/);
}

function testOptimizeScriptDoesNotModifyServerRoutingForWechat() {
  const script = generateOptimizeScript();

  assert.doesNotMatch(script, /WECHAT_DIRECT_DOMAINS/);
  assert.doesNotMatch(script, /wechat_rule/);
  assert.doesNotMatch(script, /微信直连/);
}

function testOptimizeScriptKeepsServerRoutingStrategyMinimal() {
  const script = generateOptimizeScript();

  assert.match(script, /routing\['domainStrategy'\] = 'AsIs'/);
  assert.doesNotMatch(script, /domainMatcher/);
}

function testGuideExplainsFullJsonImportWorkflow() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const visibleText = html.replace(/<[^>]+>/g, ' ');

  assert.match(visibleText, /重新生成配置/);
  assert.match(visibleText, /复制完整配置/);
  assert.match(visibleText, /微信直连和 DNS 优化/);
  assert.match(visibleText, /保存为.*\.json/);
  assert.match(visibleText, /发送到手机/);
  assert.match(visibleText, /电脑.*本地导入/);
  assert.match(visibleText, /手机.*本地导入/);
  assert.match(visibleText, /v2rayN/);
  assert.match(visibleText, /v2rayNG/);
}

function testFaqExplainsWechatAndDomesticSlowAccess() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const visibleText = html.replace(/<[^>]+>/g, ' ');

  assert.match(visibleText, /微信或国内访问慢怎么办/);
  assert.match(visibleText, /不要只扫描二维码或导入 VLESS 链接/);
  assert.match(visibleText, /重新生成配置/);
  assert.match(visibleText, /复制完整配置/);
  assert.match(visibleText, /完整 JSON/);
  assert.match(visibleText, /v2rayN\/v2rayNG/);
  assert.match(visibleText, /本地导入/);
  assert.match(visibleText, /微信直连和 DNS 优化/);
}

async function testClientRegenerateFailureDoesNotReportSuccess() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'client.js'), 'utf8');
  const notifications = [];
  const elements = new Map();

  function createElement(id) {
    return {
      id,
      style: {},
      value: '',
      innerHTML: '',
      listeners: {},
      addEventListener(event, handler) {
        this.listeners[event] = handler;
      },
      getContext() {
        return { drawImage() {} };
      },
      appendChild() {},
      removeChild() {},
      select() {},
    };
  }

  [
    'btnCopyLink',
    'btnCopyFullConfig',
    'btnRegenerateConfig',
    'vlessLink',
    'qrSection',
    'configSection',
    'configTableBody',
    'qrCanvas',
    'clientImportHint',
  ].forEach((id) => elements.set(id, createElement(id)));

  const infoBox = createElement('infoBox');
  const context = {
    window: {
      App: {
        notify(message, type) {
          notifications.push({ message, type });
        },
      },
      api: {
        client: {
          generateConfig: async () => ({ success: false, error: 'boom' }),
        },
        qrcode: {
          generate: async () => ({ success: false }),
        },
      },
    },
    document: {
      getElementById(id) {
        return elements.get(id) || createElement(id);
      },
      querySelector(selector) {
        return selector === '.client-info-box' ? infoBox : null;
      },
      createElement,
      body: createElement('body'),
    },
    navigator: { clipboard: { writeText: async () => {} } },
    console: { error() {}, log() {} },
    Image: function Image() {},
  };
  context.App = context.window.App;

  vm.runInNewContext(source, context, { filename: 'client.js' });
  context.window.App.client.init();
  context.window.App.client.updateClientPage({
    deploy: {
      deployed: true,
      vpsIP: sample.vpsIP,
      uuid: sample.uuid,
      publicKey: sample.publicKey,
      shortId: sample.shortId,
    },
  });

  await elements.get('btnRegenerateConfig').listeners.click();

  assert.ok(
    notifications.some((notification) => notification.type === 'error' && notification.message.includes('boom')),
    'regenerate failure should surface the IPC error'
  );
  assert.ok(
    notifications.every((notification) => notification.type !== 'success'),
    'regenerate failure must not show a success notification'
  );
}

function createDashboardElement(id) {
  const selectorChildren = new Map();
  const classNames = new Set();

  const element = {
    id,
    style: {},
    textContent: '',
    disabled: false,
    listeners: {},
    className: '',
    classList: {
      add(className) {
        classNames.add(className);
      },
      remove(className) {
        classNames.delete(className);
      },
      toggle(className, force) {
        if (force) {
          classNames.add(className);
        } else {
          classNames.delete(className);
        }
      },
      contains(className) {
        return classNames.has(className);
      },
    },
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
    querySelector(selector) {
      if (!selectorChildren.has(selector)) {
        selectorChildren.set(selector, createDashboardElement(`${id}:${selector}`));
      }
      return selectorChildren.get(selector);
    },
  };

  return element;
}

function createDashboardTestContext(apiOverrides = {}) {
  const elements = new Map();
  [
    'connectionStatus',
    'btnRefresh',
    'dashConnectionState',
    'dashCurrentMode',
    'dashExitIP',
    'btnModeIproyal',
    'btnModeDirect',
    'btnVerifyIP',
    'btnCheckXray',
  ].forEach((id) => elements.set(id, createDashboardElement(id)));

  const api = {
    ssh: {
      connect: async () => ({ success: true }),
      onStatusChange() {},
    },
    xray: {
      status: async () => ({ success: true, data: 'active\nenabled' }),
      currentMode: async () => ({ success: true, data: 'socks' }),
      verifyIp: async () => ({ success: true, data: '203.0.113.10' }),
      verifyIproyal: async () => ({ success: true, data: '198.51.100.20' }),
      switchMode: async () => ({ success: true }),
    },
  };

  if (apiOverrides.xray) {
    api.xray = { ...api.xray, ...apiOverrides.xray };
  }
  if (apiOverrides.ssh) {
    api.ssh = { ...api.ssh, ...apiOverrides.ssh };
  }

  const notifications = [];
  const context = {
    window: {
      App: {
        notify(message, type) {
          notifications.push({ message, type });
        },
      },
      api,
    },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createDashboardElement(id));
        return elements.get(id);
      },
    },
    console: { error() {}, log() {} },
  };
  context.App = context.window.App;

  return { context, elements, notifications };
}

async function testDashboardShowsConfiguredIspExitIpForProxyMode() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'dashboard.js'), 'utf8');
  const calls = { verifyIp: 0, verifyIproyal: 0 };
  const { context, elements } = createDashboardTestContext({
    xray: {
      currentMode: async () => ({ success: true, data: 'socks' }),
      verifyIp: async () => {
        calls.verifyIp++;
        return { success: true, data: sample.vpsIP };
      },
      verifyIproyal: async (config) => {
        calls.verifyIproyal++;
        assert.deepStrictEqual(config, sample.iproyal);
        return { success: true, data: sample.iproyal.address };
      },
    },
  });

  vm.runInNewContext(source, context, { filename: 'dashboard.js' });
  await context.window.App.dashboard.refreshDashboard({
    vps: { host: sample.vpsIP, port: '22', username: 'root' },
    iproyal: sample.iproyal,
  });

  assert.strictEqual(calls.verifyIproyal, 1);
  assert.strictEqual(calls.verifyIp, 0);
  assert.strictEqual(elements.get('dashCurrentMode').textContent, 'ISP 代理');
  assert.strictEqual(elements.get('dashExitIP').textContent, sample.iproyal.address);
  assert.strictEqual(
    elements.get('btnModeIproyal').querySelector('.mode-desc').textContent,
    `出口 ${sample.iproyal.address}`
  );
}

function testVisibleCopyUsesGenericIspProxy() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const visibleText = html.replace(/<[^>]+>/g, ' ');

  assert.doesNotMatch(visibleText, /IPRoyal/);
  assert.doesNotMatch(visibleText, /194\.50\.146\.79/);
  assert.match(visibleText, /ISP 代理/);
}

function testBrandingAndVersionAreGenericNovaBit() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const visibleText = html.replace(/<[^>]+>/g, ' ');

  assert.strictEqual(packageJson.name, 'novabit-proxy');
  assert.strictEqual(packageJson.version, '1.2.5');
  assert.strictEqual(packageLock.name, packageJson.name);
  assert.strictEqual(packageLock.version, packageJson.version);
  assert.strictEqual(packageLock.packages[''].name, packageJson.name);
  assert.strictEqual(packageLock.packages[''].version, packageJson.version);

  assert.strictEqual(packageJson.build.productName, 'NovaBit Proxy');
  assert.strictEqual(packageJson.build.mac.icon, 'assets/novabit-proxy-icon.icns');
  assert.strictEqual(packageJson.build.dmg.title, 'NovaBit Proxy');
  assert.strictEqual(packageJson.build.nsis.shortcutName, 'NovaBit Proxy');

  assert.match(html, /<title>NovaBit Proxy<\/title>/);
  assert.match(visibleText, /NovaBit Proxy v1\.2\.5/);
  assert.doesNotMatch(visibleText, /修之竹|之竹Proxy|VPS Proxy|RackNerd|46\.203\.164\.88|204\.44\.87\.159/);
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'assets', 'novabit-proxy-icon.icns')),
    'macOS icon file should exist for electron-builder'
  );
}

function testPublicSurfacesDoNotExposeLegacyBrandingOrConcreteProviderInfo() {
  const publicFiles = [
    'README.md',
    'build.sh',
    'src/index.html',
    'index.html',
  ].filter((file) => fs.existsSync(path.join(__dirname, '..', file)));
  const forbidden = /修之竹|之竹Proxy|VPS Proxy Manager|VPS Proxy\b|RackNerd|IPRoyal|194\.50\.146\.79|46\.203\.164\.88|204\.44\.87\.159|v1\.0\.0/;

  for (const file of publicFiles) {
    const rawText = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const text = file.endsWith('.html') ? rawText.replace(/<[^>]+>/g, ' ') : rawText;
    assert.doesNotMatch(text, forbidden, `${file} should not expose legacy branding or concrete provider details`);
  }
}

function testMacIconSourceHasTransparentCanvas() {
  const iconPath = path.join(__dirname, '..', 'assets', 'novabit-proxy-icon-1024.png');
  const output = execFileSync('sips', ['-g', 'hasAlpha', iconPath], { encoding: 'utf8' });

  assert.match(output, /hasAlpha: yes/, 'macOS icon source should have transparent corners');
}

async function runTests() {
  const tests = [
    testClientMuxDisabled,
    testServerPolicyForLongLivedConnections,
    testOptimizeScriptUsesPythonJsonParsing,
    testRealitySniChanged,
    testPackageLockVersionMatchesPackageVersion,
    testClientImportNoteExplainsRoutingRequiresFullConfig,
    testClientFullConfigRoutesDnsThroughDnsOutbound,
    testClientFullConfigKeepsExplicitDirectRulesBeforeProxyRules,
    testTigerDomainsUseClientProxyBeforeDomesticDirectRules,
    testTigerDomainsDoNotRequireServerRoutingChanges,
    testOptimizeScriptDoesNotModifyServerRoutingForWechat,
    testOptimizeScriptKeepsServerRoutingStrategyMinimal,
    testGuideExplainsFullJsonImportWorkflow,
    testFaqExplainsWechatAndDomesticSlowAccess,
    testClientRegenerateFailureDoesNotReportSuccess,
    testDashboardShowsConfiguredIspExitIpForProxyMode,
    testVisibleCopyUsesGenericIspProxy,
    testBrandingAndVersionAreGenericNovaBit,
    testPublicSurfacesDoNotExposeLegacyBrandingOrConcreteProviderInfo,
    testMacIconSourceHasTransparentCanvas,
  ];
  const failures = [];

  for (const test of tests) {
    try {
      await test();
    } catch (error) {
      failures.push({ name: test.name, error });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAILED ${failure.name}`);
      console.error(failure.error);
    }
    process.exitCode = 1;
    return;
  }

  console.log('config generation tests passed');
}

runTests();
