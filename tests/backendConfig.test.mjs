import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';

function createMockPool() {
  const users = new Map();
  const configs = new Map();
  users.set('LilyLuv', {
    id: 7,
    username: 'LilyLuv',
    login_account: 'LilyLuv',
    password_hash: 'a432dd981702c5b41f600bc06bab088169e950be28b99e7833e17bed5d106c06',
    password_salt: 'abc123',
    password_algorithm: 'sha256_salt_v1',
    role: 'admin',
    status: 'enabled',
    last_login_time: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return {
    configs,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM user_account') && (params[0] === 'LilyLuv' || params[0] === 7)) {
        return { rows: [users.get('LilyLuv')] };
      }
      if (normalized.startsWith('INSERT INTO app_config')) {
        const [configType, payload, updatedBy] = params;
        const previous = configs.get(configType);
        const row = {
          config_type: configType,
          payload,
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
          created_at: previous?.created_at || new Date().toISOString(),
          version: Number(previous?.version || 0) + 1,
        };
        configs.set(configType, row);
        return { rows: [row] };
      }
      if (normalized.includes('FROM app_config') && normalized.includes('WHERE config_type = $1')) {
        const row = configs.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (normalized.includes('FROM app_config')) {
        return { rows: Array.from(configs.values()) };
      }
      return { rows: [] };
    },
  };
}

async function request(server, method, path, body, cookie = '') {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

const app = createApp({
  pool: createMockPool(),
  sessionStore: new Map(),
});
const server = createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const unauthenticated = await request(server, 'GET', '/api/configs/tapd');
  assert.equal(unauthenticated.status, 401);

  const login = await request(server, 'POST', '/api/auth/login', {
    loginAccount: 'LilyLuv',
    password: 'Sdmc1234',
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');

  const missing = await request(server, 'GET', '/api/configs/tapd', null, cookie);
  assert.equal(missing.status, 200);
  assert.equal(missing.body.success, true);
  assert.equal(missing.body.config.configured, false);

  const saved = await request(server, 'PUT', '/api/configs/tapd', {
    config: {
      apiUser: 'tapd-app-a2b2d6',
      apiPassword: 'secret-password',
      workspaceId: '61252348',
      companyId: '52890462',
      enabled: true,
    },
  }, cookie);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.success, true);
  assert.equal(saved.body.config.configured, true);
  assert.equal(saved.body.config.apiPassword, 'secret-password');

  const loaded = await request(server, 'GET', '/api/configs/tapd', null, cookie);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.config.workspaceId, '61252348');
  assert.equal(loaded.body.config.apiPassword, 'secret-password');

  const savedMiniMax = await request(server, 'PUT', '/api/configs/minimax', {
    config: {
      configName: 'MiniMax 评测模型',
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: 'sk-minimax-db-secret',
      model: 'MiniMax-M2.7',
      enabled: true,
    },
  }, cookie);
  assert.equal(savedMiniMax.status, 200);
  assert.equal(savedMiniMax.body.success, true);
  assert.equal(savedMiniMax.body.config.configured, true);
  assert.equal(savedMiniMax.body.config.apiKey, 'sk-minimax-db-secret');

  const loadedMiniMax = await request(server, 'GET', '/api/configs/minimax', null, cookie);
  assert.equal(loadedMiniMax.status, 200);
  assert.equal(loadedMiniMax.body.config.model, 'MiniMax-M2.7');
  assert.equal(loadedMiniMax.body.config.apiKey, 'sk-minimax-db-secret');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
