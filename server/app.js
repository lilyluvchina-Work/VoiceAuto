import { createReadStream, existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, resolve } from 'node:path';
import {
  authenticateUser,
  createUserAccount,
  createSession,
  deleteUserAccount,
  findUserById,
  listUserAccounts,
  resolveSessionUserId,
  updateUserAccount,
} from './authRepository.js';
import {
  listAppConfigs,
  readAppConfig,
  saveAppConfig,
} from './configRepository.js';
import { synthesizeDoubaoV3 } from './doubaoTtsService.js';
import {
  createGenerationRecord,
  createTestAudio,
  getTestAudio,
  listTestAudios,
  markTestAudioFailed,
  markTestAudioGenerating,
  softDeleteTestAudio,
  updateTestAudioSuccess,
} from './testAudioRepository.js';
import {
  deleteTestAudioFile,
  getReadableTestAudioFile,
  saveTestAudioFile,
} from './testAudioStorage.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function sendBuffer(res, status, buffer, contentType, headers = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    ...headers,
  });
  res.end(buffer);
}

function classifyServiceError(error) {
  const message = String(error?.message || error || '');
  if (/no pg_hba\.conf entry/i.test(message)) {
    return {
      status: 503,
      errorCode: 'DB_PG_HBA_REJECTED',
      message: '数据库访问被拒绝：当前机器 IP 未加入 PostgreSQL 访问白名单',
      detail: message,
      solution: [
        '在 PostgreSQL 服务器 pg_hba.conf 放行当前客户端 IP',
        '确认认证方式与用户密码类型一致，例如 md5 或 scram-sha-256',
        'reload PostgreSQL 配置后重试登录',
      ],
    };
  }
  if (/server does not support SSL connections/i.test(message)) {
    return {
      status: 503,
      errorCode: 'DB_SSL_UNSUPPORTED',
      message: '数据库不支持 SSL 连接，请移除 DATABASE_URL 中的 sslmode 参数或调整数据库 SSL 配置',
      detail: message,
    };
  }
  if (/password authentication failed/i.test(message)) {
    return {
      status: 503,
      errorCode: 'DB_AUTH_FAILED',
      message: '数据库账号或密码错误，请检查 DATABASE_URL',
      detail: message,
    };
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout|connect/i.test(message)) {
    return {
      status: 503,
      errorCode: 'DB_CONNECTION_FAILED',
      message: '数据库连接失败，请检查 DATABASE_URL、网络和数据库服务状态',
      detail: message,
    };
  }
  return {
    status: 500,
    errorCode: 'SERVICE_ERROR',
    message: message || '服务异常',
  };
}

const DATABASE_HEALTH_TIMEOUT_MS = Number(process.env.DB_HEALTH_TIMEOUT_MS || 1000);

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkDatabase(pool) {
  await withTimeout(
    pool.query('SELECT 1'),
    DATABASE_HEALTH_TIMEOUT_MS,
    `database health check timeout after ${DATABASE_HEALTH_TIMEOUT_MS}ms`
  );
  return { success: true, message: '数据库连接正常' };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function parseCookies(header = '') {
  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index === -1) return acc;
      acc[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
      return acc;
    }, {});
}

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

async function resolveSessionUser(req, pool, sessionStore) {
  const sessionId = parseCookies(req.headers.cookie).voiceauto_session;
  if (!sessionId) return null;
  const userId = resolveSessionUserId(sessionStore, sessionId);
  if (!userId) return null;
  return findUserById(pool, userId);
}

