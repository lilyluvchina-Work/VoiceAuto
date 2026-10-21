const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createBridgeControl, exitAfterResponse } = require('../scripts/bridgeControl.cjs');

test('restart refuses active tasks and does not spawn or close resources', async () => {
  let spawned = 0, closed = 0;
  const control = createBridgeControl({ busyReason: () => '正在录音', closeResources: async () => closed++, spawnRestart: async () => spawned++ });
  await assert.rejects(control.restart(), error => error.statusCode === 409 && /正在录音/.test(error.message));
  assert.equal(spawned, 0); assert.equal(closed, 0); assert.equal(control.status().restarting, false);
});
test('a restart still exits when the response closed before the successor became ready', () => {
  for (const destroyed of [true, false]) {
    const response = new EventEmitter(); response.destroyed = destroyed;
    let exited = 0;
    exitAfterResponse(response, () => exited++);
    if (destroyed) assert.equal(exited, 1);
    response.emit('close'); response.emit('finish');
    assert.equal(exited, 1);
  }
});
test('in-flight operations block restart until actual completion, independently of the client socket', async () => {
  const control = createBridgeControl();
  const complete = control.beginRequest();
  await assert.rejects(control.restart(), error => error.statusCode === 409);
  complete(); complete();
  await control.restart();
});
test('restart closes idle resources and schedules a successor once; spawn failure remains recoverable', async () => {
  const calls = [];
  const control = createBridgeControl({ instanceId: 'old', closeResources: async () => calls.push('close'), spawnRestart: async () => calls.push('spawn') });
  assert.equal(control.status().instanceId, 'old');
  assert.equal((await control.restart()).previousInstanceId, 'old');
  assert.deepEqual(calls, ['close', 'spawn']);
  await assert.rejects(control.restart(), /正在重启/);
  const failed = createBridgeControl({ spawnRestart: async () => { throw new Error('启动失败'); } });
  await assert.rejects(failed.restart(), /启动失败/);
  assert.equal(failed.status().restarting, false);
});
test('resource cleanup timeout cancels restart without stopping the existing service', async () => {
  let spawned = false;
  const control = createBridgeControl({ closeTimeoutMs: 5, closeResources: () => new Promise(() => {}), spawnRestart: async () => { spawned = true; } });
  await assert.rejects(control.restart(), /关闭桥接资源超时/);
  assert.equal(spawned, false); assert.equal(control.status().restarting, false);
});
