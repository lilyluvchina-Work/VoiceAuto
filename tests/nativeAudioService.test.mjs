import assert from 'node:assert/strict';
import { detectSpeakerResponse, listNativeInputs } from '../src/services/nativeAudioService.js';

Object.defineProperty(globalThis, 'navigator', { configurable: true, get() { throw new Error('Browser recording must not be accessed'); } });
globalThis.isSecureContext = false;
let calls = [];
const wav = Buffer.from('RIFF-test-native-audio');
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'http://127.0.0.1:17321/api/audio/native');
  const body = JSON.parse(options.body); calls.push(body);
  let data;
  if (body.action === 'devices') data = { devices: [{ deviceId: 'native:usb', label: 'USB input' }] };
  if (body.action === 'start') { assert.equal(body.options.deviceId, 'native:usb'); data = { sessionId: 'test' }; }
  if (body.action === 'status') data = { status: 'completed' };
  if (body.action === 'result') data = { success: true, audioDetected: true, inputDeviceId: 'native:usb',
    inputDeviceLabel: 'USB input', durationMs: 5000, audioBase64: wav.toString('base64') };
  return { ok: true, json: async () => data };
};
assert.equal((await listNativeInputs())[0].deviceId, 'native:usb');
const result = await detectSpeakerResponse({ deviceId: 'native:usb', preview: true, maxRecordMs: 5000 });
assert.equal(result.success, true);
assert.deepEqual(Buffer.from(await result.responseAudioBlob.arrayBuffer()), wav);
assert.equal(result.micDeviceId, 'native:usb');
assert.equal(result.responseAsrStatus, 'unsupported');
URL.revokeObjectURL(result.responseAudioUrl);

const controller = new AbortController();
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body); calls.push(body);
  if (body.action === 'start') { controller.abort(); return { ok: true, json: async () => ({sessionId:'cancelled'}) }; }
  return { ok: true, json: async () => ({success:true}) };
};
await assert.rejects(detectSpeakerResponse({deviceId:'native:usb',signal:controller.signal}), /取消/);
assert.equal(calls.at(-1).action, 'cancel', 'Abort during startup must release native input');
console.log('Native input collection, WAV transport and cancellation passed without browser media APIs');
