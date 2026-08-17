import assert from 'node:assert/strict';
import {
  createUserAccount,
  deleteUserAccount,
  listUserAccounts,
  updateUserAccount,
} from '../src/modules/config/userApi.js';

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

const calls = [];
const fetchImpl = async (url, options = {}) => {
  calls.push({ url, options });
  if (url === '/api/users' && options.method === 'GET') {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        users: [
          { id: 1, username: 'Lily', loginAccount: 'LilyLuv', role: 'admin', status: 'enabled' },
        ],
      }),
    };
  }
  if (url === '/api/users' && options.method === 'POST') {
    return {
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        user: { id: 2, username: 'Mia', loginAccount: 'MiaOps', role: 'test_lead', status: 'enabled' },
      }),
    };
  }
  if (url === '/api/users/2' && options.method === 'PUT') {
    const body = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        user: { id: 2, ...body },
      }),
    };
  }
  if (url === '/api/users/2' && options.method === 'DELETE') {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        user: { id: 2, username: 'Mia', loginAccount: 'MiaOps', role: 'test_lead', status: 'deleted' },
      }),
    };
  }
  throw new Error(`unexpected fetch ${url}`);
};

const listed = await listUserAccounts({ fetchImpl });
assert.equal(listed.success, true);
assert.equal(listed.users[0].loginAccount, 'LilyLuv');

const created = await createUserAccount({
  username: 'Mia',
  loginAccount: 'MiaOps',
  password: 'Mia12345',
  role: 'test_lead',
  status: 'enabled',
}, { fetchImpl });
assert.equal(created.success, true);
assert.equal(created.user.loginAccount, 'MiaOps');

const updated = await updateUserAccount(2, {
  username: 'Mia Ops',
  loginAccount: 'MiaOps2',
  password: '',
  role: 'admin',
  status: 'enabled',
}, { fetchImpl });
assert.equal(updated.success, true);
assert.equal(updated.user.loginAccount, 'MiaOps2');

const deleted = await deleteUserAccount(2, { fetchImpl });
assert.equal(deleted.success, true);
assert.equal(deleted.user.status, 'deleted');

assert.equal(calls[0].url, '/api/users');
assert.equal(calls[0].options.method, 'GET');
assert.equal(calls[1].options.method, 'POST');
assert.equal(calls[2].options.method, 'PUT');
assert.equal(calls[3].options.method, 'DELETE');

{
  const storage = createMemoryStorage();
  const fallbackCreated = await createUserAccount({
    username: 'Local User',
    loginAccount: 'LocalOps',
    password: 'Local12345',
    role: 'test_lead',
    status: 'enabled',
  }, {
    storage,
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      json: async () => ({ success: false, message: '接口不存在' }),
    }),
  });
  assert.equal(fallbackCreated.success, true);
  assert.equal(fallbackCreated.localFallback, true);

  const fallbackListed = await listUserAccounts({
    storage,
    fetchImpl: async () => {
      throw new Error('backend unavailable');
    },
  });
  assert.equal(fallbackListed.success, true);
  assert.equal(fallbackListed.users.some((user) => user.loginAccount === 'LocalOps'), true);

  const localUser = fallbackListed.users.find((user) => user.loginAccount === 'LocalOps');
  const fallbackUpdated = await updateUserAccount(localUser.id, {
    username: 'Local Updated',
    loginAccount: 'LocalOps2',
    password: 'Local67890',
    role: 'admin',
    status: 'enabled',
  }, {
    storage,
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      json: async () => ({ success: false, message: '接口不存在' }),
    }),
  });
  assert.equal(fallbackUpdated.success, true);
  assert.equal(fallbackUpdated.user.loginAccount, 'LocalOps2');
  assert.equal(fallbackUpdated.user.role, 'admin');

  const fallbackDeleted = await deleteUserAccount(localUser.id, {
    storage,
    fetchImpl: async () => {
      throw new Error('backend unavailable');
    },
  });
  assert.equal(fallbackDeleted.success, true);

  const afterDelete = await listUserAccounts({
    storage,
    fetchImpl: async () => {
      throw new Error('backend unavailable');
    },
  });
  assert.equal(afterDelete.users.some((user) => user.loginAccount === 'LocalOps2'), false);
}
