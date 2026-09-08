import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { rebootAndObserve } from '../scripts/aiToyReboot.cjs';

function fixture(sequence, reconnect = false, options = {}) {
  const ports = []; const events = []; const controls = []; const controlTimes = []; let asserted = false;
  const open = async () => {
    const port = new EventEmitter(); ports.push(port);
    port.set = (lines, cb) => {
      events.push('set'); controls.push(lines); controlTimes.push(performance.now()); cb();
      if (lines.rts) asserted = true;
      if (asserted && lines.rts === false && lines.dtr === false) {
        asserted = false;
        if (reconnect) { port.emit('close'); }
        else sequence(port);
      }
    };
    port.write = (_, cb) => cb(); port.drain = cb => cb();
    if (ports.length > 1) setTimeout(() => sequence(port), 1);
    return { port, serialPort: ports.length > 1 ? 'COM2' : 'COM1' };
  };
  return { ports, events, controls, controlTimes, run: () => rebootAndObserve({ open, close: async p => { events.push('close'); p.emit('close'); },
    timeoutMs: 90, pulseMs: 1, pollMs: 2, ...options }) };
}
const emit = (p, text) => p.emit('data', Buffer.from(text + '\n'));

test('serial readability and idle without fresh boot evidence cannot complete recovery', async () => {
  const f = fixture(p => emit(p, 'Application: New State: idle'));
  assert.equal((await f.run()).bootCompleted, false);
});
test('captures early boot logs during reset and waits for application idle', async () => {
  const f = fixture(p => { emit(p, 'ESP-ROM:esp32s3'); emit(p, 'rst:0x15 (USB_UART_CHIP_RESET)'); emit(p, 'Application: ║ New State: idle'); });
  const result = await f.run();
  assert.equal(result.success, true);
  assert.match(result.bootMatchedLine, /idle/);
  assert.equal(f.events.at(-1), 'close');
  assert.equal(f.ports.length, 1, 'reset keeps the port open until cleanup');
  assert.equal(result.serialConnected, true);
  assert.match(result.serialLog, /ESP-ROM/);
});
test('boot banner without application readiness times out', async () => {
  const f = fixture(p => emit(p, 'rst:0x1 (POWERON)'));
  assert.equal((await f.run()).bootCompleted, false);
});
test('reconnect observes boot completion without issuing another reset', async () => {
  const f = fixture(p => { emit(p, 'ESP-ROM:esp32s3'); emit(p, 'rst:0x15 (USB_UART_CHIP_RESET)'); emit(p, 'Application: New State: idle'); }, true);
  const result = await f.run();
  assert.equal(result.success, true);
  assert.equal(result.recoveredDeviceId, 'COM2');
  assert.equal(f.controls.filter(c => c.rts === true).length, 1);
});


test('startup logs split across UTF-8 chunks are preserved', async () => {
  const f = fixture(p => {
    for (const byte of Buffer.from('USB_UART_CHIP_RESET\nApplication: ║ New State: idle\n')) p.emit('data', Buffer.from([byte]));
  });
  assert.equal((await f.run()).success, true);
});

test('RTS reset never asserts DTR and initializes both lines low', async () => {
  const f = fixture(p => { emit(p, 'USB_UART_CHIP_RESET'); emit(p, 'Application: New State: idle'); });
  assert.equal((await f.run()).success, true);
  assert.deepEqual(f.controls, [
    { dtr: false, rts: false },
    { dtr: false, rts: true },
    { dtr: false, rts: false },
  ]);
});

test('unrelated reset reason cannot confirm commanded USB UART reset', async () => {
  const f = fixture(p => { emit(p, 'rst:0x1 (POWERON)'); emit(p, 'Application: New State: idle'); });
  assert.equal((await f.run()).success, false);
});

test('default reset holds RTS high for 200 milliseconds before release', async () => {
  const f = fixture(p => { emit(p, 'USB_UART_CHIP_RESET'); emit(p, 'Application: New State: idle'); },
    false, { pulseMs: undefined, timeoutMs: 1500 });
  assert.equal((await f.run()).success, true);
  assert.ok(f.controlTimes[2] - f.controlTimes[1] >= 195, 'RTS must remain high for the full pulse');
});