function hasPermission(user, permission) {
  return Boolean(user?.permissions?.includes(permission));
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function getRequestNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeTestAudioInput(input = {}, previous = null) {
  const textContent = String(
    input.textContent ?? input.text ?? previous?.textContent ?? ''
  ).trim();
  const voiceCode = String(
    input.voiceCode ?? input.voiceType ?? previous?.voiceCode ?? ''
  ).trim();
  const language = String(
    input.language ?? input.lang ?? previous?.language ?? 'zh-CN'
  ).trim();
  const audioFormat = String(
    input.audioFormat ?? previous?.audioFormat ?? 'mp3'
  ).trim().toLowerCase();
  const name = String(
    input.name ?? previous?.name ?? textContent.slice(0, 40) ?? ''
  ).trim();
  const speed = getRequestNumber(input.speed ?? input.rate, previous?.speed ?? 1);
  const pitch = getRequestNumber(input.pitch, previous?.pitch ?? 1);
  const volume = getRequestNumber(input.volume, previous?.volume ?? 1);
  const sampleRate = getRequestNumber(input.sampleRate, previous?.sampleRate ?? null);
  const generationParams = {
    ...(previous?.generationParams || {}),
    ...(input.generationParams || {}),
    name,
    textContent,
    voiceCode,
    language,
    speed,
    pitch,
    volume,
    audioFormat,
    sampleRate,
  };

  return {
    name,
    textContent,
    voiceCode,
    language,
    speed,
    pitch,
    volume,
    audioFormat,
    sampleRate,
    generationParams,
  };
}

function sendStream(res, status, stream, contentType, headers = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    ...headers,
  });
  stream.pipe(res);
}

function sendError(res, error, fallbackStatus = 500) {
  sendJson(res, error?.status || fallbackStatus, {
    success: false,
    message: error?.message || '服务异常',
    ...(error?.providerStatus ? { providerStatus: error.providerStatus } : {}),
    ...(error?.providerCode ? { providerCode: error.providerCode } : {}),
    ...(error?.logId ? { logId: error.logId } : {}),
  });
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function getDoubaoV3Config(config = {}) {
  const payload = config.payload || config;
  return {
    apiKeyId: String(payload.apiKeyId || '').trim(),
    apiKeySecret: String(payload.apiKeySecret || '').trim(),
    secretKey: String(payload.secretKey || '').trim(),
    resourceId: String(payload.resourceId || 'seed-tts-2.0').trim(),
    url: String(payload.v3Url || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional').trim(),
    uid: String(payload.uid || 'voiceauto-web').trim(),
    sampleRate: Number(payload.sampleRate || 24000),
  };
}

function buildDoubaoAuthHeaders(config) {
  if (config.apiKeyId && config.apiKeySecret) {
    return {
      'X-Api-App-Id': config.apiKeyId,
      'X-Api-Access-Key': config.apiKeySecret,
    };
  }
  return {};
}

function hasDoubaoAuth(config) {
  return Boolean(
    (config.apiKeyId && config.apiKeySecret)
  );
}

function isDoubaoAppId(value) {
  return /^\d{6,}$/.test(String(value || '').trim());
}

function parseDoubaoErrorMessage(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const message = parsed?.message
      || parsed?.header?.message
      || parsed?.error?.message
      || raw;
    if (/load grant: requested grant not found in SaaS storage/i.test(message)) {
      return '豆包 V3 授权未匹配：请确认 APP ID、Access Token、Resource ID 来自同一个豆包语音应用，并且该应用已开通对应资源';
    }
    return message;
  } catch {
    if (/load grant: requested grant not found in SaaS storage/i.test(raw)) {
      return '豆包 V3 授权未匹配：请确认 APP ID、Access Token、Resource ID 来自同一个豆包语音应用，并且该应用已开通对应资源';
    }
    return raw;
  }
}

function parseDoubaoJsonLine(text) {
  const source = String(text || '').trim();
  const candidates = source.includes('\n')
    ? source.split(/\r?\n/).map((line) => line.replace(/^data:\s*/, '').trim()).filter(Boolean)
    : [source];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep looking for the first JSON payload line.
    }
  }
  return null;
}

function normalizeDoubaoVoiceType(resourceId, voiceType) {
  const text = String(voiceType || '').trim();
  if (String(resourceId || '').trim() === 'seed-tts-2.0') {
    const seedTts2Fallbacks = {
      zh_female_shuangkuaisisi_moon_bigtts: 'zh_female_vv_uranus_bigtts',
      zh_female_roumei_moon_bigtts: 'zh_female_vv_uranus_bigtts',
      zh_male_qingshuangjingshen_moon_bigtts: 'zh_female_vv_uranus_bigtts',
    };
    return seedTts2Fallbacks[text] || text;
  }
  return text;
}

