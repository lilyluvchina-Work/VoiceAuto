import assert from 'node:assert/strict';
import { CONFIG_TYPES, readConfig } from '../src/modules/config/secureConfigStore.js';
import { saveDatabaseConfig, loadDatabaseConfig } from '../src/modules/config/configApi.js';

let persisted;
let failSave = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  assert.equal(url, '/api/configs/doubaoTts');
  if (options.method === 'PUT') {
    if (failSave) return { ok: false, status: 500, json: async () => ({ message: '保存失败' }) };
    persisted = { ...JSON.parse(options.body).config, configured: true };
  }
  return { ok: true, json: async () => ({ config: persisted }) };
};
try {
  const type = CONFIG_TYPES.DOUBAO_TTS;
  await saveDatabaseConfig(type, { apiKeyId: '123456', apiKeySecret: 'company-token', resourceId: 'company-resource' });
  failSave = true;
  await assert.rejects(saveDatabaseConfig(type, { activeAccount: 'personal', personalApiKeySecret: 'personal-token' }), /保存失败/);
  assert.equal(readConfig(type).activeAccount, 'company');
  failSave = false;
  await saveDatabaseConfig(type, { activeAccount: 'personal', personalApiKeyId: '654321', personalApiKeySecret: 'personal-token' });
  await loadDatabaseConfig(type);
  await saveDatabaseConfig(type, { activeAccount: 'company', apiKeySecret: '', personalApiKeySecret: '' });
  assert.equal(persisted.apiKeySecret, 'company-token');
  assert.equal(persisted.personalApiKeySecret, 'personal-token');
  assert.equal(persisted.resourceId, 'company-resource');
} finally {
  globalThis.fetch = originalFetch;
}
