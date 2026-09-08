import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createAiToySessionManager } from '../scripts/aiToySession.cjs';

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

test('idle after test input without a reply is an interruption, never completion', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn');
  f.emit('Cedar: Input Text: 你好');
  f.emit('Application: New State: idle');
  assert.equal(f.read().interrupted, true);
  assert.equal(f.read().wakeable, true);
  assert.equal(f.read().ready, false);
  assert.equal(f.read().playbackDone, false);
  assert.equal(f.read().actualAsrText, '你好');
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

test('non-voice case waits for input then a new listening event', async t => {
  const f = await fixture(t);
  f.arm('wake'); f.emit('Cedar: Start listening'); f.arm('turn', false);
  f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, false);
  f.emit('Cedar: Input Text: 无需回答'); f.emit('Cedar: Start listening');
  assert.equal(f.read().ready, true);
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