function collectBase64AudioValues(value, output = []) {
  if (!value) return output;
  if (typeof value === 'string') {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectBase64AudioValues(item, output));
    return output;
  }
  if (typeof value === 'object') {
    ['data', 'audio', 'audio_data', 'audioData'].forEach((key) => {
      if (typeof value[key] === 'string') output.push(value[key]);
    });
    if (value.result) collectBase64AudioValues(value.result, output);
    if (value.payload) collectBase64AudioValues(value.payload, output);
  }
  return output;
}

function extractDoubaoAudioBuffers(text) {
  const chunks = [];
  const source = String(text || '').trim();
  const candidates = source.includes('\n')
    ? source.split(/\r?\n/).map((line) => line.replace(/^data:\s*/, '').trim()).filter(Boolean)
    : [source];

  candidates.forEach((candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      collectBase64AudioValues(parsed).forEach((base64) => {
        const normalized = String(base64 || '').includes(',')
          ? String(base64).split(',').pop()
          : String(base64 || '');
        if (normalized.trim()) chunks.push(Buffer.from(normalized, 'base64'));
      });
    } catch {
      // Ignore non-JSON stream control lines.
    }
  });

  return chunks.filter((chunk) => chunk.length > 0);
}

function routeStatic(req, res, staticDir) {
  if (!staticDir) {
    sendJson(res, 404, { success: false, message: 'Not found' });
    return;
  }

  const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = resolve(staticDir, safePath === '/' ? 'index.html' : safePath.slice(1));
  const root = resolve(staticDir);
  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { success: false, message: 'Forbidden' });
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, 'index.html');
  }
  if (!existsSync(filePath)) {
    sendJson(res, 404, { success: false, message: 'Not found' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
  });
  createReadStream(filePath).pipe(res);
}

