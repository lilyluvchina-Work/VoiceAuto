function hasDoubaoVoiceType(config = {}) {
  return Boolean(config.voiceType || (config.voice && String(config.voice).includes('_')));
}

export function shouldUseDoubaoTts({ serviceProvider, requestConfig } = {}) {
  const provider = String(serviceProvider || '').toLowerCase();
  const requestProvider = String(requestConfig?.provider || '').toLowerCase();
  return provider === 'doubao'
    || requestProvider === 'doubao-v3'
    || requestProvider === 'doubao'
    || hasDoubaoVoiceType(requestConfig);
}

export function shouldFallbackToWebSpeech({ requestConfig } = {}) {
  return !(
    String(requestConfig?.provider || '').toLowerCase() === 'doubao-v3'
    || hasDoubaoVoiceType(requestConfig)
  );
}

export function resolveDoubaoClientProxyPath(value) {
  const text = String(value || '').trim();
  if (text.startsWith('/api/')) return text;
  return '/api/tts/doubao-v3';
}
