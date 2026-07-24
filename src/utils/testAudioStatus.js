export function isGeneratedTestAudio(audio) {
  return audio?.audioStatus === 'generated';
}
