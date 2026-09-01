import assert from 'node:assert/strict';

import {
  DEVICE_TYPES,
  LOG_SOURCES,
  getDeviceProfile,
  resolveDeviceRuntimeOptions,
} from '../src/config/deviceProfiles.js';

const speaker = getDeviceProfile();
assert.equal(speaker.type, DEVICE_TYPES.SPEAKER);
assert.equal(speaker.label, 'Speaker');

const toy = getDeviceProfile(DEVICE_TYPES.AI_TOY);
assert.equal(toy.label, 'AI玩具');
assert.match(toy.wake.keywords.join('\n'), /VOICE WAKE WORD HIT ACCEPTED/);
assert.match(toy.input.endKeywords.join('\n'), /Cedar: Input Text/);
assert.match(toy.input.extractPatterns.join('\n'), /Cedar: Input Text/);
assert.match(toy.response.firstAudioKeywords.join('\n'), /Audio latency first_downlink_audio/);
assert.match(toy.response.playbackDoneKeywords.join('\n'), /TTS playback done/);
assert.match(toy.failure.keywords.join('\n'), /WS response timeout/);
assert.match(toy.failure.keywords.join('\n'), /Guru Meditation/);

const runtime = resolveDeviceRuntimeOptions({
  device: {
    type: DEVICE_TYPES.AI_TOY,
    logSource: LOG_SOURCES.SERIAL,
    serialPort: 'COM7',
    baudrate: 115200,
  },
});
assert.equal(runtime.profile.label, 'AI玩具');
assert.equal(runtime.logSource, LOG_SOURCES.SERIAL);
assert.equal(runtime.serialPort, 'COM7');
assert.equal(runtime.baudrate, 115200);
