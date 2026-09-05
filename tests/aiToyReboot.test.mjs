import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { rebootAndObserve } from '../scripts/aiToyReboot.cjs';

function fixture(sequence, reconnect = false) {
  const ports = []; const events = [];
  const open = async () => {
    const port = new EventEmitter(); ports.push(port);
    port.set = (lines, cb) => {
      events.push('set'); cb();
      if (lines.dtr && !lines.rts) {
        if (reconnect) { port.emit('close'); }
        else sequence(port);
      }
    };
    port.write = (_, cb) => cb(); port.drain = cb => cb();
    if (ports.length > 1) setTimeout(() => sequence(port), 1);
    return { port, serialPort: ports.length > 1 ? 'COM2' : 'COM1' };
  };
  return { ports, events, run: () => rebootAndObserve({ open, close: async p => { events.push('close'); p.emit('close'); },
    timeoutMs: 90, pulseMs: 1, pollMs: 2 }) };
}
const emit = (p, text) => p.emit('data', Buffer.from(text + '\n'));

test('serial readability and idle without fresh boot evidence cannot complete recovery', async () => {
  const f = fixture(p => emit(p, 'Application: New State: idle'));
  assert.equal((await f.run()).bootCompleted, false);
});
test('captures early boot logs during reset and waits for application idle', async () => {
  const f = fixture(p => { emit(p, 'ESP-ROM:esp32s3'); emit(p, 'Application: ║ New State: idle'); });
  const result = await f.run();
  assert.equal(result.success, true);
  assert.match(result.bootMatchedLine, /idle/);
  assert.equal(f.events.at(-1), 'close');
});
test('boot banner without application readiness times out', async () => {
  const f = fixture(p => emit(p, 'rst:0x1 (POWERON)'));
  assert.equal((await f.run()).bootCompleted, false);
});
test('reconnect observes boot completion without issuing another reset', async () => {
  const f = fixture(p => { emit(p, 'ESP-ROM:esp32s3'); emit(p, 'Application: New State: idle'); }, true);
  const result = await f.run();
  assert.equal(result.success, true);
  assert.equal(result.recoveredDeviceId, 'COM2');
  assert.equal(f.events.filter(e => e === 'set').length, 2);
});


test('startup logs split across UTF-8 chunks are preserved', async () => {
  const f = fixture(p => {
    for (const byte of Buffer.from('Rebooting.\nApplication: ║ New State: idle\n')) p.emit('data', Buffer.from([byte]));
  });
  assert.equal((await f.run()).success, true);
});
