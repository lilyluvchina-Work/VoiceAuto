import { SENSITIVE_DEFAULT_CONFIG } from '../../config/sensitiveDefaults.js';

const STORAGE_KEY = 'voiceauto_secure_configs_v1';
const CIPHER_PREFIX = 'voiceauto:v1:';
const DEFAULT_ACTOR = 'local-user';
const LANGFUSE_ENV_SECRET_FIELDS = ['publicKey', 'secretKey', 'projectId'];
const runtimeConfigStorage = {
  value: '',
  getItem(key) {
    return key === STORAGE_KEY ? this.value : null;
  },
  setItem(key, value) {
    if (key === STORAGE_KEY) this.value = value;
  },
  removeItem(key) {
    if (key === STORAGE_KEY) this.value = '';
  },
};
let runtimeConfigStorageEnabled = false;

export const CONFIG_TYPES = {
  LANGFUSE: 'langfuse',
  TAPD: 'tapd',
  DINGTALK: 'dingtalk',
  DOUBAO_TTS: 'doubaoTts',
  SERVER: 'server',
  DATABASE: 'database',
};

const DEPRECATED_CONFIG_FIELDS = {
  [CONFIG_TYPES.DOUBAO_TTS]: ['accessKeyId', 'secretAccessKey', 'apiKey'],
};

export const CONFIG_SCHEMAS = {
  [CONFIG_TYPES.LANGFUSE]: {
    label: 'Langfuse 配置',
    required: ['envKey', 'label', 'proxyBase', 'publicKey', 'secretKey'],
    sensitive: ['publicKey', 'secretKey', 'projectId'],
    defaults: {
      ...SENSITIVE_DEFAULT_CONFIG.langfuse.environments[0],
      enabled: true,
      defaultTimeRange: '1h',
      maxLimit: 1000,
      timeout: 30000,
    },
  },
  [CONFIG_TYPES.TAPD]: {
    label: 'TAPD 配置',
    required: ['baseUrl', 'workspaceId', 'companyId', 'apiUser', 'apiPassword'],
    sensitive: ['companyId', 'tapdProjectId', 'apiUser', 'apiPassword'],
    defaults: {
      ...SENSITIVE_DEFAULT_CONFIG.tapd,
      configName: '默认 TAPD 配置',
      baseUrl: 'https://api.tapd.cn',
      enabled: true,
      timeout: 10000,
      debugDirectoryMapping: false,
    },
  },
  [CONFIG_TYPES.DINGTALK]: {
    label: '钉钉机器人配置',
    required: [],
    sensitive: ['webhook', 'accessToken', 'secret'],
    defaults: {
      enabled: false,
      proxyPath: '/dingtalk-robot',
      groupName: '',
      ...SENSITIVE_DEFAULT_CONFIG.dingTalk,
    },
  },
  [CONFIG_TYPES.DOUBAO_TTS]: {
    label: '豆包 TTS 配置',
    required: ['apiKeyId', 'apiKeySecret'],
    sensitive: ['apiKeyId', 'apiKeySecret', 'secretKey'],
    defaults: {
      provider: 'doubao',
      apiVersion: 'v3',
      v3Url: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      resourceId: 'seed-tts-2.0',
      defaultVoiceType: 'zh_female_wanwanxiaohe_moon_bigtts',
      uid: 'voiceauto-web',
      sampleRate: 24000,
      enabled: true,
      apiKeyId: '',
      apiKeySecret: '',
      secretKey: '',
    },
  },
  [CONFIG_TYPES.SERVER]: {
    label: '服务器配置',
    required: [],
    sensitive: ['host', 'deployPath', 'sshPort', 'sshUser', 'sshPassword', 'sshPrivateKey', 'logPath', 'storagePath', 'startCommand'],
    defaults: {
      serverName: '',
      os: '',
      servicePort: '',
      adbPath: '',
      adbDeviceId: '',
      chromePath: '',
      serviceStatus: 'unknown',
      enabled: false,
    },
  },
  [CONFIG_TYPES.DATABASE]: {
    label: '数据库配置',
    required: [],
    sensitive: ['host', 'databaseName', 'username', 'password', 'sslConfig'],
    defaults: {
      type: 'mysql',
      port: '3306',
      poolSize: '10',
      backupStrategy: '',
      retentionDays: '90',
      enabled: false,
    },
  },
};

const DEFAULT_LANGFUSE_ENVIRONMENTS = Object.fromEntries(
  SENSITIVE_DEFAULT_CONFIG.langfuse.environments.map((environment) => [environment.envKey, environment])
);

