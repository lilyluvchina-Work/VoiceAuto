import assert from 'node:assert/strict';
import {
  CONFIG_TYPES,
  clearConfigStore,
  getLangfuseEnvironmentMap,
  readConfig,
  saveConfig,
} from '../src/modules/config/secureConfigStore.js';

const dingTalk = readConfig(CONFIG_TYPES.DINGTALK, { includeSecrets: true });
assert.equal(dingTalk.enabled, true);
assert.equal(dingTalk.webhook.includes('access_token='), true);
assert.equal(dingTalk.secret.startsWith('SEC'), true);

const tapd = readConfig(CONFIG_TYPES.TAPD, { includeSecrets: true });
assert.equal(tapd.apiUser, 'tapd-app-a2b2d6');
assert.equal(tapd.workspaceId, '61252348');
assert.equal(tapd.companyId, '52890462');
assert.equal(tapd.enabled, true);

const langfuse = readConfig(CONFIG_TYPES.LANGFUSE, { includeSecrets: true });
assert.equal(langfuse.environments.length, 6);
assert.deepEqual(langfuse.environments.map((env) => env.label), [
  'Test-Local',
  'Prod-Local',
  'UAT-Local',
  'Test',
  'Prod',
  'UAT',
]);

const envMap = getLangfuseEnvironmentMap({ includeSecrets: true });
assert.equal(envMap.TEST_LOCAL.proxyBase, '/langfuse-api-test-local');
assert.equal(envMap.PROD_LOCAL.publicKey, 'pk-lf-3a1dc0c8-a338-4c76-a6e8-39da3469a6ff');
assert.equal(envMap.TEST.secretKey, 'sk-lf-cc8cacae-c574-409c-88dd-957cf9d50e5c');
assert.equal(envMap.UAT.publicKey, 'pk-lf-c53e278a-5ab7-4f4e-bdcb-2980996a4d84');
assert.equal(envMap.PROD.baseUrl, 'https://monitor-live-test-cedar.sdmc.tv');

const storage = {
  value: '',
  getItem() {
    return this.value;
  },
  setItem(key, value) {
    this.value = value;
  },
  removeItem() {
    this.value = '';
  },
};

clearConfigStore({ storage });
saveConfig(CONFIG_TYPES.LANGFUSE, {
  environments: [
    {
      envKey: 'TEST_LOCAL',
      label: 'Test-Local',
      proxyBase: '/langfuse-api-test-local',
      baseUrl: '',
      publicKey: '',
      secretKey: '',
      enabled: true,
    },
  ],
}, { storage });

const restored = readConfig(CONFIG_TYPES.LANGFUSE, { storage, includeSecrets: true });
assert.equal(restored.environments[0].baseUrl, 'https://monitor-live-test-cedar.sdmc.tv');
assert.equal(restored.environments[0].publicKey.startsWith('pk-lf-'), true);
assert.equal(restored.environments[0].secretKey.startsWith('sk-lf-'), true);
