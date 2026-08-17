import assert from 'node:assert/strict';
import { CONFIG_TYPES, clearConfigStore, readConfig } from '../src/modules/config/secureConfigStore.js';
import {
  loadDatabaseConfig,
  saveDatabaseConfig,
} from '../src/modules/config/configApi.js';

const localStorageCalls = [];
globalThis.localStorage = {
  getItem(key) {
    localStorageCalls.push(['getItem', key]);
    return null;
  },
  setItem(key, value) {
    localStorageCalls.push(['setItem', key, value]);
  },
  removeItem(key) {
    localStorageCalls.push(['removeItem', key]);
  },
};

const savedConfigs = new Map();
const fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  fetchCalls.push({ url, options });
  if (url === '/api/configs/tapd' && (!options.method || options.method === 'GET')) {
    const config = savedConfigs.get('tapd');
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, config: config || { type: 'tapd', configured: false } }),
    };
  }
  if (url === '/api/configs/tapd' && options.method === 'PUT') {
    const body = JSON.parse(options.body);
    const config = {
      type: 'tapd',
      configured: true,
      version: 1,
      ...body.config,
    };
    savedConfigs.set('tapd', config);
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, config }),
    };
  }
  if (url === '/api/configs/minimax' && (!options.method || options.method === 'GET')) {
    const config = savedConfigs.get('minimax');
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, config: config || { type: 'minimax', configured: false } }),
    };
  }
  if (url === '/api/configs/minimax' && options.method === 'PUT') {
    const body = JSON.parse(options.body);
    const config = {
      type: 'minimax',
      configured: true,
      version: 1,
      ...body.config,
    };
    savedConfigs.set('minimax', config);
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, config }),
    };
  }
  throw new Error(`unexpected fetch ${url}`);
};

clearConfigStore({ storage: null });

const loaded = await loadDatabaseConfig(CONFIG_TYPES.TAPD);
assert.equal(loaded.workspaceId, '61252348');

const saved = await saveDatabaseConfig(CONFIG_TYPES.TAPD, {
  apiUser: 'tapd-app-a2b2d6',
  apiPassword: 'updated-password',
  workspaceId: '61252348',
  companyId: '52890462',
  enabled: true,
});
assert.equal(saved.apiPassword, 'update****word');

const runtimeConfig = readConfig(CONFIG_TYPES.TAPD, { includeSecrets: true });
assert.equal(runtimeConfig.apiPassword, 'updated-password');
assert.equal(fetchCalls.some((call) => call.options.method === 'PUT'), true);
assert.equal(localStorageCalls.some(([method]) => method === 'setItem'), false);

const minimaxSaved = await saveDatabaseConfig(CONFIG_TYPES.MINIMAX, {
  configName: 'MiniMax 评测模型',
  baseUrl: 'https://api.minimax.io/v1',
  apiKey: 'sk-minimax-db-secret',
  model: 'MiniMax-M2.7',
  temperature: 1,
  maxCompletionTokens: 2048,
  timeout: 60000,
  enabled: true,
});
assert.equal(minimaxSaved.apiKey, 'sk-min****cret');
assert.equal(savedConfigs.get('minimax').apiKey, 'sk-minimax-db-secret');

const minimaxLoaded = await loadDatabaseConfig(CONFIG_TYPES.MINIMAX);
assert.equal(minimaxLoaded.apiKey, 'sk-minimax-db-secret');
assert.equal(minimaxLoaded.enabled, true);

const minimaxUpdated = await saveDatabaseConfig(CONFIG_TYPES.MINIMAX, {
  configName: 'MiniMax 评测模型',
  baseUrl: 'https://api.minimax.io/v1',
  apiKey: '',
  model: 'MiniMax-M2.8',
  temperature: 0.7,
  maxCompletionTokens: 4096,
  timeout: 45000,
  enabled: true,
});
assert.equal(minimaxUpdated.model, 'MiniMax-M2.8');
assert.equal(minimaxUpdated.temperature, 0.7);
assert.equal(minimaxUpdated.maxCompletionTokens, 4096);
assert.equal(minimaxUpdated.timeout, 45000);
assert.equal(savedConfigs.get('minimax').apiKey, 'sk-minimax-db-secret');
assert.equal(savedConfigs.get('minimax').model, 'MiniMax-M2.8');
