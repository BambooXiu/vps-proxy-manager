const assert = require('assert');

const {
  createServerConfig,
  generateClientConfig,
  generateOptimizeScript,
  RECOMMENDED_POLICY,
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

testClientMuxDisabled();
testServerPolicyForLongLivedConnections();
testOptimizeScriptUsesPythonJsonParsing();
testRealitySniChanged();

console.log('config generation tests passed');
