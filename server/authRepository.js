import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ROLE_PERMISSIONS = {
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

const DEFAULT_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const DEFAULT_SESSION_SECRET = 'voiceauto-dev-session-secret';

function hashPassword(password, salt, algorithm) {
  if (algorithm !== 'sha256_salt_v1') {
    return '';
  }
  return createHash('sha256').update(`${salt}${password}`).digest('hex');
}

function createPasswordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return {
    salt,
    hash: hashPassword(password, salt, 'sha256_salt_v1'),
    algorithm: 'sha256_salt_v1',
  };
}

function getSessionSecret(options = {}) {
  return String(options.secret || process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET);
}

function signSessionPayload(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function signaturesMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function encodeSignedSession(userId, expiresAt, options = {}) {
  const payload = Buffer.from(JSON.stringify({
    userId,
    expiresAt,
    nonce: randomBytes(8).toString('hex'),
  })).toString('base64url');
  const signature = signSessionPayload(payload, getSessionSecret(options));
  return `${payload}.${signature}`;
}

function decodeSignedSession(token, options = {}) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expectedSignature = signSessionPayload(payload, getSessionSecret(options));
  if (!signaturesMatch(signature, expectedSignature)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.userId || Number(session.expiresAt) <= Date.now()) return null;
    return {
      userId: session.userId,
      expiresAt: Number(session.expiresAt),
    };
  } catch {
    return null;
  }
}

function toPublicUser(row) {
  if (!row) return null;
  const role = row.role || 'test_lead';
  return {
    id: row.id,
    username: row.username,
    loginAccount: row.login_account,
    role,
    status: row.status,
    lastLoginTime: row.last_login_time,
    permissions: ROLE_PERMISSIONS[role] || [],
  };
}

export async function listUserAccounts(pool) {
  const result = await pool.query(
    `SELECT id, username, login_account, role, status, last_login_time, created_at, updated_at
       FROM user_account
      WHERE COALESCE(status, '') <> 'deleted'
      ORDER BY created_at DESC, id DESC`
  );
  return result.rows.map(toPublicUser);
}

export async function authenticateUser(pool, loginAccount, password, metadata = {}) {
  const account = String(loginAccount ?? '').trim();
  const passwordText = String(password ?? '');
  if (!account || !passwordText) {
    return { success: false, status: 400, message: '请填写账号和密码' };
  }

  const result = await pool.query(
    `SELECT id, username, login_account, password_hash, password_salt, password_algorithm,
            role, status, last_login_time, created_at, updated_at
       FROM user_account
      WHERE login_account = $1
      LIMIT 1`,
    [account]
  );
  const row = result.rows[0];

  let message = '';
  let userId = null;
  if (!row) {
    message = '账号不存在';
  } else if (row.status !== 'enabled') {
    message = '账号已禁用';
    userId = row.id;
  } else if (hashPassword(passwordText, row.password_salt, row.password_algorithm) !== row.password_hash) {
    message = '密码错误';
    userId = row.id;
  }

  if (message) {
    await writeLoginLog(pool, {
      userId,
      loginAccount: account,
      loginIp: metadata.ipAddress || '',
      loginResult: '失败',
      failReason: message,
    });
    return { success: false, status: message === '账号不存在' ? 404 : 401, message };
  }

  await pool.query(
    'UPDATE user_account SET last_login_time = NOW(), updated_at = NOW() WHERE id = $1',
    [row.id]
  ).catch(() => {});
  await writeLoginLog(pool, {
    userId: row.id,
    loginAccount: account,
    loginIp: metadata.ipAddress || '',
    loginResult: '成功',
    failReason: '',
  });

  return { success: true, user: toPublicUser(row) };
}

export async function findUserById(pool, userId) {
  const result = await pool.query(
    `SELECT id, username, login_account, role, status, last_login_time, created_at, updated_at
       FROM user_account
      WHERE id = $1
      LIMIT 1`,
    [userId]
  );
  return toPublicUser(result.rows[0]);
}

