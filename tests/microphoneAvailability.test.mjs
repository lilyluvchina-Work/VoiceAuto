import assert from 'node:assert/strict';
import { listMicrophones, detectSpeakerResponse, requestMicrophonePermission } from '../src/services/responseMonitorService.js';

globalThis.isSecureContext = false;
await assert.rejects(listMicrophones(), /HTTPS/);
await assert.rejects(detectSpeakerResponse(), /安全上下文/);

globalThis.isSecureContext = true;
globalThis.window = { AudioContext: class {} };
let requests = 0;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  mediaDevices: {
    getUserMedia: async () => {
      requests += 1;
      throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    },
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic', label: 'Test microphone' }]
  }
} });
assert.equal((await listMicrophones())[0].deviceId, 'mic');
await assert.rejects(detectSpeakerResponse({ deviceId: 'mic' }), /麦克风访问被拒绝/);
assert.equal(requests, 1, 'Permission denial must not request the microphone again');
navigator.mediaDevices.getUserMedia = async () => {
  requests += 1;
  throw Object.assign(new Error('Missing device'), { name: 'OverconstrainedError' });
};
await assert.rejects(detectSpeakerResponse({ deviceId: 'old-device' }), /重新选择输入设备/);
assert.equal(requests, 3, 'Constraint errors retry once with simplified constraints');
let stopped = 0;
navigator.mediaDevices.getUserMedia = async (constraints) => {
  assert.equal(constraints.audio.deviceId.exact, 'usb-line-in');
  return { getTracks: () => [{ stop: () => { stopped++; } }] };
};
await requestMicrophonePermission('usb-line-in');
assert.equal(stopped, 1, 'Device checks must release the capture device');

let captureConstraints;
navigator.mediaDevices.getUserMedia = async (constraints) => {
  captureConstraints = constraints;
  throw Object.assign(new Error('Disconnected'), { name: 'NotFoundError' });
};
await assert.rejects(detectSpeakerResponse({ deviceId: 'usb-line-in' }), /未找到麦克风/);
assert.equal(captureConstraints.audio.deviceId.exact, 'usb-line-in', 'Recording must use the selected external input');
console.log('Microphone availability checks passed');
