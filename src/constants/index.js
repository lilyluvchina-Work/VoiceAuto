/**
 * 语音与语言配置常量
 */

export const VOICE_OPTIONS = [
  {
    value: 'zh_female_vv_uranus_bigtts',
    voiceType: 'zh_female_vv_uranus_bigtts',
    label: 'VV（中文女声）',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'doubao-v3',
  },
  {
    value: 'zh_female_roumei_moon_bigtts',
    voiceType: 'zh_female_roumei_moon_bigtts',
    label: '柔美月声（中文女声）',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'doubao-v3',
    legacyValue: 'xiaoxiao',
  },
  {
    value: 'zh_female_wanwanxiaohe_moon_bigtts',
    voiceType: 'zh_female_wanwanxiaohe_moon_bigtts',
    label: '湾湾小荷（中文女声）',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'doubao-v3',
    legacyValue: 'xiaoyi',
  },
  {
    value: 'zh_male_qingshuangjingshen_moon_bigtts',
    voiceType: 'zh_male_qingshuangjingshen_moon_bigtts',
    label: '清爽京声（中文男声）',
    lang: 'zh-CN',
    gender: 'male',
    provider: 'doubao-v3',
    legacyValue: 'yunxi',
  },
  {
    value: 'en_female_skye_emo_v2_mars_bigtts',
    voiceType: 'en_female_skye_emo_v2_mars_bigtts',
    label: 'Skye（英文女声）',
    lang: 'en-US',
    gender: 'female',
    provider: 'doubao-v3',
  },
  {
    value: 'en_male_adam_emo_v2_mars_bigtts',
    voiceType: 'en_male_adam_emo_v2_mars_bigtts',
    label: 'Adam（英文男声）',
    lang: 'en-US',
    gender: 'male',
    provider: 'doubao-v3',
  },
  {
    value: 'multi_female_shuangkuaisisi_moon_bigtts',
    voiceType: 'zh_female_vv_uranus_bigtts',
    label: '爽快思思（多语言测试）',
    lang: 'multi',
    gender: 'female',
    provider: 'doubao-v3',
  },
];

export const LANG_OPTIONS = [
  { value: 'zh-CN', label: '中文（普通话）' },
  { value: 'zh-HK', label: '粤语' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'multi', label: '多语言' },
];

export const PAGE_SIZE = 10;