function getStorage(storage) {
  if (storage) return storage;
  if (runtimeConfigStorageEnabled) return runtimeConfigStorage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

export function enableRuntimeConfigStorage() {
  runtimeConfigStorageEnabled = true;
  return runtimeConfigStorage;
}

export function disableRuntimeConfigStorage() {
  runtimeConfigStorageEnabled = false;
  runtimeConfigStorage.removeItem(STORAGE_KEY);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function encodeBase64(value) {
  const text = String(value ?? '');
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(text)));
  }
  return Buffer.from(text, 'utf8').toString('base64');
}

function decodeBase64(value) {
  if (typeof atob === 'function') {
    return decodeURIComponent(escape(atob(value)));
  }
  return Buffer.from(value, 'base64').toString('utf8');
}

function xorText(value) {
  const key = 'VoiceAutoLocalConfigKey';
  return Array.from(String(value ?? ''), (char, index) => {
    const code = char.charCodeAt(0) ^ key.charCodeAt(index % key.length);
    return String.fromCharCode(code);
  }).join('');
}

export function encryptSensitiveValue(value) {
  const text = String(value ?? '');
  if (!text) return '';
  return `${CIPHER_PREFIX}${encodeBase64(xorText(text))}`;
}

export function decryptSensitiveValue(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (!text.startsWith(CIPHER_PREFIX)) return text;
  return xorText(decodeBase64(text.slice(CIPHER_PREFIX.length)));
}

export function maskSensitiveValue(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (text.length <= 4) return '****';
  if (text.length <= 8) return `${text.slice(0, 2)}****${text.slice(-2)}`;
  return `${text.slice(0, 6)}****${text.slice(-4)}`;
}

function readStore(storage) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return { configs: {}, logs: [] };
  try {
    const parsed = JSON.parse(targetStorage.getItem(STORAGE_KEY) || '{}');
    return {
      configs: parsed.configs && typeof parsed.configs === 'object' ? parsed.configs : {},
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
  } catch {
    return { configs: {}, logs: [] };
  }
}

function writeStore(store, storage) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return;
  targetStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getSchema(type) {
  const schema = CONFIG_SCHEMAS[type];
  if (!schema) throw new Error(`Unknown config type: ${type}`);
  return schema;
}

function splitConfig(type, input) {
  const schema = getSchema(type);
  const sensitiveSet = new Set(schema.sensitive);
  const deprecatedSet = new Set(DEPRECATED_CONFIG_FIELDS[type] || []);
  const normalConfig = {};
  const secretConfig = {};
  const secretMask = {};
  const mergedInput = { ...schema.defaults, ...(input || {}) };

  Object.entries(mergedInput).forEach(([key, value]) => {
    if (deprecatedSet.has(key)) return;
    if (sensitiveSet.has(key)) {
      const text = normalizeText(value);
      if (text) {
        secretConfig[key] = encryptSensitiveValue(text);
        secretMask[key] = maskSensitiveValue(text);
      }
      return;
    }
    normalConfig[key] = value;
  });

  return { normalConfig, secretConfig, secretMask };
}

function normalizeLangfuseEnvKey(value, fallback) {
  return normalizeText(value || fallback || 'UAT').toUpperCase();
}

function normalizeLangfuseEnvironment(input = {}, index = 0) {
  const envKey = normalizeLangfuseEnvKey(input.envKey, input.label || `ENV_${index + 1}`);
  return {
    envKey,
    label: normalizeText(input.label) || envKey,
    proxyBase: normalizeText(input.proxyBase) || `/langfuse-api-${envKey.toLowerCase().replace(/_/g, '-')}`,
    baseUrl: normalizeText(input.baseUrl),
    publicKey: normalizeText(input.publicKey),
    secretKey: normalizeText(input.secretKey),
    projectId: normalizeText(input.projectId),
    enabled: input.enabled !== false,
  };
}

function findDefaultLangfuseEnvironment(envKey, label) {
  const normalizedKey = normalizeLangfuseEnvKey(envKey, label);
  return DEFAULT_LANGFUSE_ENVIRONMENTS[normalizedKey]
    || SENSITIVE_DEFAULT_CONFIG.langfuse.environments.find((environment) => environment.label === label)
    || {};
}

function mergeLangfuseEnvironmentDefaults(environment, index) {
  const defaults = findDefaultLangfuseEnvironment(environment.envKey, environment.label);
  const merged = {
    ...defaults,
    ...environment,
  };
  LANGFUSE_ENV_SECRET_FIELDS.forEach((field) => {
    if (!normalizeText(merged[field]) && normalizeText(defaults[field])) {
      merged[field] = defaults[field];
    }
  });
  if (!normalizeText(merged.baseUrl) && normalizeText(defaults.baseUrl)) {
    merged.baseUrl = defaults.baseUrl;
  }
  if (!normalizeText(merged.proxyBase) && normalizeText(defaults.proxyBase)) {
    merged.proxyBase = defaults.proxyBase;
  }
  return normalizeLangfuseEnvironment(merged, index);
}

