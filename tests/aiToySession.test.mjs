import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createAiToySessionManager } from '../scripts/aiToySession.cjs';

test('monitor shares the port with tests and keeps collecting after test close', async t => {
  const port = new EventEmitter();
  let opens = 0;
  const manager = createAiToySessionManager({
    openPort: async () => { opens++; return port; },
    closePort: async () => port.emit('close'),
    withPortLock: async (_, operation) => operation(),
  });
  const monitoring = await manager.monitor({ serialPort: 'COM1' });
  t.after(() => manager.disconnect('COM1'));
  port.emit('data', Buffer.from('before test\n'));
  const running = await manager.open({ serialPort: 'COM1' });
  assert.equal(running.sessionId, monitoring.sessionId);
  port.emit('data', Buffer.from('during test\n'));
  assert.equal((await manager.close(running.sessionId)).serialLog, 'during test\n');
  port.emit('data', Buffer.from('after test\n'));
  const status = await manager.monitor({ serialPort: 'COM1' });
  assert.equal(opens, 1);
  assert.ok(status.sampleLines.includes('after test'));
  assert.equal(status.testing, false);
});

test('monitor reconnects a disconnected idle port', async t => {
  const ports = [];
  const manager = createAiToySessionManager({
    openPort: async () => { const port = new EventEmitter(); ports.push(port); return port; },
    closePort: async port => port.emit('close'),
    withPortLock: async (_, operation) => operation(),
  });
  const first = await manager.monitor({ serialPort: 'COM2' });
  t.after(() => manager.disconnect('COM2'));
  ports[0].emit('close');
  const next = await manager.monitor({ serialPort: 'COM2' });
  assert.notEqual(first.sessionId, next.sessionId);
  assert.equal(ports.length, 2);
});

test('simultaneous health and monitor requests share a single pending connection', async t => {
  let opens = 0;
  const manager = createAiToySessionManager({
    openPort: async () => { opens++; await new Promise(resolve => setTimeout(resolve, 5)); return new EventEmitter(); },
    closePort: async () => {}, withPortLock: async (_, operation) => operation(),
  });
  t.after(() => manager.disconnect('COM1'));
  const [a, b, run] = await Promise.all([
    manager.monitor({ serialPort: 'COM1' }), manager.monitor({ serialPort: 'COM1' }),
    manager.open({ serialPort: 'COM1' }),
  ]);
  assert.equal(a.sessionId, b.sessionId);
  assert.equal(a.sessionId, run.sessionId);
  assert.equal(opens, 1);
});

test('changing idle baudrate reopens port and starting test preserves pending boot', async t => {
  const rates = [];
  let port;
  const manager = createAiToySessionManager({
    openPort: async options => { rates.push(options.baudrate); port = new EventEmitter(); return port; },
    closePort: async () => {}, withPortLock: async (_, operation) => operation(),
  });
  t.after(() => manager.disconnect('COM1'));
  await manager.monitor({ serialPort: 'COM1', baudrate: 115200 });
  await manager.monitor({ serialPort: 'COM1', baudrate: 9600 });
  assert.deepEqual(rates, [115200, 9600]);
  port.emit('data', Buffer.from('ESP-ROM:esp32s3\n'));
  const { sessionId } = await manager.open({ serialPort: 'COM1', baudrate: 9600 });
  assert.throws(() => manager.arm(sessionId, { mode: 'wake' }), /未完成重启/);
});

async function fixture(t) {
  const port = new EventEmitter();
  let opens = 0;
  let closes = 0;
  const manager = createAiToySessionManager({
    openPort: async () => { opens++; return port; },
    closePort: async () => { closes++; port.emit('close'); },
    withPortLock: async (_, operation) => operation(),
  });
  const { sessionId } = await manager.open({ serialPort: 'COM1' });
  t.after(() => manager.close(sessionId));
  const emit = text => port.emit('data', Buffer.from(`${text}\n`));
  const read = () => manager.read(sessionId);
  const arm = (mode, expectsVoiceResponse = true) => manager.arm(sessionId, { mode, expectsVoiceResponse });
  return { manager, sessionId, port, emit, read, arm, counts: () => ({ opens, closes }) };
}

