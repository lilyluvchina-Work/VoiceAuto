import assert from 'node:assert/strict';
import { buildGeneratedAudioConfig } from '../src/utils/testCaseAudioConfig.js';

const config = buildGeneratedAudioConfig({
  voiceValue: 'zh_female_xiaohe_uranus_bigtts',
  lang: 'zh-CN',
  volume: 85,
  rate: 1.3,
});

assert.equal(config.voice, 'zh_female_xiaohe_uranus_bigtts');
assert.equal(config.voiceType, 'zh_female_xiaohe_uranus_bigtts');
assert.equal(config.voiceName, '小何 2.0');
assert.equal(config.lang, 'zh-CN');
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
