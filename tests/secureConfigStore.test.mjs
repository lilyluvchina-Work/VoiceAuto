import assert from 'node:assert/strict';
import {
  CONFIG_TYPES,
  getConfigStatus,
  getLangfuseEnvironmentMap,
  maskSensitiveValue,
  readConfig,
  saveConfig,
} from '../src/modules/config/secureConfigStore.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return Array.from(map.values()).join('\n');
    },
  };
}

assert.equal(maskSensitiveValue('sk-lf-1234567890'), 'sk-lf-****7890');
assert.equal(maskSensitiveValue('abc'), '****');
assert.equal(maskSensitiveValue(''), '');

{
  const storage = createMemoryStorage();
  saveConfig(CONFIG_TYPES.LANGFUSE, {
    envKey: 'UAT',
    label: 'UAT',
    proxyBase: '/langfuse-api-uat',
    publicKey: 'pk-lf-secret-public',
    secretKey: 'sk-lf-secret-value',
    projectId: 'project-sensitive',
    enabled: true,
  }, { storage, actor: 'admin' });

  const rawStorage = storage.dump();
  assert.equal(rawStorage.includes('pk-lf-secret-public'), false);
  assert.equal(rawStorage.includes('sk-lf-secret-value'), false);
  assert.equal(rawStorage.includes('project-sensitive'), false);

  const masked = readConfig(CONFIG_TYPES.LANGFUSE, { storage });
  assert.equal(masked.publicKey, 'pk-lf-****blic');
  assert.equal(masked.secretKey, 'sk-lf-****alue');
  assert.equal(masked.projectId, 'projec****tive');
  assert.equal(masked.hasSecrets, true);

  const plain = readConfig(CONFIG_TYPES.LANGFUSE, { storage, includeSecrets: true });
  assert.equal(plain.publicKey, 'pk-lf-secret-public');
  assert.equal(plain.secretKey, 'sk-lf-secret-value');
  assert.equal(plain.projectId, 'project-sensitive');
}

{
  const storage = createMemoryStorage();
  assert.equal(getConfigStatus(CONFIG_TYPES.TAPD, { storage }).complete, true);
  saveConfig(CONFIG_TYPES.TAPD, {
    configName: 'Cedar TAPD',
    baseUrl: 'https://api.tapd.cn',
    workspaceId: '61252348',
    companyId: 'company_xxxx',
    apiUser: 'api_user_xxxx',
    apiPassword: 'api_password_xxxx',
    enabled: true,
  }, { storage });

  const status = getConfigStatus(CONFIG_TYPES.TAPD, { storage });
  assert.equal(status.complete, true);
  assert.deepEqual(status.missingRequiredFields, []);
}

{
  const storage = createMemoryStorage();
  saveConfig(CONFIG_TYPES.LANGFUSE, {
    envKey: 'CUSTOM',
    label: 'Custom Env',
    proxyBase: '/langfuse-api-custom',
    publicKey: 'pk-custom',
    secretKey: 'sk-custom',
    enabled: true,
  }, { storage });

  const envMap = getLangfuseEnvironmentMap({ storage, includeSecrets: true });
  assert.equal(envMap.CUSTOM.label, 'Custom Env');
  assert.equal(envMap.CUSTOM.publicKey, 'pk-custom');
  assert.equal(envMap.CUSTOM.secretKey, 'sk-custom');
}