test('serial listener stays open across wake, input, completion and multiple turns', async t => {
  const f = await fixture(t);
  f.arm('wake');
  f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
  for (let i = 0; i < 2; i++) {
    f.arm('turn');
    f.emit('Cedar: Input Text: 你好');
    f.emit('Audio latency first_downlink_audio');
    assert.equal(f.read().ready, false);
    f.emit('TTS playback done');
    assert.equal(f.read().ready, false);
    f.emit('Cedar: Start listening');
    assert.equal(f.read().ready, true);
    assert.equal(f.read().actualAsrText, '你好');
  }
  assert.deepEqual(f.counts(), { opens: 1, closes: 0 });
  await f.manager.close(f.sessionId);
  assert.deepEqual(f.counts(), { opens: 1, closes: 1 });
});

test('stale listening before playback completion does not release the next turn', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn');
  f.emit('Cedar: Start listening');
  f.emit('TTS playback done');
  assert.equal(f.read().ready, false);
  assert.throws(() => f.arm('turn'), /尚未开始收音/);
  assert.throws(() => f.arm('wake'), /未中断/);
  f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true, 'first audio telemetry is not required to prove playback done');
});

test('reboot remains blocked until application idle, then allows re-wake', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn');
  f.emit('Rebooting.');
  assert.equal(f.read().interrupted, true);
  assert.equal(f.read().rebootPending, true);
  f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, false);
  f.emit('Application: ║ New State: idle');
  assert.equal(f.read().rebootPending, false);
  f.arm('wake'); f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
});

test('generic hardware timeout cannot authorize re-wake', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn');
  f.emit('I2C transaction timeout');
  assert.equal(f.read().interrupted, false);
  assert.throws(() => f.arm('wake'), /未中断/);
});

test('failed wake can be armed again while still waiting for first listening', async t => {
  const f = await fixture(t);
  f.arm('wake');
  for (let i = 0; i < 5; i++) f.arm('wake');
  f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
  assert.throws(() => f.arm('wake'), /未中断/);
  f.arm('turn');
  assert.throws(() => f.arm('wake'), /未中断/);
});

test('standby without ASR or reply permits the next audio', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn');
  f.emit('Application: New State: idle');
  assert.equal(f.read().ready, false);
  assert.equal(f.read().interrupted, false);
  assert.equal(f.read().inputDetected, false);
});

test('no TTS timeout keeps listening for standby even when a reply was expected', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn');
  f.emit('WS response timeout (no_tts_start)');
  assert.equal(f.read().interrupted, false);
  assert.equal(f.read().ready, false);
  f.emit('Application: New State: idle');
  assert.equal(f.read().ready, false);
});

test('idle after test input without a reply requires wake before the next audio', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn');
  f.emit('Cedar: Input Text: 你好');
  f.emit('Application: New State: idle');
  assert.equal(f.read().interrupted, false);
  assert.equal(f.read().standbyDetected, true);
  assert.equal(f.read().ready, false);
  assert.equal(f.read().playbackDone, false);
  assert.equal(f.read().actualAsrText, '你好');
  assert.throws(() => f.arm('turn'), /尚未开始收音/);
  f.arm('wake'); f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
  f.arm('turn');
});

test('only explicit idle makes an interrupted device wakeable', async t => {
  const f = await fixture(t);
  f.arm('wake');
  f.emit('WS response timeout (no_tts_start)');
  assert.equal(f.read().wakeable, false);
  f.emit('Application: New State: idle');
  assert.equal(f.read().wakeable, true);
  f.arm('wake');
  assert.equal(Boolean(f.read().wakeable), false);
  f.emit('Rebooting.');
  assert.equal(f.read().wakeable, false);
  assert.throws(() => f.arm('wake'), /尚未完成重启/);
});

test('service connection failure interrupts but waits for idle before re-wake', async t => {
  const f = await fixture(t);
  f.arm('wake');
  f.emit('WebSocket handshake failed, status=500');
  assert.equal(f.read().interrupted, true);
  assert.equal(f.read().phase, 'interrupted');
  assert.equal(f.read().wakeable, false);
  assert.match(f.read().interruptionReason, /WebSocket handshake failed/);
  assert.throws(() => f.arm('wake'), /尚未回到待唤醒状态/);
  f.emit('Application: Alert [circle_xmark] 错误: 无法连接服务，请稍后再试');
  assert.match(f.read().interruptionReason, /无法连接服务/);
  assert.equal(f.read().wakeable, false);
  f.emit('Application: New State: idle');
  assert.equal(f.read().wakeable, true);
  assert.match(f.read().interruptionReason, /无法连接服务/);
  f.arm('wake');
  f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
});

