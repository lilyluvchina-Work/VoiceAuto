// Existing database fields belong to the currently saved company account.
export function resolveDoubaoAccountConfig(config = {}) {
  if (config.activeAccount !== 'personal') return config;
  return {
    ...config,
    apiKeyId: config.personalApiKeyId || '',
    apiKeySecret: config.personalApiKeySecret || '',
    secretKey: config.personalSecretKey || '',
    resourceId: config.personalResourceId || 'seed-tts-2.0',
  };
}