function mergeBlankLangfuseSecrets(nextEnv, previousEnv = {}) {
  return LANGFUSE_ENV_SECRET_FIELDS.reduce((env, field) => {
    if (!normalizeText(env[field]) && normalizeText(previousEnv[field])) {
      return { ...env, [field]: previousEnv[field] };
    }
    return env;
  }, nextEnv);
}

function getLangfuseEnvironmentInput(input, previousPlain) {
  const rawEnvironments = Array.isArray(input?.environments) && input.environments.length > 0
    ? input.environments
    : [input || previousPlain || CONFIG_SCHEMAS[CONFIG_TYPES.LANGFUSE].defaults];
  const previousByKey = new Map(
    (previousPlain?.environments || []).map((env) => [normalizeLangfuseEnvKey(env.envKey, env.label), env])
  );
  return rawEnvironments.map((env, index) => {
    const normalized = normalizeLangfuseEnvironment(env, index);
    return mergeBlankLangfuseSecrets(normalized, previousByKey.get(normalized.envKey));
  });
}

function maskLangfuseEnvironment(env) {
  return {
    ...env,
    publicKey: maskSensitiveValue(env.publicKey),
    secretKey: maskSensitiveValue(env.secretKey),
    projectId: maskSensitiveValue(env.projectId),
  };
}

function splitLangfuseConfig(input, previousPlain) {
  const environments = getLangfuseEnvironmentInput(input, previousPlain);
  const primary = environments[0] || normalizeLangfuseEnvironment(input);
  const legacyInput = { ...(input || {}), ...primary };
  delete legacyInput.environments;

  const split = splitConfig(CONFIG_TYPES.LANGFUSE, legacyInput);
  split.secretConfig.environments = encryptSensitiveValue(JSON.stringify(environments));
  split.secretMask.environments = environments.map(maskLangfuseEnvironment);
  return split;
}

function getRetainedSecretConfig(type, secretConfig = {}, schema) {
  const retainKeys = new Set(schema.sensitive);
  if (type === CONFIG_TYPES.LANGFUSE) {
    retainKeys.add('environments');
  }
  return Object.fromEntries(
    Object.entries(secretConfig || {}).filter(([key]) => retainKeys.has(key))
  );
}

function readLangfuseEnvironments(record, options, schema, plainSecrets, baseConfig) {
  const encryptedEnvironments = record?.secretConfig?.environments;
  if (encryptedEnvironments) {
    try {
      const plainEnvironments = JSON.parse(decryptSensitiveValue(encryptedEnvironments));
      const sourceEnvironments = options.includeSecrets
        ? plainEnvironments
        : (record.secretMask?.environments || plainEnvironments.map(maskLangfuseEnvironment));
      return sourceEnvironments.map((environment, index) => (
        mergeLangfuseEnvironmentDefaults(environment, index)
      ));
    } catch {
      // Bad legacy/local payloads must not block app bootstrap or login rendering.
    }
  }

  return [
    mergeLangfuseEnvironmentDefaults({
      ...schema.defaults,
      ...baseConfig,
      ...(options.includeSecrets ? plainSecrets : (record?.secretMask || {})),
    }),
  ];
}

export function saveConfig(type, input, options = {}) {
  const schema = getSchema(type);
  const store = readStore(options.storage);
  const previous = store.configs[type] || {};
  const timestamp = nowIso();
  const previousPlain = previous.type ? readConfig(type, { ...options, includeSecrets: true }) : null;
  const { normalConfig, secretConfig, secretMask } = type === CONFIG_TYPES.LANGFUSE
    ? splitLangfuseConfig(input, previousPlain)
    : splitConfig(type, input);
  const nextSecretConfig = { ...getRetainedSecretConfig(type, previous.secretConfig, schema), ...secretConfig };
  const nextSecretMask = { ...getRetainedSecretConfig(type, previous.secretMask, schema), ...secretMask };

  const record = {
    type,
    label: schema.label,
    normalConfig,
    secretConfig: nextSecretConfig,
    secretMask: nextSecretMask,
    updatedBy: options.actor || DEFAULT_ACTOR,
    updatedAt: timestamp,
    createdAt: previous.createdAt || timestamp,
    version: Number(previous.version || 0) + 1,
  };

  store.configs[type] = record;
  store.logs = [
    ...(store.logs || []),
    {
      id: `${timestamp}-${type}-${record.version}`,
      configType: type,
      action: previous.type ? 'update' : 'create',
      operator: options.actor || DEFAULT_ACTOR,
      result: 'success',
      createdAt: timestamp,
      summary: `${schema.label} ${previous.type ? '更新' : '创建'}`,
    },
  ].slice(-200);
  writeStore(store, options.storage);
  return readConfig(type, { ...options, includeSecrets: false });
}

