import assert from 'node:assert/strict';
import { LANG_OPTIONS, VOICE_OPTIONS } from '../src/constants/index.js';

const chineseVoice = VOICE_OPTIONS.find((voice) => voice.value === 'zh_female_vv_uranus_bigtts');
assert.ok(chineseVoice, 'should include Doubao V3 Chinese voice');
assert.equal(chineseVoice.voiceType, 'zh_female_vv_uranus_bigtts');
assert.equal(chineseVoice.lang, 'zh-CN');
assert.equal(chineseVoice.provider, 'doubao-v3');

const englishVoice = VOICE_OPTIONS.find((voice) => voice.value === 'en_female_skye_emo_v2_mars_bigtts');
assert.ok(englishVoice, 'should include Doubao V3 English voice');
assert.equal(englishVoice.voiceType, 'en_female_skye_emo_v2_mars_bigtts');
assert.equal(englishVoice.lang, 'en-US');
assert.equal(englishVoice.provider, 'doubao-v3');

assert.ok(LANG_OPTIONS.some((lang) => lang.value === 'ja-JP'));
assert.ok(LANG_OPTIONS.some((lang) => lang.value === 'ko-KR'));
assert.ok(LANG_OPTIONS.some((lang) => lang.value === 'multi'));
