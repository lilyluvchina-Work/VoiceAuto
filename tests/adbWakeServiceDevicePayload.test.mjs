import assert from 'node:assert/strict';

import {
  detectAsr,
  detectSpeakerResponseLog,
  detectWakeup,
  listDevices,
} from '../src/services/adbWakeService.js';
import { DEVICE_TYPES, LOG_SOURCES } from '../src/config/deviceProfiles.js';

const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, body: JSON.parse(options.body) });
  return {
    ok: true,
    text: async () => JSON.stringify({ success: true, devices: [] }),
  };
};

const runtime = {
  bridgeUrl: 'http://bridge.local',
  deviceType: DEVICE_TYPES.AI_TOY,
  logSource: LOG_SOURCES.SERIAL,
  serialPort: 'COM7',
  baudrate: 115200,
};

await detectWakeup({ ...runtime, timeoutMs: 1000, keywords: ['VOICE WAKE WORD HIT ACCEPTED'] });
await detectAsr({ ...runtime, timeoutMs: 1000, startKeywords: ['Cedar: Input Text'], endKeywords: ['Cedar: Input Text'] });
await detectSpeakerResponseLog({ ...runtime, timeoutMs: 1000, maxWaitMs: 2000 });
await listDevices(runtime);

assert.equal(calls[0].body.deviceType, DEVICE_TYPES.AI_TOY);
assert.equal(calls[0].body.logSource, LOG_SOURCES.SERIAL);
assert.equal(calls[0].body.serialPort, 'COM7');
assert.equal(calls[0].body.baudrate, 115200);
assert.equal(calls[1].body.deviceType, DEVICE_TYPES.AI_TOY);
assert.equal(calls[2].body.logSource, LOG_SOURCES.SERIAL);
assert.equal(calls[3].body.logSource, LOG_SOURCES.SERIAL);
