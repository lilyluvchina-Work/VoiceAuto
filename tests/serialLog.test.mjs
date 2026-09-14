import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attachSerialLog } from '../scripts/serialLog.cjs';

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