test('tool evidence does not invent readiness before the silent device enters standby', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn', false);
  f.emit('Cedar: Input Text: 创建场景');
  f.emit('WS response timeout (no_tts_start)');
  assert.equal(f.read().ready, false);
  assert.equal(f.read().interrupted, false);
  const state = f.manager.confirmToolTurn(f.sessionId);
  assert.equal(state.ready, false);
  assert.equal(state.playbackDone, false);
  assert.equal(state.toolCalled, true);
  assert.throws(() => f.arm('turn'), /尚未开始收音/);
  f.emit('Application: New State: idle');
  assert.equal(f.read().ready, false);
  assert.throws(() => f.arm('turn'), /尚未开始收音/);
  f.arm('wake'); f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
  f.arm('turn');
  assert.throws(() => f.manager.confirmToolTurn(f.sessionId), /无需语音/);
});

test('tool confirmation cannot interrupt audio or bypass an interrupted device', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn', false);
  f.emit('Cedar: Input Text: 创建场景');
  f.emit('Audio latency first_downlink_audio');
  assert.equal(f.manager.confirmToolTurn(f.sessionId).ready, false);
  f.emit('TTS playback done'); f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
});

test('non-voice case waits for input then a new listening event', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn', false);
  f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, false);
  f.emit('Cedar: Input Text: 无需回答'); f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
});

test('silent tool completed in standby requires wake before the next turn', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn', false);
  f.emit('Cedar: Input Text: 创建场景');
  f.emit('Application: New State: idle');
  const state = f.manager.confirmToolTurn(f.sessionId);
  assert.equal(state.toolCalled, true);
  assert.equal(state.ready, false);
  assert.equal(state.standbyDetected, true);
  assert.equal(state.listeningDetected, false);
  assert.throws(() => f.arm('turn'), /尚未开始收音/);
  f.arm('wake'); f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
  f.arm('turn');
});

test('idle cannot release an unfinished reply or conceal a connection failure', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn', false);
  f.emit('Cedar: Input Text: 创建场景'); f.emit('Audio latency first_downlink_audio');
  f.emit('Application: New State: idle');
  assert.equal(f.read().interrupted, true);
  assert.equal(f.read().ready, false);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn', false);
  f.emit('Cedar: Input Text: 创建场景'); f.emit('WebSocket handshake failed, status=500');
  f.emit('Application: New State: idle');
  assert.equal(f.read().interrupted, true);
  assert.equal(f.read().ready, false);
  assert.throws(() => f.manager.confirmToolTurn(f.sessionId), /已中断/);
});

test('serial disconnect cannot be mistaken for permission to replay audio', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening');
  f.port.emit('close');
  assert.equal(f.read().ready, false);
  assert.throws(() => f.arm('turn'), /串口已断开/);
});

test('duplicate listener on the same serial port is rejected', async t => {
  const f = await fixture(t);
  await assert.rejects(f.manager.open({ serialPort: 'com1' }), /正在测试/);
});

test('UTF-8 split chunks preserve input text and interrupt markers', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn');
  const bytes = Buffer.from('Cedar: Input Text: 你好\n');
  for (const byte of bytes) f.port.emit('data', Buffer.from([byte]));
  assert.equal(f.read().actualAsrText, '你好');
});


test('boot banners require idle before re-wake and timeout logs cannot clear boot pending', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn');
  f.emit('ESP-ROM:esp32s3');
  f.emit('WS response timeout (no_tts_start)');
  assert.equal(f.read().rebootPending, true);
  assert.throws(() => f.arm('wake'), /未完成重启/);
  f.emit('Application: New State: idle');
  assert.equal(f.read().bootCompleted, true);
  f.arm('wake');
  assert.equal(f.read().ready, false);
  f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
});

test('closing exports all raw serial data including partial UTF-8 and more than 30 lines', async t => {
  const f = await fixture(t);
  const rawLog = Array.from({ length: 100 }, (_, i) => `日志 ${i}\r\n`).join('') + '末尾';
  for (const byte of Buffer.from(rawLog)) f.port.emit('data', Buffer.from([byte]));
  assert.equal(f.read().sampleLines.length, 30);
  const result = await f.manager.close(f.sessionId);
  assert.equal(result.serialLog, rawLog);
});
