import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTestAudios, deviceWakeConfig, resolveAudioFile, wakeResponsePreset, selectAudioDevices, migrateWakeResponse } from '../src/modules/speakerBlackbox/audioSource.js';

test('existing generated-audio status, module filter and ordering are respected', () => {
  const audios = [
    { id: 'b', audioStatus: 'generated', module: '音乐', importIndex: 2 },
    { id: 'pending', audioStatus: 'not_generated', module: '音乐' },
    { id: 'a', audioStatus: 'generated', module: '音乐', importIndex: 1 },
    { id: 'other', audioStatus: 'generated', module: '天气' },
  ];
  assert.deepEqual(selectTestAudios(audios, '音乐').map(a => a.id), ['a', 'b']);
  assert.equal(selectTestAudios(audios, 'all').length, 3);
});
test('blackbox keeps the audio-menu exact directory filter and includes children when viewing all', () => {
  const audios = [
    { id: 'child', audioStatus: 'generated', caseDirectory: '音乐 / 播放', importIndex: 1 },
    { id: 'parent', audioStatus: 'generated', caseDirectory: '音乐', importIndex: 0 },
    { id: 'other', audioStatus: 'generated', caseDirectory: '天气' },
    { id: 'pending', audioStatus: 'not_generated', caseDirectory: '音乐' },
  ];
  assert.deepEqual(selectTestAudios(audios, '音乐').map(a => a.id), ['parent']);
  assert.ok(selectTestAudios(audios, 'all').some(a => a.id === 'child'));
});
test('device changes reset the wake text and language while manual values can be retained in a profile', () => {
  assert.equal(deviceWakeConfig('xiaomi', { wakeWord: 'old' }).wakeWord, '小爱同学');
  assert.equal(deviceWakeConfig('baidu').wakeWord, '小度小度');
  assert.equal(deviceWakeConfig('google').wakeWord, 'Hey Google');
  assert.equal(deviceWakeConfig('google').language, 'en');
  assert.equal(deviceWakeConfig('xiaomi', { wakeResponse: 'old', templateKind: 'tone' }).wakeResponse, '我在 / 你说 / 诶 / 哎 / 在呢 / 哎，在呢 / 在 / 怎么了，我在');
  assert.equal(deviceWakeConfig('xiaomi').templateKind, 'speech');
  assert.equal(deviceWakeConfig('baidu').wakeResponse, '在呢 / 来喽哦 / 嗯 / 哎 / 我在');
  assert.equal(deviceWakeConfig('google').templateKind, 'tone');
  assert.equal(deviceWakeConfig('google').wakeResponse, '唤醒提示音');
  assert.equal(deviceWakeConfig('xiaomi').wakeDetectionMode, 'speech_or_template');
  assert.equal(deviceWakeConfig('baidu').wakeDetectionMode, 'speech_or_template');
  assert.equal(deviceWakeConfig('google').wakeDetectionMode, 'template_only');
  assert.equal(deviceWakeConfig('xiaomi', { wakeDetectionMode: 'template_only' }).wakeDetectionMode, 'template_only');
});
test('expanded Xiaoai replies replace the old single-reply preset while preserving custom text', () => {
  for (const reply of ['我在', '你说', '诶', '哎', '在呢', '哎，在呢', '在', '怎么了，我在']) assert.ok(wakeResponsePreset('xiaomi').responses.includes(reply));
  assert.equal(new Set(wakeResponsePreset('xiaomi').responses).size, wakeResponsePreset('xiaomi').responses.length);
  assert.equal(migrateWakeResponse({ deviceType: 'xiaomi', wakeResponse: '我在 / 你说 / 诶 / 哎 / 在呢 / 哎，在呢', wakeResponsePresetVersion: 2 }).wakeResponse, wakeResponsePreset('xiaomi').text);
  assert.equal(migrateWakeResponse({ deviceType: 'xiaomi', wakeResponse: '我在' }).wakeResponse, wakeResponsePreset('xiaomi').text);
  assert.equal(migrateWakeResponse({ deviceType: 'xiaomi', wakeResponse: '自定义回应' }).wakeResponse, '自定义回应');
  assert.equal(migrateWakeResponse({ deviceType: 'baidu', wakeResponse: '在呢' }).wakeResponse, wakeResponsePreset('baidu').text);
});
test('Xiaodu includes all user-provided replies and upgrades only the old default', () => {
  assert.deepEqual(wakeResponsePreset('baidu').responses, ['在呢', '来喽哦', '嗯', '哎', '我在']);
  assert.equal(migrateWakeResponse({ deviceType: 'baidu', wakeResponse: '在呢', wakeResponsePresetVersion: 3 }).wakeResponse, wakeResponsePreset('baidu').text);
  assert.equal(migrateWakeResponse({ deviceType: 'baidu', wakeResponse: '自定义回应', wakeResponsePresetVersion: 3 }).wakeResponse, '自定义回应');
  assert.equal(migrateWakeResponse({ deviceType: 'baidu', wakeResponse: '在呢', wakeResponsePresetVersion: 4 }).wakeResponse, '在呢');
});
test('response presets retain sources and auto-selection retains available saved devices', () => {
  for (const type of ['xiaomi', 'baidu', 'google']) assert.match(wakeResponsePreset(type).source.url, /^https:\/\//);
  const devices = [{ kind: 'input', deviceId: 'first' }, { kind: 'input', deviceId: 'default-mic', default: true }, { kind: 'output', deviceId: 'speaker', default: true }];
  assert.deepEqual(selectAudioDevices(devices, { inputDeviceId: 'missing' }), { inputDeviceId: 'default-mic', outputDeviceId: 'speaker' });
  assert.equal(selectAudioDevices(devices, { inputDeviceId: 'first' }).inputDeviceId, 'first');
});
test('audio source reuses generated blob or existing authenticated audio download', async () => {
  const blob = new Blob(['generated'], { type: 'audio/mpeg' });
  const file = await resolveAudioFile({ id: 'a', audioBlob: blob, caseTitle: '问天气' });
  assert.equal(await file.text(), 'generated');
  const requests = [];
  const remote = await resolveAudioFile({ id: 'b', audioUrl: '/api/test-audios/b/audio' }, async url => { requests.push(url); return blob; });
  assert.deepEqual(requests, ['/api/test-audios/b/audio']);
  assert.equal(await remote.text(), 'generated');
  await assert.rejects(resolveAudioFile({ id: 'missing' }), /重新生成/);
});
