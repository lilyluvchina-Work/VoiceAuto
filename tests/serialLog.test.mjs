import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attachSerialLog } from '../scripts/serialLog.cjs';
import { createAiToySessionManager } from '../scripts/aiToySession.cjs';

test('reset or interruption preserves on-disk bytes and close returns the saved file path', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceauto-log-'));
  const port = new EventEmitter();
  const filename = attachSerialLog(port, 'COM3', directory);
  const manager = createAiToySessionManager({ openPort: async () => port,
    closePort: async () => {}, withPortLock: async (_, action) => action() });
  t.after(async () => { await manager.disconnect('COM3'); fs.rmSync(directory, { recursive: true, force: true }); });
  const opened = await manager.open({ serialPort: 'COM3' });
  assert.equal(opened.logPath, filename);
  port.emit('data', Buffer.from('测试被重置前的日志\n'));
  // No browser download or test completion is required for persistence.
  assert.equal(fs.readFileSync(filename, 'utf8'), '测试被重置前的日志\n');
  const closed = await manager.close(opened.sessionId);
  assert.equal(closed.logPath, filename);
  assert.equal(fs.readFileSync(filename, 'utf8'), closed.serialLog);
});

test('serial bytes are on disk before close, including split UTF-8 and unterminated lines', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceauto-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const port = new EventEmitter();
  const filename = attachSerialLog(port, 'COM1', directory);
  const bytes = Buffer.from('启动\r\n\r\n' + '完整日志\n'.repeat(100) + '结尾');
  for (const byte of bytes) port.emit('data', Buffer.from([byte]));
  assert.deepEqual(fs.readFileSync(filename), bytes);
  const another = attachSerialLog(new EventEmitter(), 'COM1', directory);
  assert.notEqual(another, filename);
});

test('disk write failures are visible without crashing the serial listener', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceauto-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const port = new EventEmitter();
  attachSerialLog(port, 'COM1', directory);
  port.serialLogPath = directory;
  assert.doesNotThrow(() => port.emit('data', Buffer.from('data')));
  assert.match(port.serialLogError, /保存失败/);
});
