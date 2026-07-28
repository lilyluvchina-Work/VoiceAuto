/**
 * 语音与语言配置常量
 */

export function stripVoiceLabel(label) {
  return String(label || '').split('（')[0].trim();
}

export function normalizeLangValue(lang = 'zh-CN') {
  const text = String(lang || '').trim();
  const lower = text.toLowerCase();
  const aliases = {
    zh: 'zh-CN',
    'zh-cn': 'zh-CN',
    chinese: 'zh-CN',
    mandarin: 'zh-CN',
    '中文': 'zh-CN',
    '普通话': 'zh-CN',
    'zh-hk': 'zh-HK',
    'yue-cn': 'zh-HK',
    cantonese: 'zh-HK',
    '粤语': 'zh-HK',
    en: 'en-US',
    'en-us': 'en-US',
    english: 'en-US',
    'ja-jp': 'ja-JP',
    japanese: 'ja-JP',
    '日本語': 'ja-JP',
    '日语': 'ja-JP',
    'ko-kr': 'ko-KR',
    korean: 'ko-KR',
    '한국어': 'ko-KR',
    '韩语': 'ko-KR',
    multi: 'multi',
    multilingual: 'multi',
    '多语言': 'multi',
  };

  return aliases[lower] || aliases[text] || text || 'zh-CN';
}

export const VOICE_OPTIONS = [
  {
    value: 'zh-CN:zh_female_wanwanxiaohe_moon_bigtts',
    voiceType: 'zh_female_wanwanxiaohe_moon_bigtts',
    label: '湾湾小何（中文女声）',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'doubao-v3',
    legacyValues: [
      'zh_female_wanwanxiaohe_moon_bigtts',
      'zh_female_vv_uranus_bigtts',
      'zh_female_shuangkuaisisi_moon_bigtts',
      'zh_female_roumei_moon_bigtts',
      'xiaoxiao',
      'xiaoyi',
      'xiaomeng',
    ],
  },
  {
    value: 'zh-CN:zh_male_m191_uranus_bigtts',
    voiceType: 'zh_male_m191_uranus_bigtts',
    label: 'Kian（中文男声）',
    lang: 'zh-CN',
    gender: 'male',
    provider: 'doubao-v3',
    legacyValues: [
      'zh_male_m191_uranus_bigtts',
      'zh_male_qingshuangjingshen_moon_bigtts',
      'zh_male_wennuanahu_moon_bigtts',
      'zh_male_shaonianzixin_moon_bigtts',
      'yunxi',
      'yunjian',
      'xiaoyun',
    ],
  },
  {
    value: 'zh-HK:zh_female_vv_uranus_bigtts',
    voiceType: 'zh_female_vv_uranus_bigtts',
    label: 'Vivi 2.0（粤语兼容）',
    lang: 'zh-HK',
    gender: 'female',
    provider: 'doubao-v3',
  },
  {
    value: 'zh-HK:zh_male_m191_uranus_bigtts',
    voiceType: 'zh_male_m191_uranus_bigtts',
    label: 'Kian（粤语兼容男声）',
    lang: 'zh-HK',
    gender: 'male',
    provider: 'doubao-v3',
  },
  {
    value: 'en-US:en_female_dacey_uranus_bigtts',
    voiceType: 'en_female_dacey_uranus_bigtts',
    label: 'Dacey（English）',
    lang: 'en-US',
    gender: 'female',
    provider: 'doubao-v3',
  },
  {
    value: 'en-US:en_male_tim_uranus_bigtts',
    voiceType: 'en_male_tim_uranus_bigtts',
    label: 'Tim（English male）',
    lang: 'en-US',
    gender: 'male',
    provider: 'doubao-v3',
  },
  {
    value: 'ja-JP:ja_female_bv522_uranus_bigtts',
    voiceType: 'ja_female_bv522_uranus_bigtts',
    label: 'Hana（日本語）',
    lang: 'ja-JP',
    gender: 'female',
    provider: 'doubao-v3',
  },
  {
    value: 'ja-JP:ja_male_bv524_uranus_bigtts',
    voiceType: 'ja_male_bv524_uranus_bigtts',
    label: 'Ken（日本語男声）',
    lang: 'ja-JP',
    gender: 'male',
    provider: 'doubao-v3',
  },
  {
    value: 'ko-KR:ko_female_bv546_uranus_bigtts',
    voiceType: 'ko_female_bv546_uranus_bigtts',
    label: 'Momo（한국어 여성）',
    lang: 'ko-KR',
    gender: 'female',
    provider: 'doubao-v3',
  },
  {
    value: 'ko-KR:ko_male_m03_uranus_bigtts',
    voiceType: 'ko_male_m03_uranus_bigtts',
    label: 'Minho（한국어）',
    lang: 'ko-KR',
    gender: 'male',
    provider: 'doubao-v3',
  },
  {
    value: 'multi:zh_female_vv_uranus_bigtts',
    voiceType: 'zh_female_vv_uranus_bigtts',
    label: 'Vivi 2.0（多语言）',
    lang: 'multi',
    gender: 'female',
    provider: 'doubao-v3',
  },
  {
    value: 'multi:zh_male_shaonianzixin_uranus_bigtts',
    voiceType: 'zh_male_shaonianzixin_uranus_bigtts',
    label: 'Jess（多语言男声）',
    lang: 'multi',
    gender: 'male',
    provider: 'doubao-v3',
  },
];

export function findVoiceOption(value) {
  return VOICE_OPTIONS.find((voice) => (
    voice.value === value
      || voice.voiceType === value
      || voice.legacyValue === value
      || voice.legacyValues?.includes(value)
  ));
}

export function getDefaultVoiceForLang(lang = 'zh-CN') {
  const normalizedLang = normalizeLangValue(lang);
  return getVoiceOptionsForLang(normalizedLang)[0] || VOICE_OPTIONS[0];
}

export function getVoiceOptionsForLang(lang = 'zh-CN') {
  const normalizedLang = normalizeLangValue(lang);
  return VOICE_OPTIONS.filter((voice) => voice.lang === normalizedLang);
}

export function getVoiceForLangAndGender(lang = 'zh-CN', gender = 'female') {
  const voices = getVoiceOptionsForLang(lang);
  return voices.find((voice) => voice.gender === gender) || voices[0] || VOICE_OPTIONS[0];
}

export function normalizeVoiceConfigByLang(config = {}) {
  const selectedVoice = findVoiceOption(config.voiceType || config.voice);
  const selectedLang = normalizeLangValue(
    config.lang || selectedVoice?.lang || 'zh-CN'
  );
  const requestedGender = config.gender || selectedVoice?.gender || 'female';
  const voice = getVoiceForLangAndGender(selectedLang, requestedGender);

  return {
    ...config,
    voice: voice.value,
    voiceType: voice.voiceType,
    voiceName: stripVoiceLabel(voice.label),
    lang: voice.lang,
    gender: voice.gender,
    provider: voice.provider,
  };
}

export const LANG_OPTIONS = [
  { value: 'zh-CN', label: '中文（普通话）' },
  { value: 'zh-HK', label: '粤语' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'multi', label: '多语言' },
];

export const PAGE_SIZE = 10;