export function readConfig(type, options = {}) {
  const schema = getSchema(type);
  const deprecatedSet = new Set(DEPRECATED_CONFIG_FIELDS[type] || []);
  const record = readStore(options.storage).configs[type];
  if (!record) {
    const defaultConfig = {
      ...schema.defaults,
      type,
      configured: false,
      hasSecrets: schema.sensitive.some((field) => Boolean(normalizeText(schema.defaults[field]))),
    };
    if (type === CONFIG_TYPES.LANGFUSE) {
      defaultConfig.environments = SENSITIVE_DEFAULT_CONFIG.langfuse.environments.map((environment, index) => (
        normalizeLangfuseEnvironment(environment, index)
      ));
      defaultConfig.hasSecrets = defaultConfig.environments.some((environment) => (
        LANGFUSE_ENV_SECRET_FIELDS.some((field) => Boolean(normalizeText(environment[field])))
      ));
    }
    return defaultConfig;
  }

  const plainSecrets = Object.entries(record.secretConfig || {}).reduce((acc, [key, value]) => {
    if (deprecatedSet.has(key)) return acc;
    acc[key] = decryptSensitiveValue(value);
    return acc;
  }, {});

  const baseConfig = {
    ...schema.defaults,
    ...Object.fromEntries(
      Object.entries(record.normalConfig || {}).filter(([key]) => !deprecatedSet.has(key))
    ),
    ...(options.includeSecrets
      ? plainSecrets
      : Object.fromEntries(
        Object.entries(record.secretMask || {}).filter(([key]) => !deprecatedSet.has(key))
      )),
    type,
    configured: true,
    hasSecrets: Object.keys(record.secretConfig || {}).length > 0,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
    version: record.version,
  };

  if (type === CONFIG_TYPES.LANGFUSE) {
    baseConfig.environments = readLangfuseEnvironments(record, options, schema, plainSecrets, baseConfig);
  }

  return baseConfig;
}

export function listConfigs(options = {}) {
  return Object.keys(CONFIG_SCHEMAS).map((type) => readConfig(type, options));
}

export function getConfigStatus(type, options = {}) {
  const schema = getSchema(type);
  const config = readConfig(type, { ...options, includeSecrets: true });
  const missingRequiredFields = schema.required.filter((field) => !normalizeText(config[field]));
  return {
    type,
    label: schema.label,
    configured: config.configured,
    enabled: Boolean(config.enabled),
    complete: missingRequiredFields.length === 0,
    missingRequiredFields,
    updatedAt: config.updatedAt || '',
  };
}

export function getAllConfigStatuses(options = {}) {
  return Object.keys(CONFIG_SCHEMAS).map((type) => getConfigStatus(type, options));
}

export function getOperationLogs(options = {}) {
  return readStore(options.storage).logs || [];
}

export function getLangfuseEnvironmentMap(options = {}) {
  const configured = readConfig(CONFIG_TYPES.LANGFUSE, options);
  const envs = { ...DEFAULT_LANGFUSE_ENVIRONMENTS };
  const configuredEnvironments = configured.environments?.length ? configured.environments : [configured];
  if (configured.configured) {
    configuredEnvironments.forEach((environment) => {
      const key = normalizeLangfuseEnvKey(environment.envKey, environment.label);
      envs[key] = {
        ...envs[key],
        ...environment,
        envKey: key,
        label: environment.label || key,
        proxyBase: environment.proxyBase || envs[key]?.proxyBase || '/langfuse-api-uat',
        enabled: environment.enabled !== false,
      };
    });
  } else {
    const key = normalizeText(configured.envKey || 'UAT').toUpperCase();
    envs[key] = {
      ...envs[key],
      ...configured,
      envKey: key,
      label: configured.label || key,
      proxyBase: configured.proxyBase || envs[key]?.proxyBase || '/langfuse-api-uat',
      enabled: configured.enabled !== false,
    };
  }
  return envs;
}

export function clearConfigStore(options = {}) {
  const targetStorage = Object.prototype.hasOwnProperty.call(options, 'storage')
    ? options.storage
    : getStorage(options.storage);
  targetStorage?.removeItem(STORAGE_KEY);
}
