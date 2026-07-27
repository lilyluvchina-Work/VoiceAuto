import assert from 'node:assert/strict';
import { LANG_OPTIONS, VOICE_OPTIONS } from '../src/constants/index.js';

const chineseVoice = VOICE_OPTIONS.find((voice) => voice.value === 'zh_female_vv_uranus_bigtts');
assert.ok(chineseVoice, 'should include Doubao V3 Chinese voice');
assert.equal(chineseVoice.voiceType, 'zh_female_vv_uranus_bigtts');
assert.equal(chineseVoice.lang, 'zh-CN');
assert.equal(chineseVoice.provider, 'doubao-v3');

const multiVoice = VOICE_OPTIONS.find((voice) => voice.value === 'zh_female_vv_uranus_bigtts_multi');
assert.ok(multiVoice, 'should include seed-tts-2.0 compatible multilingual voice');
assert.equal(multiVoice.voiceType, 'zh_female_vv_uranus_bigtts');
assert.equal(multiVoice.lang, 'multi');
assert.equal(multiVoice.provider, 'doubao-v3');

assert.equal(VOICE_OPTIONS.filter((voice) => voice.lang === 'zh-CN').length, 9);
assert.equal(VOICE_OPTIONS.filter((voice) => voice.lang === 'en-US').length, 0);
assert.equal(VOICE_OPTIONS.filter((voice) => voice.lang === 'multi').length, 1);
assert.equal(new Set(VOICE_OPTIONS.map((voice) => voice.value)).size, VOICE_OPTIONS.length);
assert.equal(VOICE_OPTIONS.some((voice) => /mars|emo_v2/.test(voice.voiceType)), false);
assert.equal(VOICE_OPTIONS.some((voice) => voice.voiceType === 'multi_female_maomao_conversation_wvae_bigtts'), false);

assert.ok(LANG_OPTIONS.some((lang) => lang.value === 'ja-JP'));
assert.ok(LANG_OPTIONS.some((lang) => lang.value === 'ko-KR'));
assert.ok(LANG_OPTIONS.some((lang) => lang.value === 'multi'));
