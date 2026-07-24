import assert from 'node:assert/strict';

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
  };
}

globalThis.localStorage = createMemoryStorage();

const { CONFIG_TYPES, saveConfig } = await import('../src/modules/config/secureConfigStore.js');
const {
  ENVIRONMENTS,
  getDefaultLangfuseEnvironmentKey,
  getLangfuseEnvironmentEntries,
  refreshLangfuseEnvironments,
} = await import('../src/modules/langfuse/services/langfuseService.js');

assert.equal(Boolean(ENVIRONMENTS.CUSTOM_NOW), false);
assert.equal(getDefaultLangfuseEnvironmentKey(), 'TEST_LOCAL');
assert.equal(getLangfuseEnvironmentEntries()[0][1].label, 'Test-Local');

saveConfig(CONFIG_TYPES.LANGFUSE, {
  environments: [
    {
      envKey: 'CUSTOM_NOW',
      label: 'Custom Now',
      proxyBase: '/langfuse-api-custom-now',
      baseUrl: 'https://monitor.example.com',
      publicKey: 'pk-now',
      secretKey: 'sk-now',
      enabled: true,
    },
  ],
}, { actor: 'test' });

const refreshed = refreshLangfuseEnvironments();
assert.equal(refreshed, ENVIRONMENTS);
assert.equal(ENVIRONMENTS.CUSTOM_NOW.label, 'Custom Now');
assert.equal(ENVIRONMENTS.CUSTOM_NOW.publicKey, 'pk****ow');

localStorage.setItem('voiceauto_secure_configs_v1', JSON.stringify({
  configs: {
    langfuse: {
      type: 'langfuse',
      normalConfig: {
        envKey: 'BROKEN',
        label: 'Broken',
        proxyBase: '/broken',
        enabled: true,
      },
      secretConfig: {
        environments: 'not-a-json-environment-payload',
      },
      secretMask: {},
      version: 1,
    },
  },
  logs: [],
}));

assert.doesNotThrow(() => refreshLangfuseEnvironments());
assert.equal(Boolean(ENVIRONMENTS.BROKEN), true);
