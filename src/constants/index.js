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
    value: 'zh_female_xiaohe_uranus_bigtts',
    voiceType: 'zh_female_xiaohe_uranus_bigtts',
    label: '小何 2.0（中文女声）',
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
    value: 'zh_female_qingxinnvsheng_uranus_bigtts',
    voiceType: 'zh_female_qingxinnvsheng_uranus_bigtts',
    label: '清新女声 2.0（中文女声）',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'doubao-v3',
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
    value: 'zh_male_m191_uranus_bigtts',
    voiceType: 'zh_male_m191_uranus_bigtts',
    label: '云舟 2.0（中文男声）',
    lang: 'zh-CN',
    gender: 'male',
    provider: 'doubao-v3',
  },
  {
    value: 'zh_male_taocheng_uranus_bigtts',
    voiceType: 'zh_male_taocheng_uranus_bigtts',
    label: '小天 2.0（中文男声）',
    lang: 'zh-CN',
    gender: 'male',
    provider: 'doubao-v3',
  },
  {
    value: 'zh_male_liufei_uranus_bigtts',
    voiceType: 'zh_male_liufei_uranus_bigtts',
    label: '刘飞 2.0（中文男声）',
    lang: 'zh-CN',
    gender: 'male',
    provider: 'doubao-v3',
  },
  {
    value: 'zh_female_vv_uranus_bigtts_multi',
    voiceType: 'zh_female_vv_uranus_bigtts',
    label: 'Vivi 2.0（多语种兼容）',
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
