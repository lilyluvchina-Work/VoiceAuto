import test from 'node:test';
import assert from 'node:assert/strict';
import { restartBridge } from '../src/services/bridgeService.js';

test('restart only succeeds after a different bridge instance is healthy', async () => {
  const calls = [], statuses = ['old', 'old', 'new'];
  const result = await restartBridge('', { fetchImpl: async (url) => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith('/restart') ? { success: true, previousInstanceId: 'old' }
      : { success: true, instanceId: statuses.shift() } };
  }, sleep: async () => {} });
  assert.equal(result.instanceId, 'new');
  assert.equal(calls.filter(url => url.endsWith('/restart')).length, 1);
});
test('old bridges and busy tasks produce actionable errors', async () => {
  await assert.rejects(restartBridge('', { fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ message: 'not found' }) }) }), /更新.*桥接/);
  await assert.rejects(restartBridge('', { fetchImpl: async url => url.endsWith('/status')
    ? { ok: true, json: async () => ({ success: true, instanceId: 'old' }) }
    : { ok: false, status: 409, json: async () => ({ message: '正在测试，请先停止' }) } }), /正在测试/);
});
test('a lost restart acknowledgement still waits for the new healthy instance', async () => {
  let old = true;
  const result = await restartBridge('', { fetchImpl: async url => {
    if (url.endsWith('/restart')) { old = false; throw new TypeError('connection closed'); }
    return { ok: true, json: async () => ({ success: true, instanceId: old ? 'old' : 'new' }) };
  }, sleep: async () => {} });
  assert.equal(result.instanceId, 'new');
});
