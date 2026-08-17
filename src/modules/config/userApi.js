const AUTH_STORAGE_KEY = 'voiceauto_auth_v1';

const ROLE_PERMISSIONS = {
  admin: [
    'user_manage',
    'config_view',
    'config_manage',
    'config_test',
    'test_execute',
    'report_generate',
    'report_view',
    'operation_log_view',
  ],
  test_lead: [
    'config_view',
    'test_execute',
    'report_generate',
    'report_view',
  ],
};

function getStorage(options = {}) {
  if (options.storage) return options.storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function readAuthStore(options = {}) {
  const storage = getStorage(options);
  if (!storage) return { users: [], session: null };
  try {
    const parsed = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) || '{}');
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      session: parsed.session || null,
    };
  } catch {
    return { users: [], session: null };
  }
}

function writeAuthStore(store, options = {}) {
  const storage = getStorage(options);
  if (!storage) return;
  storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(store));
}

function toPublicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return {
    ...safeUser,
    permissions: ROLE_PERMISSIONS[user.role] || [],
  };
}

function createLocalUserAccount(input, options = {}) {
  const username = String(input.username ?? '').trim();
  const loginAccount = String(input.loginAccount ?? '').trim();
  const password = String(input.password ?? '');
  const role = String(input.role || 'test_lead').trim();
  const status = String(input.status || 'enabled').trim();

  if (!username || !loginAccount || !password) {
    return { success: false, message: '请填写用户名、登录账号和密码' };
  }
  if (!ROLE_PERMISSIONS[role]) {
    return { success: false, message: '角色不存在' };
  }

  const store = readAuthStore(options);
  if (store.users.some((user) => user.loginAccount === loginAccount)) {
    return { success: false, message: '登录账号已存在' };
  }

  const timestamp = new Date().toISOString();
  const user = {
    id: Date.now(),
    username,
    loginAccount,
    passwordHash: `local:${password}`,
    role,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.users = [user, ...store.users];
  writeAuthStore(store, options);
  return { success: true, user: toPublicUser(user), localFallback: true };
}

function listLocalUserAccounts(options = {}) {
  const store = readAuthStore(options);
  return {
    success: true,
    users: store.users.map(toPublicUser).filter(Boolean),
    localFallback: true,
  };
}

function updateLocalUserAccount(userId, input, options = {}) {
  const store = readAuthStore(options);
  const id = String(userId);
  const index = store.users.findIndex((user) => String(user.id) === id);
  if (index < 0) return { success: false, message: '账号不存在' };

  const username = String(input.username ?? '').trim();
  const loginAccount = String(input.loginAccount ?? '').trim();
  const password = String(input.password ?? '');
  const role = String(input.role || 'test_lead').trim();
  const status = String(input.status || 'enabled').trim();
  if (!username || !loginAccount) return { success: false, message: '请填写用户名和登录账号' };
  if (!ROLE_PERMISSIONS[role]) return { success: false, message: '角色不存在' };
  if (store.users.some((user) => String(user.id) !== id && user.loginAccount === loginAccount)) {
    return { success: false, message: '登录账号已存在' };
  }

  const user = {
    ...store.users[index],
    username,
    loginAccount,
    role,
    status,
    updatedAt: new Date().toISOString(),
    ...(password ? { passwordHash: `local:${password}` } : {}),
  };
  store.users[index] = user;
  writeAuthStore(store, options);
  return { success: true, user: toPublicUser(user), localFallback: true };
}

function deleteLocalUserAccount(userId, options = {}) {
  const store = readAuthStore(options);
  const id = String(userId);
  const existing = store.users.find((user) => String(user.id) === id);
  if (!existing) return { success: false, message: '账号不存在' };
  store.users = store.users.filter((user) => String(user.id) !== id);
  if (String(store.session?.userId) === id) store.session = null;
  writeAuthStore(store, options);
  return { success: true, user: toPublicUser({ ...existing, status: 'deleted' }), localFallback: true };
}

export async function listUserAccounts(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await fetchImpl('/api/users', {
      method: 'GET',
      credentials: 'same-origin',
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      return {
        success: true,
        users: Array.isArray(body.users) ? body.users : [],
      };
    }
  } catch {
    // Fall back to local persisted accounts when the backend user API is not available.
  }

  return listLocalUserAccounts(options);
}

export async function createUserAccount(input, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await fetchImpl('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify(input),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;
    if (response.status !== 404 && !/接口不存在|not found/i.test(String(body?.message || ''))) {
      return {
        success: false,
        message: body?.message || '新增账号失败',
      };
    }
  } catch {
    // Fall back to local persisted accounts when the backend user API is not available.
  }

  return createLocalUserAccount(input, options);
}

export async function updateUserAccount(userId, input, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await fetchImpl(`/api/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify(input),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;
    if (response.status !== 404 && !/接口不存在|not found/i.test(String(body?.message || ''))) {
      return {
        success: false,
        message: body?.message || '修改账号失败',
      };
    }
  } catch {
    // Fall back to local persisted accounts when the backend user API is not available.
  }

  return updateLocalUserAccount(userId, input, options);
}

export async function deleteUserAccount(userId, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await fetchImpl(`/api/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) return body;
    if (response.status !== 404 && !/接口不存在|not found/i.test(String(body?.message || ''))) {
      return {
        success: false,
        message: body?.message || '删除账号失败',
      };
    }
  } catch {
    // Fall back to local persisted accounts when the backend user API is not available.
  }

  return deleteLocalUserAccount(userId, options);
}
