import assert from 'node:assert/strict';
import { CONFIG_TYPES, readConfig } from '../src/modules/config/secureConfigStore.js';
import { saveDatabaseConfig, loadDatabaseConfig } from '../src/modules/config/configApi.js';

let persisted;
let failSave = false;
globalThis.fetch = async (url, options = {}) => {
  assert.equal(url, '/api/configs/minimax');
  if (options.method === 'PUT') {
    if (failSave) return { ok: false, status: 500, json: async () => ({ message: '保存失败' }) };
    persisted = { ...JSON.parse(options.body).config, configured: true };
  }
  return { ok: true, json: async () => ({ config: persisted }) };
};
const type = CONFIG_TYPES.MINIMAX;
await saveDatabaseConfig(type, { activeProvider: 'minimax', enabled: true, apiKey: 'mini-secret', model: 'original-model' });
failSave = true;
await assert.rejects(saveDatabaseConfig(type, { activeProvider: 'codex', enabled: true, codexApiKey: 'codex-secret' }), /保存失败/);
assert.equal(readConfig(type).activeProvider, 'minimax', 'A failed save must not activate the new model');
assert.equal(readConfig(type).model, 'original-model');
failSave = false;
await saveDatabaseConfig(type, { ...readConfig(type), activeProvider: 'codex', apiKey: '', codexApiKey: 'codex-secret' });
await loadDatabaseConfig(type);
assert.equal(readConfig(type).activeProvider, 'codex');
assert.equal(readConfig(type, { includeSecrets: true }).apiKey, 'mini-secret');
assert.equal(readConfig(type, { includeSecrets: true }).codexApiKey, 'codex-secret');
await saveDatabaseConfig(type, { ...readConfig(type), activeProvider: 'minimax', apiKey: '', codexApiKey: '' });
assert.equal(persisted.apiKey, 'mini-secret');
assert.equal(persisted.codexApiKey, 'codex-secret');
assert.equal(persisted.model, 'original-model');
console.log('largeModelConfigApi tests passed');
