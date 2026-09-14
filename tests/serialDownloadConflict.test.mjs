import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { downloadAiToySerialLog } from '../src/services/adbWakeService.js';
import { createAiToySessionManager } from '../scripts/aiToySession.cjs';

test('downloading the previous run cannot open, close or interrupt the active serial session', async t => {
  const port = new EventEmitter();
  let opens = 0;
  let closes = 0;
  const manager = createAiToySessionManager({
    openPort: async () => { opens++; return port; },
    closePort: async () => { closes++; },
    withPortLock: async (_, operation) => operation(),
  });
  t.after(() => manager.disconnect('COM3'));
  await manager.monitor({ serialPort: 'COM3' });
  const first = await manager.open({ serialPort: 'COM3' });
  port.emit('data', Buffer.from('first run\n'));
  const finished = await manager.close(first.sessionId);
  const second = await manager.open({ serialPort: 'COM3' });
  manager.arm(second.sessionId, { mode: 'wake' });

  const original = { document: globalThis.document, fetch: globalThis.fetch,
    create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  t.after(() => {
    globalThis.document = original.document; globalThis.fetch = original.fetch;
    URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
  });
  let clicked = false;
  let blob;
  globalThis.fetch = () => { throw new Error('Downloading must not call the bridge'); };
  URL.createObjectURL = value => { blob = value; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  globalThis.document = {
    body: { appendChild() {} },
    createElement: () => ({ click() { clicked = true; }, remove() {} }),
  };
  downloadAiToySerialLog({ runId: 'first-run', serialLog: finished.serialLog });
  assert.equal(clicked, true);
  assert.equal(await blob.text(), 'first run\n');
  port.emit('data', Buffer.from('Cedar: Start listening\n'));
  const monitored = await manager.monitor({ serialPort: 'COM3' });
  assert.equal(monitored.testing, true);
  assert.equal(manager.read(second.sessionId).ready, true);
  assert.equal(opens, 1);
  assert.equal(closes, 0);
});
