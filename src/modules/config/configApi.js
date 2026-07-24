import {
  CONFIG_TYPES,
  enableRuntimeConfigStorage,
  readConfig,
  saveConfig,
} from './secureConfigStore.js';

const API_BASE = '/api/configs';
const REMOTE_META_FIELDS = new Set([
  'type',
  'configured',
  'hasSecrets',
  'version',
  'updatedAt',
  'updatedBy',
  'createdAt',
  'payload',
]);

function getRuntimeStorage() {
  return enableRuntimeConfigStorage();
}

function stripRemoteMeta(config = {}) {
  return Object.fromEntries(
    Object.entries(config || {}).filter(([key]) => !REMOTE_META_FIELDS.has(key))
  );
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.message || `HTTP ${response.status}`);
  }
  return body;
}

export async function loadDatabaseConfig(type) {
  const storage = getRuntimeStorage();
  const body = await requestJson(`${API_BASE}/${encodeURIComponent(type)}`);
  if (body.config?.configured) {
    saveConfig(type, stripRemoteMeta(body.config), { storage, actor: body.config.updatedBy || 'database' });
  }
  return readConfig(type, { storage, includeSecrets: true });
}

export async function saveDatabaseConfig(type, input) {
  const storage = getRuntimeStorage();
  saveConfig(type, input, { storage, actor: 'config-center' });
  const plainConfig = readConfig(type, { storage, includeSecrets: true });
  const body = await requestJson(`${API_BASE}/${encodeURIComponent(type)}`, {
    method: 'PUT',
    body: JSON.stringify({ config: stripRemoteMeta(plainConfig) }),
  });
  saveConfig(type, stripRemoteMeta(body.config), { storage, actor: body.config?.updatedBy || 'database' });
  return readConfig(type, { storage, includeSecrets: false });
}

export async function loadAllDatabaseConfigs() {
  const storage = getRuntimeStorage();
  const body = await requestJson(API_BASE);
  (body.configs || []).forEach((record) => {
    if (!record?.configured) return;
    saveConfig(record.type, stripRemoteMeta({ ...record, ...(record.payload || {}) }), {
      storage,
      actor: record.updatedBy || 'database',
    });
  });
  return Object.values(CONFIG_TYPES).map((type) => readConfig(type, { storage }));
}
