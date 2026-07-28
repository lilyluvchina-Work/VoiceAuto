import assert from 'node:assert/strict';
import {
  getDefaultVoiceForLang,
  getVoiceForLangAndGender,
  getVoiceOptionsForLang,
  LANG_OPTIONS,
  normalizeLangValue,
  normalizeVoiceConfigByLang,
  VOICE_OPTIONS,
} from '../src/constants/index.js';

const chineseVoice = getDefaultVoiceForLang('zh-CN');
assert.ok(chineseVoice, 'should include Doubao V3 Chinese voice');
assert.equal(chineseVoice.voiceType, 'zh_female_wanwanxiaohe_moon_bigtts');
assert.equal(chineseVoice.label, '湾湾小何（中文女声）');
assert.equal(chineseVoice.lang, 'zh-CN');
assert.equal(chineseVoice.provider, 'doubao-v3');

const multiVoice = getDefaultVoiceForLang('multi');
assert.ok(multiVoice, 'should include seed-tts-2.0 compatible multilingual voice');
assert.equal(multiVoice.voiceType, 'zh_female_vv_uranus_bigtts');
assert.equal(multiVoice.lang, 'multi');
assert.equal(multiVoice.provider, 'doubao-v3');

const englishVoice = getDefaultVoiceForLang('en-US');
assert.equal(englishVoice.voiceType, 'en_female_dacey_uranus_bigtts');
assert.equal(englishVoice.lang, 'en-US');
assert.equal(getVoiceForLangAndGender('en-US', 'male').voiceType, 'en_male_tim_uranus_bigtts');

const japaneseVoice = getDefaultVoiceForLang('ja-JP');
assert.equal(japaneseVoice.voiceType, 'ja_female_bv522_uranus_bigtts');
assert.equal(japaneseVoice.lang, 'ja-JP');
assert.equal(getVoiceForLangAndGender('ja-JP', 'male').voiceType, 'ja_male_bv524_uranus_bigtts');

const koreanVoice = getDefaultVoiceForLang('ko-KR');
assert.equal(koreanVoice.voiceType, 'ko_female_bv546_uranus_bigtts');
assert.equal(koreanVoice.lang, 'ko-KR');
assert.equal(getVoiceForLangAndGender('ko-KR', 'male').voiceType, 'ko_male_m03_uranus_bigtts');

for (const lang of LANG_OPTIONS) {
  const voices = getVoiceOptionsForLang(lang.value);
  assert.equal(voices.length, 2);
  assert.equal(voices.filter((voice) => voice.gender === 'female').length, 1);
  assert.equal(voices.filter((voice) => voice.gender === 'male').length, 1);
}

assert.equal(VOICE_OPTIONS.filter((voice) => voice.lang === 'multi').length, 2);
assert.equal(new Set(VOICE_OPTIONS.map((voice) => voice.value)).size, VOICE_OPTIONS.length);
assert.equal(VOICE_OPTIONS.some((voice) => /mars|emo_v2/.test(voice.voiceType)), false);
assert.equal(VOICE_OPTIONS.some((voice) => voice.voiceType === 'multi_female_maomao_conversation_wvae_bigtts'), false);

const normalized = normalizeVoiceConfigByLang({
  lang: 'en-US',
  voiceType: 'zh_female_wanwanxiaohe_moon_bigtts',
  voiceName: '湾湾小何',
});
assert.equal(normalized.lang, 'en-US');
assert.equal(normalized.voiceType, 'en_female_dacey_uranus_bigtts');
assert.equal(normalized.voiceName, 'Dacey');
const maleNormalized = normalizeVoiceConfigByLang({
  lang: 'ja-JP',
  voiceType: 'en_male_tim_uranus_bigtts',
});
assert.equal(maleNormalized.lang, 'ja-JP');
assert.equal(maleNormalized.gender, 'male');
assert.equal(maleNormalized.voiceType, 'ja_male_bv524_uranus_bigtts');
assert.equal(normalizeLangValue('粤语'), 'zh-HK');
assert.equal(normalizeLangValue('English'), 'en-US');

assert.ok(LANG_OPTIONS.some((lang) => lang.value === 'ja-JP'));
assert.ok(LANG_OPTIONS.some((lang) => lang.value === 'ko-KR'));
assert.ok(LANG_OPTIONS.some((lang) => lang.value === 'multi'));
