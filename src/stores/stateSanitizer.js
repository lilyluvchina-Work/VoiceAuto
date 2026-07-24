export function sanitizePersistedVoiceAutoState(parsed = {}) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    ...source,
    defaultVoiceConfig: source.defaultVoiceConfig && typeof source.defaultVoiceConfig === 'object'
      ? source.defaultVoiceConfig
      : {},
    testOptions: source.testOptions && typeof source.testOptions === 'object'
      ? source.testOptions
      : {},
    testAudios: Array.isArray(source.testAudios) ? source.testAudios : [],
  };
}
