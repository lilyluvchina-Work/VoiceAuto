import assert from 'node:assert/strict';
import {
  CONFIG_TYPES,
  getConfigStatus,
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

assert.equal(CONFIG_TYPES.MINIMAX, 'minimax');

{
  const storage = createMemoryStorage();
  const defaults = readConfig(CONFIG_TYPES.MINIMAX, { storage, includeSecrets: true });
  assert.equal(defaults.baseUrl, 'https://api.minimax.io/v1');
  assert.equal(defaults.model, 'MiniMax-M2.7');
  assert.equal(getConfigStatus(CONFIG_TYPES.MINIMAX, { storage }).complete, false);

  saveConfig(CONFIG_TYPES.MINIMAX, {
    configName: 'MiniMax 评测模型',
    baseUrl: 'https://api.minimax.io/v1',
    apiKey: 'sk-minimax-secret-value',
    model: 'MiniMax-M2.7',
    temperature: 1,
    enabled: true,
  }, { storage });

  const rawStorage = storage.dump();
  assert.equal(rawStorage.includes('sk-minimax-secret-value'), false);

  const masked = readConfig(CONFIG_TYPES.MINIMAX, { storage });
  assert.equal(masked.apiKey, 'sk-min****alue');
  assert.equal(masked.hasSecrets, true);
  assert.deepEqual(getConfigStatus(CONFIG_TYPES.MINIMAX, { storage }).missingRequiredFields, []);

  const plain = readConfig(CONFIG_TYPES.MINIMAX, { storage, includeSecrets: true });
  assert.equal(plain.apiKey, 'sk-minimax-secret-value');
}

