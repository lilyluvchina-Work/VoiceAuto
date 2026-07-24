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
