const AUTH_STORAGE_KEY = 'voiceauto_auth_v1';
const LOGIN_LOG_STORAGE_KEY = 'voiceauto_login_logs_v1';

export const PERMISSIONS = {
  USER_MANAGE: 'user_manage',
  CONFIG_VIEW: 'config_view',
  CONFIG_MANAGE: 'config_manage',
  CONFIG_TEST: 'config_test',
  TEST_EXECUTE: 'test_execute',
  REPORT_GENERATE: 'report_generate',
  REPORT_VIEW: 'report_view',
  OPERATION_LOG_VIEW: 'operation_log_view',
};

export const ROLE_PERMISSIONS = {
  admin: [
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.CONFIG_VIEW,
    PERMISSIONS.CONFIG_MANAGE,
    PERMISSIONS.CONFIG_TEST,
    PERMISSIONS.TEST_EXECUTE,
    PERMISSIONS.REPORT_GENERATE,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.OPERATION_LOG_VIEW,
  ],
  test_lead: [
    PERMISSIONS.CONFIG_VIEW,
    PERMISSIONS.TEST_EXECUTE,
    PERMISSIONS.REPORT_GENERATE,
    PERMISSIONS.REPORT_VIEW,
  ],
};

const DEFAULT_USERS = [
  {
    id: 1,
    username: '管理员',
    loginAccount: 'admin',
    passwordHash: 'local:admin123',
    role: 'admin',
    status: 'enabled',
    createdAt: '2026-07-23T00:00:00.000Z',
  },
  {
    id: 2,
    username: '测试负责人',
    loginAccount: 'lead',
    passwordHash: 'local:lead123',
    role: 'test_lead',
    status: 'enabled',
    createdAt: '2026-07-23T00:00:00.000Z',
  },
  {
    id: 3,
    username: 'LilyLuv',
    loginAccount: 'LilyLuv',
    passwordHash: 'local:Sdmc1234',
    role: 'admin',
    status: 'enabled',
    createdAt: '2026-07-23T00:00:00.000Z',
  },
];

function getStorage(storage) {
  if (storage) return storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function normalize(value) {
  return String(value ?? '').trim();
}

function hashPassword(password) {
  return `local:${normalize(password)}`;
}

function getFetch(options = {}) {
  if (options.storage) return null;
  if (options.fetchImpl) return options.fetchImpl;
  if (typeof fetch === 'function') return fetch.bind(globalThis);
  return null;
}

async function requestJson(path, options = {}) {
  const fetchImpl = getFetch(options);
  if (!fetchImpl) return null;

  const response = await fetchImpl(path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function buildRemoteErrorResult(body = {}) {
  const detail = normalize(body.detail);
  const message = normalize(body.message || '登录失败');
  return {
    success: false,
    ...body,
    message: detail && !message.includes(detail) ? `${message}：${detail}` : message,
  };
}

function readAuthStore(storage) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) {
    return { users: DEFAULT_USERS, session: null };
  }
  try {
    const parsed = JSON.parse(targetStorage.getItem(AUTH_STORAGE_KEY) || '{}');
    const storedUsers = Array.isArray(parsed.users) && parsed.users.length ? parsed.users : [];
    const userByAccount = new Map(storedUsers.map((user) => [user.loginAccount, user]));
    DEFAULT_USERS.forEach((user) => {
      if (!userByAccount.has(user.loginAccount)) {
        userByAccount.set(user.loginAccount, user);
      }
    });
    return {
      users: Array.from(userByAccount.values()),
      session: parsed.session || null,
    };
  } catch {
    return { users: DEFAULT_USERS, session: null };
  }
}

function writeAuthStore(store, storage) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return;
  targetStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(store));
}

function appendLoginLog(log, storage) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return;
  let logs = [];
  try {
    logs = JSON.parse(targetStorage.getItem(LOGIN_LOG_STORAGE_KEY) || '[]');
  } catch {
    logs = [];
  }
  logs.push(log);
  targetStorage.setItem(LOGIN_LOG_STORAGE_KEY, JSON.stringify(logs.slice(-200)));
}

function publicUser(user) {
  if (!user) return null;
  const permissions = ROLE_PERMISSIONS[user.role] || [];
  const { passwordHash, ...safeUser } = user;
  return {
    ...safeUser,
    permissions,
  };
}

function authenticateLocalUser(loginAccount, password, options = {}) {
  const store = readAuthStore(options.storage);
  const account = normalize(loginAccount);
  const timestamp = nowIso();
  const user = store.users.find((item) => item.loginAccount === account);
  let failReason = '';

  if (!user) {
    failReason = '账号不存在';
  } else if (user.status !== 'enabled') {
    failReason = '账号已禁用';
  } else if (user.passwordHash !== hashPassword(password)) {
    failReason = '密码错误';
  }

  if (failReason) {
    appendLoginLog({
      id: `${timestamp}-${account || 'empty'}-failed`,
      loginAccount: account,
      loginTime: timestamp,
      loginIp: options.ipAddress || '',
      loginResult: '失败',
      failReason,
    }, options.storage);
    return { success: false, message: failReason };
  }

  const nextUser = { ...user, lastLoginAt: timestamp };
  store.users = store.users.map((item) => (item.id === user.id ? nextUser : item));
  store.session = {
    userId: user.id,
    loginAt: timestamp,
  };
  writeAuthStore(store, options.storage);
  appendLoginLog({
    id: `${timestamp}-${account}-success`,
    userId: user.id,
    loginAccount: account,
    loginTime: timestamp,
    loginIp: options.ipAddress || '',
    loginResult: '成功',
    failReason: '',
  }, options.storage);
  return { success: true, user: publicUser(nextUser) };
}

export async function authenticateUser(loginAccount, password, options = {}) {
  try {
    const response = await requestJson('/api/auth/login', {
      ...options,
      method: 'POST',
      body: { loginAccount, password },
    });
    if (response) {
      if (!response.ok && response.status === 404 && normalize(response.body?.message).includes('账号不存在')) {
        const localResult = authenticateLocalUser(loginAccount, password, options);
        if (localResult.success) return localResult;
      }
      return response.ok ? response.body : buildRemoteErrorResult(response.body);
    }
  } catch {
    // API 不可用时保留本地开发兜底。
  }

  return authenticateLocalUser(loginAccount, password, options);
}

function getCurrentLocalUser(options = {}) {
  const store = readAuthStore(options.storage);
  if (!store.session?.userId) return null;
  return publicUser(store.users.find((user) => user.id === store.session.userId));
}

export async function getCurrentUser(options = {}) {
  try {
    const response = await requestJson('/api/auth/profile', options);
    if (response) {
      return response.ok ? response.body.user : getCurrentLocalUser(options);
    }
  } catch {
    // API 不可用时保留本地开发兜底。
  }

  return getCurrentLocalUser(options);
}

function logoutLocalUser(options = {}) {
  const store = readAuthStore(options.storage);
  store.session = null;
  writeAuthStore(store, options.storage);
}

export async function logoutUser(options = {}) {
  try {
    await requestJson('/api/auth/logout', {
      ...options,
      method: 'POST',
    });
  } catch {
    // ignore API logout failures; clear local fallback state below.
  }
  logoutLocalUser(options);
}

export function hasPermission(user, permission) {
  return Boolean(user?.permissions?.includes(permission));
}

export function getLoginLogs(options = {}) {
  const targetStorage = getStorage(options.storage);
  if (!targetStorage) return [];
  try {
    return JSON.parse(targetStorage.getItem(LOGIN_LOG_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}
