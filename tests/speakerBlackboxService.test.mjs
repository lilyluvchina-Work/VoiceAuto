import test from 'node:test';
import assert from 'node:assert/strict';
import { newAssetId, getRecording, request, resetRun } from '../src/modules/speakerBlackbox/service.js';

test('legacy bridge reset stops paused work, waits for shutdown and notifications, upgrades then clears data', async () => {
  const calls = [];
  let resets = 0;
  const statuses = [
    { status: 'stopping' }, { status: 'aborted', notifications: { ended: { status: 'pending' } } },
    { status: 'aborted', notifications: { ended: { status: 'sent' } } },
  ];
  await resetRun('bridge', 'run', {
    requestImpl: async (_bridge, body) => {
      calls.push(body.action);
      if (body.action === 'reset' && ++resets === 1) throw new Error('任务执行中不能修改音频或配置');
      if (body.action === 'status') return statuses.shift();
      return body.action === 'reset' ? { reset: true } : { status: 'stopping' };
    }, restartImpl: async () => { calls.push('restart'); }, sleep: async () => {},
  });
  assert.deepEqual(calls, ['reset', 'stop', 'status', 'status', 'status', 'restart', 'reset']);
});

test('modern reset does not restart and unrelated errors do not stop existing work', async () => {
  const restartImpl = async () => assert.fail('unexpected restart');
  assert.equal((await resetRun('', 'run', { requestImpl: async () => ({ reset: true }), restartImpl })).reset, true);
  await assert.rejects(resetRun('', 'run', { requestImpl: async (_bridge, body) => {
    assert.equal(body.action, 'reset'); throw new Error('设备写入失败');
  }, restartImpl }), /设备写入失败/);
});

test('asset IDs work on HTTP origins without crypto.randomUUID', () => {
  const crypto = { getRandomValues: bytes => { bytes.fill(17); return bytes; } };
  assert.match(newAssetId(crypto), /^[a-zA-Z0-9_-]{1,80}$/);
  assert.equal(newAssetId(crypto), 'audio_' + '11'.repeat(16));
});

test('recording download joins chunks and API failures remain visible', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const offsets = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); offsets.push(body.offset);
    return { ok: true, json: async () => body.offset === 0
      ? { data: btoa('RIFF'), size: 8, nextOffset: 4 }
      : { data: btoa('WAVE'), size: 8, nextOffset: 8 } };
  };
  const blob = await getRecording('', 'run', 'recordings/test.wav');
  assert.equal(await blob.text(), 'RIFFWAVE');
  assert.deepEqual(offsets, [0, 4]);
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ message: '设备已断开' }) });
  await assert.rejects(request('', { action: 'start' }), /设备已断开/);
});

test('an outdated bridge endpoint tells the user to update and restart the local bridge', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ message: 'not found' }) });
  await assert.rejects(request('', { action: 'devices' }), /更新并重启.*本机.*桥接/);
});
