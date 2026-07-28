import {
  findVoiceOption,
  getVoiceForLangAndGender,
  normalizeVoiceConfigByLang,
  VOICE_OPTIONS,
} from '../constants/index.js';

export function buildGeneratedAudioConfig({
  voiceValue,
  lang,
  volume = 100,
  rate = 1,
} = {}) {
  const selected = findVoiceOption(voiceValue);
  const languageVoice = getVoiceForLangAndGender(
    lang || selected?.lang || 'zh-CN',
    selected?.gender || 'female'
  );

  return normalizeVoiceConfigByLang({
    voice: languageVoice?.value || selected?.value || VOICE_OPTIONS[0]?.value || '',
    voiceType: languageVoice?.voiceType || selected?.voiceType || '',
    lang: languageVoice?.lang || lang || selected?.lang || 'zh-CN',
    gender: languageVoice?.gender || selected?.gender || 'female',
    volume: Number(volume) || 100,
    rate: Number(rate) || 1,
  });
}
