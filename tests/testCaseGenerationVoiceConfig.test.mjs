import assert from 'node:assert/strict';
import { buildGeneratedAudioConfig } from '../src/utils/testCaseAudioConfig.js';

const config = buildGeneratedAudioConfig({
  voiceValue: 'en_female_skye_emo_v2_mars_bigtts',
  lang: 'en-US',
  volume: 85,
  rate: 1.3,
});

assert.equal(config.voice, 'en_female_skye_emo_v2_mars_bigtts');
assert.equal(config.voiceType, 'en_female_skye_emo_v2_mars_bigtts');
assert.equal(config.voiceName, 'Skye');
assert.equal(config.lang, 'en-US');
assert.equal(config.provider, 'doubao-v3');
assert.equal(config.volume, 85);
assert.equal(config.rate, 1.3);

const fallbackConfig = buildGeneratedAudioConfig({
  voiceValue: 'missing-voice',
  lang: 'ja-JP',
});

assert.equal(fallbackConfig.voice, 'missing-voice');
assert.equal(fallbackConfig.voiceType, 'missing-voice');
assert.equal(fallbackConfig.voiceName, 'missing-voice');
assert.equal(fallbackConfig.lang, 'ja-JP');
assert.equal(fallbackConfig.provider, 'doubao-v3');
assert.equal(fallbackConfig.volume, 100);
assert.equal(fallbackConfig.rate, 1);
