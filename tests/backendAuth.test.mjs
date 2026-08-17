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
      if (normalized.includes('FROM user_account') && typeof params[0] === 'string') {
        const user = users.get(params[0]);
        return { rows: user ? [user] : [] };
      }
      if (normalized.includes('FROM user_account') && normalized.includes('ORDER BY created_at DESC')) {
        return { rows: Array.from(users.values()).filter((user) => user.status !== 'deleted').reverse() };
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
      if (normalized.startsWith('UPDATE user_account SET username')) {
        const [id, username, loginAccount, role, status, passwordHash, passwordSalt, passwordAlgorithm] = params;
        const entry = Array.from(users.entries()).find(([, user]) => user.id === id && user.status !== 'deleted');
        if (!entry) return { rows: [] };
        const [previousAccount, user] = entry;
        const updated = {
          ...user,
          username,
          login_account: loginAccount,
          role,
          status,
          password_hash: passwordHash || user.password_hash,
          password_salt: passwordSalt || user.password_salt,
          password_algorithm: passwordAlgorithm || user.password_algorithm,
          updated_at: new Date().toISOString(),
        };
        users.delete(previousAccount);
        users.set(loginAccount, updated);
        return { rows: [updated] };
      }
      if (normalized.startsWith("UPDATE user_account SET status = 'deleted'")) {
        const entry = Array.from(users.entries()).find(([, user]) => user.id === params[0] && user.status !== 'deleted');
        if (!entry) return { rows: [] };
        const [, user] = entry;
        user.status = 'deleted';
        user.updated_at = new Date().toISOString();
        return { rows: [user] };
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

  const userList = await request(server, 'GET', '/api/users', null, cookie);
  assert.equal(userList.status, 200);
  assert.equal(userList.body.success, true);
  assert.equal(userList.body.users.some((user) => user.loginAccount === 'MiaOps'), true);
  assert.equal(userList.body.users.some((user) => 'passwordHash' in user), false);

  const newUserLogin = await request(server, 'POST', '/api/auth/login', {
    loginAccount: 'MiaOps',
    password: 'Mia12345',
  });
  assert.equal(newUserLogin.status, 200);
  assert.equal(newUserLogin.body.user.permissions.includes('test_execute'), true);
  assert.equal(newUserLogin.body.user.permissions.includes('config_manage'), false);

  const updatedUser = await request(server, 'PUT', `/api/users/${createUser.body.user.id}`, {
    username: 'Mia Operations',
    loginAccount: 'MiaOps2',
    password: 'Mia67890',
    role: 'admin',
    status: 'enabled',
  }, cookie);
  assert.equal(updatedUser.status, 200);
  assert.equal(updatedUser.body.user.loginAccount, 'MiaOps2');
  assert.equal(updatedUser.body.user.role, 'admin');

  const updatedUserLogin = await request(server, 'POST', '/api/auth/login', {
    loginAccount: 'MiaOps2',
    password: 'Mia67890',
  });
  assert.equal(updatedUserLogin.status, 200);
  assert.equal(updatedUserLogin.body.user.permissions.includes('config_manage'), true);

  const deletedUser = await request(server, 'DELETE', `/api/users/${updatedUser.body.user.id}`, null, cookie);
  assert.equal(deletedUser.status, 200);

  const deletedUserLogin = await request(server, 'POST', '/api/auth/login', {
    loginAccount: 'MiaOps2',
    password: 'Mia67890',
  });
  assert.equal(deletedUserLogin.status, 401);

  const bad = await request(server, 'POST', '/api/auth/login', {
    loginAccount: 'LilyLuv',
    password: 'wrong',
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.message, '密码错误');

  const blockedDbServer = createServer(createApp({
    pool: {
      async query() {
        throw new Error('no pg_hba.conf entry for host "10.10.122.130", user "voiceauto_app", database "voiceauto", SSL off');
      },
    },
    sessionStore: new Map(),
  }));
  await new Promise((resolve) => blockedDbServer.listen(0, '127.0.0.1', resolve));
  try {
    const blockedLogin = await request(blockedDbServer, 'POST', '/api/auth/login', {
      loginAccount: 'LilyLuv',
      password,
    });
    assert.equal(blockedLogin.status, 503);
    assert.equal(blockedLogin.body.success, false);
    assert.equal(blockedLogin.body.errorCode, 'DB_PG_HBA_REJECTED');
    assert.equal(blockedLogin.body.message, '数据库访问被拒绝：当前机器 IP 未加入 PostgreSQL 访问白名单');
    assert.match(blockedLogin.body.detail, /10\.10\.122\.130/);

    const databaseHealth = await request(blockedDbServer, 'GET', '/api/health/database');
    assert.equal(databaseHealth.status, 503);
    assert.equal(databaseHealth.body.errorCode, 'DB_PG_HBA_REJECTED');
  } finally {
    await new Promise((resolve) => blockedDbServer.close(resolve));
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
