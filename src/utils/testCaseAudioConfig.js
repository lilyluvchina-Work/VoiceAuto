import { VOICE_OPTIONS } from '../constants/index.js';

function stripVoiceLabel(label) {
  return String(label || '').split('（')[0].trim();
}

export function buildGeneratedAudioConfig({
  voiceValue,
  lang,
  volume = 100,
  rate = 1,
} = {}) {
  const selected = VOICE_OPTIONS.find((voice) => (
    voice.value === voiceValue
      || voice.voiceType === voiceValue
      || voice.legacyValue === voiceValue
  ));
  const resolvedVoice = selected?.value || voiceValue || VOICE_OPTIONS[0]?.value || '';
  return {
    voice: resolvedVoice,
    voiceType: selected?.voiceType || resolvedVoice,
    voiceName: selected ? stripVoiceLabel(selected.label) : resolvedVoice,
    lang: lang || selected?.lang || 'zh-CN',
    provider: selected?.provider || 'doubao-v3',
    volume: Number(volume) || 100,
    rate: Number(rate) || 1,
  };
}
