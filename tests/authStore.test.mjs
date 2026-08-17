import assert from 'node:assert/strict';
import {
  authenticateUser,
  getCurrentUser,
  hasPermission,
  logoutUser,
} from '../src/modules/config/authStore.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

{
  const storage = createMemoryStorage();
  const result = await authenticateUser('admin', 'admin123', { storage, ipAddress: '127.0.0.1' });
  assert.equal(result.success, true);
  assert.equal(result.user.loginAccount, 'admin');
  assert.equal(hasPermission(result.user, 'config_manage'), true);
  assert.equal(hasPermission(result.user, 'test_execute'), true);
  assert.equal((await getCurrentUser({ storage })).loginAccount, 'admin');
}

{
  const storage = createMemoryStorage();
  const result = await authenticateUser('admin', 'bad-password', { storage });
  assert.equal(result.success, false);
  assert.equal(await getCurrentUser({ storage }), null);
}

{
  const storage = createMemoryStorage();
  const result = await authenticateUser('lead', 'lead123', { storage });
  assert.equal(result.success, true);
  assert.equal(hasPermission(result.user, 'config_manage'), false);
  assert.equal(hasPermission(result.user, 'test_execute'), true);
  await logoutUser({ storage });
  assert.equal(await getCurrentUser({ storage }), null);
}

{
  const storage = createMemoryStorage();
  const result = await authenticateUser('LilyLuv', 'Sdmc1234', { storage });
  assert.equal(result.success, true);
  assert.equal(result.user.loginAccount, 'LilyLuv');
  assert.equal(hasPermission(result.user, 'config_manage'), true);
}

{
  const calls = [];
  const apiUser = {
    id: 9,
    username: 'LilyLuv',
    loginAccount: 'LilyLuv',
    role: 'admin',
    status: 'enabled',
    permissions: ['config_manage'],
  };
  const result = await authenticateUser('LilyLuv', 'Sdmc1234', {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return { success: true, user: apiUser };
        },
      };
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.user.id, 9);
  assert.equal(calls[0].url, '/api/auth/login');
}

{
  const result = await authenticateUser('LilyLuv', 'Sdmc1234', {
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      async json() {
        return {
          success: false,
          errorCode: 'DB_PG_HBA_REJECTED',
          message: '数据库访问被拒绝：当前机器 IP 未加入 PostgreSQL 访问白名单',
          detail: 'no pg_hba.conf entry for host "10.10.122.130"',
        };
      },
    }),
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'DB_PG_HBA_REJECTED');
  assert.match(result.message, /数据库访问被拒绝/);
  assert.match(result.message, /10\.10\.122\.130/);
}

{
  const storage = createMemoryStorage();
  storage.setItem('voiceauto_auth_v1', JSON.stringify({
    users: [
      {
        id: 99,
        username: 'Local User',
        loginAccount: 'LocalOps',
        passwordHash: 'local:Local12345',
        role: 'test_lead',
        status: 'enabled',
      },
    ],
    session: null,
  }));
  const result = await authenticateUser('LocalOps', 'Local12345', {
    storage,
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      json: async () => ({ success: false, message: '账号不存在' }),
    }),
  });
  assert.equal(result.success, true);
  assert.equal(result.user.loginAccount, 'LocalOps');
  assert.equal((await getCurrentUser({
    storage,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ success: false, message: '未登录' }),
    }),
  })).loginAccount, 'LocalOps');
}