export function createApp(options) {
  const pool = options.pool;
  const sessionStore = options.sessionStore || new Map();
  const staticDir = options.staticDir || join(process.cwd(), 'dist');

  return async function app(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/health/database') {
        try {
          const result = await checkDatabase(pool);
          sendJson(res, 200, result);
        } catch (error) {
          const serviceError = classifyServiceError(error);
          sendJson(res, serviceError.status, { success: false, ...serviceError });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const body = await readJson(req);
        const result = await authenticateUser(pool, body.loginAccount ?? body.username, body.password, {
          ipAddress: getClientIp(req),
        });
        if (!result.success) {
          sendJson(res, result.status || 401, result);
          return;
        }
        const sessionId = createSession(sessionStore, result.user);
        sendJson(res, 200, result, {
          'Set-Cookie': `voiceauto_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/profile') {
        const user = await resolveSessionUser(req, pool, sessionStore);
        if (!user) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        sendJson(res, 200, { success: true, user });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        const sessionId = parseCookies(req.headers.cookie).voiceauto_session;
        if (sessionId) sessionStore.delete(sessionId);
        sendJson(res, 200, { success: true }, {
          'Set-Cookie': 'voiceauto_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/users') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!isAdmin(currentUser)) {
          sendJson(res, 403, { success: false, message: '无账号管理权限' });
          return;
        }

        const users = await listUserAccounts(pool);
        sendJson(res, 200, { success: true, users });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/users') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!isAdmin(currentUser)) {
          sendJson(res, 403, { success: false, message: '无账号管理权限' });
          return;
        }

        const body = await readJson(req);
        const result = await createUserAccount(pool, body);
        sendJson(res, result.success ? 201 : (result.status || 400), result);
        return;
      }

      const userMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
      if (userMatch && req.method === 'PUT') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!isAdmin(currentUser)) {
          sendJson(res, 403, { success: false, message: '无账号管理权限' });
          return;
        }

        const body = await readJson(req);
        const result = await updateUserAccount(pool, userMatch[1], body);
        sendJson(res, result.success ? 200 : (result.status || 400), result);
        return;
      }

      if (userMatch && req.method === 'DELETE') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!isAdmin(currentUser)) {
          sendJson(res, 403, { success: false, message: '无账号管理权限' });
          return;
        }
        if (String(currentUser.id) === String(userMatch[1])) {
          sendJson(res, 400, { success: false, message: '不能删除当前登录账号' });
          return;
        }

        const result = await deleteUserAccount(pool, userMatch[1]);
        sendJson(res, result.success ? 200 : (result.status || 400), result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/configs') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!hasPermission(currentUser, 'config_view')) {
          sendJson(res, 403, { success: false, message: '无配置查看权限' });
          return;
        }
        const configs = await listAppConfigs(pool);
        sendJson(res, 200, { success: true, configs });
        return;
      }

      const configMatch = url.pathname.match(/^\/api\/configs\/([^/]+)$/);
      if (configMatch && req.method === 'GET') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!hasPermission(currentUser, 'config_view')) {
          sendJson(res, 403, { success: false, message: '无配置查看权限' });
          return;
        }
        const configType = decodeURIComponent(configMatch[1]);
        const config = await readAppConfig(pool, configType);
        sendJson(res, 200, {
          success: true,
          config: config ? { ...config, ...config.payload } : { type: configType, configured: false },
        });
        return;
      }

      if (configMatch && req.method === 'PUT') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!isAdmin(currentUser)) {
          sendJson(res, 403, { success: false, message: '无配置修改权限' });
          return;
        }
        const body = await readJson(req);
        const configType = decodeURIComponent(configMatch[1]);
        const saved = await saveAppConfig(pool, configType, body.config || {}, currentUser.loginAccount);
        sendJson(res, 200, { success: true, config: { ...saved, ...saved.payload } });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/test-audios') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        const audios = await listTestAudios(pool);
        sendJson(res, 200, { success: true, audios });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/test-audios') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!hasPermission(currentUser, 'test_execute')) {
          sendJson(res, 403, { success: false, message: '无测试音频生成权限' });
          return;
        }

        const body = await readJson(req);
        const input = normalizeTestAudioInput(body);
        if (!input.name || !input.textContent) {
          sendJson(res, 400, { success: false, message: '请填写音频名称和合成文本' });
          return;
        }
        if (!input.voiceCode) {
          sendJson(res, 400, { success: false, message: '请选择音色' });
          return;
        }

        const created = await createTestAudio(pool, input, currentUser.id);
        try {
          const generated = await synthesizeDoubaoV3(pool, {
            text: input.textContent,
            voiceType: input.voiceCode,
            lang: input.language,
            rate: input.speed,
            volume: input.volume,
            audioFormat: input.audioFormat,
            sampleRate: input.sampleRate,
          });
          const savedFile = await saveTestAudioFile(created.id, generated.buffer, {
            audioFormat: input.audioFormat,
            contentType: generated.contentType,
          });
          const audio = await updateTestAudioSuccess(pool, created.id, {
            ...input,
            ...savedFile,
            sampleRate: input.sampleRate || generated.sampleRate,
            durationMs: null,
          });
          await createGenerationRecord(pool, {
            testAudioId: created.id,
            newFilePath: savedFile.filePath,
            params: input.generationParams,
            status: 'success',
          });
          sendJson(res, 201, { success: true, audio });
        } catch (error) {
          await markTestAudioFailed(pool, created.id, error?.message || '测试音频生成失败').catch(() => {});
          await createGenerationRecord(pool, {
            testAudioId: created.id,
            params: input.generationParams,
            status: 'failed',
            errorMessage: error?.message || '测试音频生成失败',
          }).catch(() => {});
          sendError(res, error, 500);
        }
        return;
      }

      const testAudioMatch = url.pathname.match(/^\/api\/test-audios\/([^/]+)$/);
      if (testAudioMatch && req.method === 'GET') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        const audio = await getTestAudio(pool, decodeURIComponent(testAudioMatch[1]));
        if (!audio) {
          sendJson(res, 404, { success: false, message: '测试音频不存在' });
          return;
        }
        sendJson(res, 200, { success: true, audio });
        return;
      }

      if (testAudioMatch && req.method === 'DELETE') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!hasPermission(currentUser, 'test_execute')) {
          sendJson(res, 403, { success: false, message: '无测试音频删除权限' });
          return;
        }
        const existing = await getTestAudio(pool, decodeURIComponent(testAudioMatch[1]));
        if (!existing) {
          sendJson(res, 404, { success: false, message: '测试音频不存在' });
          return;
        }
        const deleted = await softDeleteTestAudio(pool, existing.id);
        await deleteTestAudioFile(existing.filePath).catch(() => {});
        sendJson(res, 200, { success: true, audio: deleted });
        return;
      }

      const testAudioPlayMatch = url.pathname.match(/^\/api\/test-audios\/([^/]+)\/play$/);
      if (testAudioPlayMatch && req.method === 'GET') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        const audio = await getTestAudio(pool, decodeURIComponent(testAudioPlayMatch[1]));
        if (!audio || audio.status !== 'success' || !audio.filePath) {
          sendJson(res, 404, { success: false, message: '测试音频文件不存在' });
          return;
        }
        try {
          const file = await getReadableTestAudioFile(audio.filePath);
          sendStream(res, 200, file.stream, file.contentType, {
            'Content-Length': file.size,
            'Cache-Control': 'private, max-age=3600',
          });
        } catch (error) {
          sendError(res, error, 404);
        }
        return;
      }

      const testAudioRegenerateMatch = url.pathname.match(/^\/api\/test-audios\/([^/]+)\/regenerate$/);
      if (testAudioRegenerateMatch && req.method === 'POST') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!hasPermission(currentUser, 'test_execute')) {
          sendJson(res, 403, { success: false, message: '无测试音频生成权限' });
          return;
        }

        const existing = await getTestAudio(pool, decodeURIComponent(testAudioRegenerateMatch[1]));
        if (!existing) {
          sendJson(res, 404, { success: false, message: '测试音频不存在' });
          return;
        }
        if (existing.status === 'generating') {
          sendJson(res, 409, { success: false, message: '测试音频正在生成中，请稍后再试' });
          return;
        }

        const body = await readJson(req);
        const input = normalizeTestAudioInput(body.mode === 'use_original_params' ? {} : body, existing);
        const locked = await markTestAudioGenerating(pool, existing.id);
        if (!locked) {
          sendJson(res, 409, { success: false, message: '测试音频正在生成中，请稍后再试' });
          return;
        }

        try {
          const generated = await synthesizeDoubaoV3(pool, {
            text: input.textContent,
            voiceType: input.voiceCode,
            lang: input.language,
            rate: input.speed,
            volume: input.volume,
            audioFormat: input.audioFormat,
            sampleRate: input.sampleRate,
          });
          const savedFile = await saveTestAudioFile(existing.id, generated.buffer, {
            audioFormat: input.audioFormat,
            contentType: generated.contentType,
          });
          const audio = await updateTestAudioSuccess(pool, existing.id, {
            ...input,
            ...savedFile,
            sampleRate: input.sampleRate || generated.sampleRate,
            durationMs: null,
          });
          await createGenerationRecord(pool, {
            testAudioId: existing.id,
            oldFilePath: existing.filePath,
            newFilePath: savedFile.filePath,
            params: input.generationParams,
            status: 'success',
          });
          if (existing.filePath && existing.filePath !== savedFile.filePath) {
            await deleteTestAudioFile(existing.filePath).catch(() => {});
          }
          sendJson(res, 200, { success: true, audio });
        } catch (error) {
          await markTestAudioFailed(pool, existing.id, error?.message || '测试音频重新生成失败', {
            keepSuccess: existing.status === 'success',
          }).catch(() => {});
          await createGenerationRecord(pool, {
            testAudioId: existing.id,
            oldFilePath: existing.filePath,
            params: input.generationParams,
            status: 'failed',
            errorMessage: error?.message || '测试音频重新生成失败',
          }).catch(() => {});
          sendError(res, error, 500);
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/tts/doubao-v3') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }

        const body = await readJson(req);
        try {
          const generated = await synthesizeDoubaoV3(pool, {
            text: body.text,
            voiceType: body.voiceType,
            lang: body.lang,
            rate: body.rate,
            volume: body.volume,
            audioFormat: 'mp3',
          });
          sendBuffer(
            res,
            200,
            generated.buffer,
            generated.contentType || 'audio/mpeg',
            generated.logId ? { 'X-Tt-Logid': generated.logId } : {}
          );
        } catch (error) {
          sendError(res, error, 500);
        }
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { success: false, message: '接口不存在' });
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        routeStatic(req, res, staticDir);
        return;
      }

      sendJson(res, 405, { success: false, message: 'Method not allowed' });
    } catch (error) {
      const serviceError = classifyServiceError(error);
      sendJson(res, serviceError.status, { success: false, ...serviceError });
    }
  };
}
