import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';

function createMockPool() {
  const users = new Map();
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
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM user_account') && (params[0] === 'LilyLuv' || params[0] === 7)) {
        return { rows: [users.get('LilyLuv')] };
      }
      if (normalized.includes('FROM user_account') && params[0] === 'MiaOps') {
        const user = users.get('MiaOps');
        return { rows: user ? [user] : [] };
      }
      if (normalized.startsWith('INSERT INTO user_account')) {
        const [username, loginAccount, passwordHash, passwordSalt, passwordAlgorithm, role, status] = params;
        const user = {
          id: users.size + 7,
          username,
          login_account: loginAccount,
          password_hash: passwordHash,
          password_salt: passwordSalt,
          password_algorithm: passwordAlgorithm,
          role,
          status,
          last_login_time: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        users.set(loginAccount, user);
        return {
          rows: [user],
        };
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
  now: () => new Date('2026-07-23T00:00:00.000Z'),
});
const server = createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const salt = 'abc123';
  const password = 'Sdmc1234';
  const expectedHash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}${password}`)
  ).then((buffer) => Array.from(new Uint8Array(buffer)).map((item) => item.toString(16).padStart(2, '0')).join(''));
  assert.equal(expectedHash, 'a432dd981702c5b41f600bc06bab088169e950be28b99e7833e17bed5d106c06');

  const login = await request(server, 'POST', '/api/auth/login', {
    loginAccount: 'LilyLuv',
    password,
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.success, true);
  assert.equal(login.body.user.loginAccount, 'LilyLuv');
  assert.equal(login.body.user.permissions.includes('config_manage'), true);
  assert.equal('passwordHash' in login.body.user, false);
  assert.equal('passwordSalt' in login.body.user, false);

  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /voiceauto_session=/);

  const profile = await request(server, 'GET', '/api/auth/profile', null, cookie);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.loginAccount, 'LilyLuv');

  const restartedServer = createServer(createApp({
    pool: createMockPool(),
    sessionStore: new Map(),
  }));
  await new Promise((resolve) => restartedServer.listen(0, '127.0.0.1', resolve));
  try {
    const restartedProfile = await request(restartedServer, 'GET', '/api/auth/profile', null, cookie);
    assert.equal(restartedProfile.status, 200);
    assert.equal(restartedProfile.body.user.loginAccount, 'LilyLuv');
  } finally {
    await new Promise((resolve) => restartedServer.close(resolve));
  }

  const createUser = await request(server, 'POST', '/api/users', {
    username: 'MiaOps',
    loginAccount: 'MiaOps',
    password: 'Mia12345',
    role: 'test_lead',
    status: 'enabled',
  }, cookie);
  assert.equal(createUser.status, 201);
  assert.equal(createUser.body.user.loginAccount, 'MiaOps');
  assert.equal(createUser.body.user.role, 'test_lead');
  assert.equal('passwordHash' in createUser.body.user, false);

  const newUserLogin = await request(server, 'POST', '/api/auth/login', {
    loginAccount: 'MiaOps',
    password: 'Mia12345',
  });
  assert.equal(newUserLogin.status, 200);
  assert.equal(newUserLogin.body.user.permissions.includes('test_execute'), true);
  assert.equal(newUserLogin.body.user.permissions.includes('config_manage'), false);

  const bad = await request(server, 'POST', '/api/auth/login', {
    loginAccount: 'LilyLuv',
    password: 'wrong',
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.message, '密码错误');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
