import assert from 'node:assert/strict';
import { buildGeneratedAudioConfig } from '../src/utils/testCaseAudioConfig.js';

const config = buildGeneratedAudioConfig({
  voiceValue: 'zh-CN:zh_female_wanwanxiaohe_moon_bigtts',
  lang: 'zh-CN',
  volume: 85,
  rate: 1.3,
});

assert.equal(config.voice, 'zh-CN:zh_female_wanwanxiaohe_moon_bigtts');
assert.equal(config.voiceType, 'zh_female_wanwanxiaohe_moon_bigtts');
assert.equal(config.voiceName, '湾湾小何');
assert.equal(config.lang, 'zh-CN');
assert.equal(config.provider, 'doubao-v3');
assert.equal(config.volume, 85);
assert.equal(config.rate, 1.3);

const fallbackConfig = buildGeneratedAudioConfig({
  voiceValue: 'missing-voice',
  lang: 'ja-JP',
});

assert.equal(fallbackConfig.voice, 'ja-JP:ja_female_bv522_uranus_bigtts');
assert.equal(fallbackConfig.voiceType, 'ja_female_bv522_uranus_bigtts');
assert.equal(fallbackConfig.voiceName, 'Hana');
assert.equal(fallbackConfig.lang, 'ja-JP');
assert.equal(fallbackConfig.provider, 'doubao-v3');
assert.equal(fallbackConfig.volume, 100);
assert.equal(fallbackConfig.rate, 1);

const languageFirstConfig = buildGeneratedAudioConfig({
  voiceValue: 'zh-CN:zh_female_wanwanxiaohe_moon_bigtts',
  lang: 'en-US',
});

assert.equal(languageFirstConfig.voice, 'en-US:en_female_dacey_uranus_bigtts');
assert.equal(languageFirstConfig.voiceType, 'en_female_dacey_uranus_bigtts');
assert.equal(languageFirstConfig.voiceName, 'Dacey');
assert.equal(languageFirstConfig.lang, 'en-US');

const maleLanguageFirstConfig = buildGeneratedAudioConfig({
  voiceValue: 'zh-CN:zh_male_m191_uranus_bigtts',
  lang: 'ja-JP',
});

assert.equal(maleLanguageFirstConfig.voice, 'ja-JP:ja_male_bv524_uranus_bigtts');
assert.equal(maleLanguageFirstConfig.voiceType, 'ja_male_bv524_uranus_bigtts');
assert.equal(maleLanguageFirstConfig.voiceName, 'Ken');
assert.equal(maleLanguageFirstConfig.gender, 'male');
assert.equal(maleLanguageFirstConfig.lang, 'ja-JP');