{
  const storage = createMemoryStorage();
  saveConfig(CONFIG_TYPES.LANGFUSE, {
    environments: [
      {
        envKey: 'TEST_LOCAL',
        label: 'Test-Local',
        proxyBase: '/langfuse-api-test-local',
        baseUrl: 'https://monitor-live-test-cedar.sdmc.tv',
        publicKey: 'pk-test-local',
        secretKey: 'sk-test-local',
        enabled: true,
      },
      {
        envKey: 'PROD_LOCAL',
        label: 'Prod-Local',
        proxyBase: '/langfuse-api-prod-local',
        baseUrl: 'https://monitor-live-prod-cedar.sdmc.tv',
        publicKey: 'pk-prod-local',
        secretKey: 'sk-prod-local',
        enabled: true,
      },
    ],
  }, { storage, actor: 'admin' });

  const rawStorage = storage.dump();
  assert.equal(rawStorage.includes('pk-test-local'), false);
  assert.equal(rawStorage.includes('sk-test-local'), false);
  assert.equal(rawStorage.includes('pk-prod-local'), false);
  assert.equal(rawStorage.includes('sk-prod-local'), false);

  const masked = readConfig(CONFIG_TYPES.LANGFUSE, { storage });
  assert.equal(masked.environments.length, 2);
  assert.equal(masked.environments[0].publicKey, 'pk-tes****ocal');
  assert.equal(masked.environments[0].secretKey, 'sk-tes****ocal');

  const plain = readConfig(CONFIG_TYPES.LANGFUSE, { storage, includeSecrets: true });
  assert.equal(plain.environments[0].secretKey, 'sk-test-local');
  assert.equal(plain.environments[1].publicKey, 'pk-prod-local');

  const envMap = getLangfuseEnvironmentMap({ storage, includeSecrets: true });
  assert.equal(envMap.TEST_LOCAL.label, 'Test-Local');
  assert.equal(envMap.TEST_LOCAL.secretKey, 'sk-test-local');
  assert.equal(envMap.PROD_LOCAL.publicKey, 'pk-prod-local');
}

{
  const storage = createMemoryStorage();
  assert.deepEqual(
    getConfigStatus(CONFIG_TYPES.DOUBAO_TTS, { storage }).missingRequiredFields,
    ['apiKeyId', 'apiKeySecret']
  );

  saveConfig(CONFIG_TYPES.DOUBAO_TTS, {
    apiKey: 'api-key-direct-test',
    apiKeyId: 'api-key-id-test',
    apiKeySecret: 'api-key-secret-test',
    secretKey: 'secret-key-test',
    appId: 'legacy-app-id',
    accessToken: 'legacy-access-token',
    provider: 'legacy-provider',
  }, { storage });

  const rawStorage = storage.dump();
  assert.equal(rawStorage.includes('ak-doubao-test'), false);
  assert.equal(rawStorage.includes('sk-doubao-test'), false);
  assert.equal(rawStorage.includes('api-key-direct-test'), false);
  assert.equal(rawStorage.includes('api-key-id-test'), false);
  assert.equal(rawStorage.includes('api-key-secret-test'), false);
  assert.equal(rawStorage.includes('secret-key-test'), false);

  const masked = readConfig(CONFIG_TYPES.DOUBAO_TTS, { storage });
  assert.equal('accessKeyId' in masked, false);
  assert.equal('secretAccessKey' in masked, false);
  assert.equal('apiKey' in masked, false);
  assert.equal(masked.apiKeyId, 'api-ke****test');
  assert.equal(masked.apiKeySecret, 'api-ke****test');
  assert.equal(masked.secretKey, 'secret****test');

  const plain = readConfig(CONFIG_TYPES.DOUBAO_TTS, { storage, includeSecrets: true });
  assert.equal('accessKeyId' in plain, false);
  assert.equal('secretAccessKey' in plain, false);
  assert.equal('apiKey' in plain, false);
  assert.equal(plain.apiKeyId, 'api-key-id-test');
  assert.equal(plain.apiKeySecret, 'api-key-secret-test');
  assert.equal(plain.secretKey, 'secret-key-test');
  assert.equal(plain.appId, 'legacy-app-id');

  saveConfig(CONFIG_TYPES.DOUBAO_TTS, {
    apiKey: '',
    apiKeyId: '',
    apiKeySecret: '',
    secretKey: '',
  }, { storage });

  const cleaned = readConfig(CONFIG_TYPES.DOUBAO_TTS, { storage, includeSecrets: true });
  assert.equal('accessKeyId' in cleaned, false);
  assert.equal('secretAccessKey' in cleaned, false);
  assert.equal('apiKey' in cleaned, false);
  assert.equal(cleaned.apiKeyId, 'api-key-id-test');
  assert.equal(cleaned.apiKeySecret, 'api-key-secret-test');
  assert.equal(cleaned.secretKey, 'secret-key-test');
  assert.equal(cleaned.appId, undefined);
  assert.equal(cleaned.accessToken, undefined);
  assert.equal(cleaned.provider, 'doubao');
  assert.equal(cleaned.apiVersion, 'v3');
  assert.equal(cleaned.resourceId, 'seed-tts-2.0');
  assert.deepEqual(getConfigStatus(CONFIG_TYPES.DOUBAO_TTS, { storage }).missingRequiredFields, []);
}
