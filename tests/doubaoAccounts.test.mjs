import test from 'node:test';
import assert from 'node:assert/strict';
import { getDoubaoV3Config, synthesizeDoubaoV3 } from '../server/doubaoTtsService.js';
import { CONFIG_TYPES, saveConfig, readConfig, getConfigStatus } from '../src/modules/config/secureConfigStore.js';

test('existing saved credentials remain the company account, personal is independent', () => {
  const saved = { apiKeyId: '123', apiKeySecret: 'company-token', resourceId: 'company-resource',
    personalApiKeyId: '456', personalApiKeySecret: 'personal-token', personalResourceId: 'personal-resource' };
  assert.equal(getDoubaoV3Config(saved).apiKeySecret, 'company-token');
  const selected = getDoubaoV3Config({ ...saved, activeAccount: 'personal' });
  assert.equal(selected.apiKeyId, '456');
  assert.equal(selected.apiKeySecret, 'personal-token');
  assert.equal(selected.resourceId, 'personal-resource');
  assert.equal(getDoubaoV3Config({ apiKeySecret: 'company-token', activeAccount: 'personal' }).apiKeySecret, '');
});

test('both accounts secrets are masked and preserved when saving masked form fields', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const type = CONFIG_TYPES.DOUBAO_TTS;
  saveConfig(type, { apiKeyId: '123456', apiKeySecret: 'company-token-123', personalApiKeyId: '654321',
    personalApiKeySecret: 'personal-token-456', activeAccount: 'personal' }, { storage });
  assert.notEqual(readConfig(type, { storage }).personalApiKeySecret, 'personal-token-456');
  assert.ok(![...values.values()].join('').includes('personal-token-456'));
  saveConfig(type, { ...readConfig(type, { storage, includeSecrets: true }),
    apiKeySecret: '', personalApiKeySecret: '', activeAccount: 'company' }, { storage });
  const saved = readConfig(type, { storage, includeSecrets: true });
  assert.equal(saved.apiKeySecret, 'company-token-123');
  assert.equal(saved.personalApiKeySecret, 'personal-token-456');
  assert.equal(getConfigStatus(type, { storage }).complete, true);
});

test('personal selection requires its own credentials', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  saveConfig(CONFIG_TYPES.DOUBAO_TTS, { activeAccount: 'personal', apiKeyId: '123', apiKeySecret: 'company' }, { storage });
  assert.equal(getConfigStatus(CONFIG_TYPES.DOUBAO_TTS, { storage }).complete, false);
});

test('audio requests use the selected account headers and never fall back to company credentials', async t => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  const requests = [];
  globalThis.fetch = async (_, options) => {
    requests.push(options);
    return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  const payload = { activeAccount: 'personal', apiKeyId: '123456', apiKeySecret: 'company-token',
    personalApiKeyId: '654321', personalApiKeySecret: 'personal-token', personalResourceId: 'personal-resource' };
  const pool = { query: async sql => ({ rows: sql.includes('SELECT') ? [{ config_type: 'doubaoTts', payload }] : [] }) };
  await synthesizeDoubaoV3(pool, { text: '测试', voiceType: 'voice' });
  assert.equal(requests[0].headers['X-Api-App-Id'], '654321');
  assert.equal(requests[0].headers['X-Api-Access-Key'], 'personal-token');
  assert.equal(requests[0].headers['X-Api-Resource-Id'], 'personal-resource');
  payload.personalApiKeySecret = '';
  await assert.rejects(synthesizeDoubaoV3(pool, { text: '测试', voiceType: 'voice' }), /未配置/);
  assert.equal(requests.length, 1);
  payload.activeAccount = 'company';
  await synthesizeDoubaoV3(pool, { text: '测试', voiceType: 'voice' });
  assert.equal(requests[1].headers['X-Api-Access-Key'], 'company-token');
});