export async function createUserAccount(pool, input) {
  const username = String(input.username ?? '').trim();
  const loginAccount = String(input.loginAccount ?? '').trim();
  const password = String(input.password ?? '');
  const role = String(input.role || 'test_lead').trim();
  const status = String(input.status || 'enabled').trim();

  if (!username || !loginAccount || !password) {
    return { success: false, status: 400, message: '请填写用户名、登录账号和密码' };
  }
  if (!ROLE_PERMISSIONS[role]) {
    return { success: false, status: 400, message: '角色不存在' };
  }
  if (!['enabled', 'disabled'].includes(status)) {
    return { success: false, status: 400, message: '账号状态不合法' };
  }

  const passwordRecord = createPasswordRecord(password);
  try {
    const result = await pool.query(
      `INSERT INTO user_account (
         username, login_account, password_hash, password_salt, password_algorithm,
         role, status, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, username, login_account, role, status, last_login_time, created_at, updated_at`,
      [username, loginAccount, passwordRecord.hash, passwordRecord.salt, passwordRecord.algorithm, role, status]
    );
    return { success: true, user: toPublicUser(result.rows[0]) };
  } catch (error) {
    if (error?.code === '23505') {
      return { success: false, status: 409, message: '登录账号已存在' };
    }
    throw error;
  }
}

export async function updateUserAccount(pool, userId, input) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, status: 400, message: '账号 ID 不合法' };
  }

  const username = String(input.username ?? '').trim();
  const loginAccount = String(input.loginAccount ?? '').trim();
  const password = String(input.password ?? '');
  const role = String(input.role || 'test_lead').trim();
  const status = String(input.status || 'enabled').trim();

  if (!username || !loginAccount) {
    return { success: false, status: 400, message: '请填写用户名和登录账号' };
  }
  if (!ROLE_PERMISSIONS[role]) {
    return { success: false, status: 400, message: '角色不存在' };
  }
  if (!['enabled', 'disabled'].includes(status)) {
    return { success: false, status: 400, message: '账号状态不合法' };
  }

  const passwordRecord = password ? createPasswordRecord(password) : null;
  try {
    const result = await pool.query(
      `UPDATE user_account
          SET username = $2,
              login_account = $3,
              role = $4,
              status = $5,
              password_hash = CASE WHEN $6::TEXT IS NULL THEN password_hash ELSE $6 END,
              password_salt = CASE WHEN $7::TEXT IS NULL THEN password_salt ELSE $7 END,
              password_algorithm = CASE WHEN $8::TEXT IS NULL THEN password_algorithm ELSE $8 END,
              updated_at = NOW()
        WHERE id = $1
          AND COALESCE(status, '') <> 'deleted'
        RETURNING id, username, login_account, role, status, last_login_time, created_at, updated_at`,
      [
        id,
        username,
        loginAccount,
        role,
        status,
        passwordRecord?.hash || null,
        passwordRecord?.salt || null,
        passwordRecord?.algorithm || null,
      ]
    );
    if (!result.rows[0]) {
      return { success: false, status: 404, message: '账号不存在' };
    }
    return { success: true, user: toPublicUser(result.rows[0]) };
  } catch (error) {
    if (error?.code === '23505') {
      return { success: false, status: 409, message: '登录账号已存在' };
    }
    throw error;
  }
}

export async function deleteUserAccount(pool, userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    return { success: false, status: 400, message: '账号 ID 不合法' };
  }

  const result = await pool.query(
    `UPDATE user_account
        SET status = 'deleted',
            updated_at = NOW()
      WHERE id = $1
        AND COALESCE(status, '') <> 'deleted'
      RETURNING id, username, login_account, role, status, last_login_time, created_at, updated_at`,
    [id]
  );
  if (!result.rows[0]) {
    return { success: false, status: 404, message: '账号不存在' };
  }
  return { success: true, user: toPublicUser(result.rows[0]) };
}

export function createSession(sessionStore, user, options = {}) {
  const maxAgeMs = Number(options.maxAgeMs || DEFAULT_SESSION_MAX_AGE_MS);
  const expiresAt = Date.now() + maxAgeMs;
  const sessionId = encodeSignedSession(user.id, expiresAt, options);
  sessionStore.set(sessionId, {
    userId: user.id,
    createdAt: Date.now(),
    expiresAt,
  });
  return sessionId;
}

export function resolveSessionUserId(sessionStore, sessionId, options = {}) {
  const storedSession = sessionStore.get(sessionId);
  if (storedSession) {
    if (storedSession.expiresAt && storedSession.expiresAt <= Date.now()) {
      sessionStore.delete(sessionId);
      return null;
    }
    return storedSession.userId;
  }

  const signedSession = decodeSignedSession(sessionId, options);
  return signedSession?.userId || null;
}

async function writeLoginLog(pool, log) {
  await pool.query(
    `INSERT INTO user_login_log (user_id, login_account, login_ip, login_result, fail_reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [log.userId, log.loginAccount, log.loginIp, log.loginResult, log.failReason]
  ).catch(() => {});
}
