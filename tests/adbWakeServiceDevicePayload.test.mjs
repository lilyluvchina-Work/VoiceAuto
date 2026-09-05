import assert from 'node:assert/strict';

import {
  detectAsr,
  detectSpeakerResponseLog,
  detectWakeup,
  listDevices,
  rebootSpeaker,
} from '../src/services/adbWakeService.js';
import { DEVICE_TYPES, LOG_SOURCES } from '../src/config/deviceProfiles.js';

const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, body: JSON.parse(options.body) });
  if (String(url).includes('/api/adb/reboot-and-wait')) {
    return {
      ok: true,
      text: async () => JSON.stringify({
        success: true,
        bootCompleted: true,
        recoveredDeviceId: 'COM8',
        health: {
          usbDiagnostics: [{ friendlyName: '未知 USB 设备(设备描述符请求失败)' }]
        },
        message: 'serial recovered'
      }),
    };
  }
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
const rebootResult = await rebootSpeaker({ ...runtime, recoveryTimeoutMs: 1000 });

assert.equal(calls[0].body.deviceType, DEVICE_TYPES.AI_TOY);
assert.equal(calls[0].body.logSource, LOG_SOURCES.SERIAL);
assert.equal(calls[0].body.serialPort, 'COM7');
assert.equal(calls[0].body.baudrate, 115200);
assert.equal(calls[1].body.deviceType, DEVICE_TYPES.AI_TOY);
assert.equal(calls[2].body.logSource, LOG_SOURCES.SERIAL);
assert.equal(calls[3].body.logSource, LOG_SOURCES.SERIAL);
assert.equal(calls[4].body.logSource, LOG_SOURCES.SERIAL);
assert.equal(rebootResult.recoveredDeviceId, 'COM8');
assert.equal(rebootResult.health.usbDiagnostics[0].friendlyName, '未知 USB 设备(设备描述符请求失败)');
