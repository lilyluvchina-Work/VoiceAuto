function normalize(value) {
  return String(value ?? '').trim();
}

function quoteEnvValue(value) {
  return `"${normalize(value)}"`;
}

export function buildTapdParameterRows(config = {}) {
  return [
    { label: '应用ID', value: normalize(config.apiUser) },
    { label: '应用密钥', value: normalize(config.apiPassword) },
    { label: '项目ID', value: normalize(config.workspaceId) },
    { label: '公司ID', value: normalize(config.companyId) },
  ];
}

export function buildDingTalkParameterRows(config = {}) {
  return [
    { label: 'Webhook', field: 'webhook', value: normalize(config.webhook) },
    { label: '加签', field: 'secret', value: normalize(config.secret) },
  ];
}

export function buildLangfuseParameterGroups(input = []) {
  const configs = Array.isArray(input) ? input : [input];
  return configs.map((config) => {
    const label = normalize(config.label || config.envKey || 'Langfuse');
    const lines = [
      `LANGFUSE_SECRET_KEY=${quoteEnvValue(config.secretKey)}`,
      `LANGFUSE_PUBLIC_KEY=${quoteEnvValue(config.publicKey)}`,
      `LANGFUSE_BASE_URL=${quoteEnvValue(config.baseUrl)}`,
    ];
    return {
      label,
      text: config.text || lines.join('\n'),
      lines,
    };
  });
}

export function parseLangfuseParameterText(text = '') {
  const parsed = {};
  String(text).split(/\r?\n/).forEach((line) => {
    const match = line.trim().match(/^(LANGFUSE_SECRET_KEY|LANGFUSE_PUBLIC_KEY|LANGFUSE_BASE_URL)\s*=\s*["']?([^"']*)["']?$/);
    if (!match) return;
    const [, key, value] = match;
    if (key === 'LANGFUSE_SECRET_KEY') parsed.secretKey = normalize(value);
    if (key === 'LANGFUSE_PUBLIC_KEY') parsed.publicKey = normalize(value);
    if (key === 'LANGFUSE_BASE_URL') parsed.baseUrl = normalize(value);
  });
  return parsed;
}
