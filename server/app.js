import { createReadStream, existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, resolve } from 'node:path';
import {
  authenticateUser,
  createUserAccount,
  createSession,
  findUserById,
  resolveSessionUserId,
} from './authRepository.js';
import {
  listAppConfigs,
  readAppConfig,
  saveAppConfig,
} from './configRepository.js';

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

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function getDoubaoV3Config(config = {}) {
  const payload = config.payload || config;
  return {
    apiKey: String(payload.apiKey || payload.xApiKey || '').trim(),
    apiKeyId: String(payload.apiKeyId || '').trim(),
    apiKeySecret: String(payload.apiKeySecret || '').trim(),
    accessKeyId: String(payload.accessKeyId || '').trim(),
    secretAccessKey: String(payload.secretAccessKey || '').trim(),
    resourceId: String(payload.resourceId || 'seed-tts-2.0').trim(),
    url: String(payload.v3Url || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional').trim(),
    uid: String(payload.uid || 'voiceauto-web').trim(),
    sampleRate: Number(payload.sampleRate || 24000),
  };
}

function buildDoubaoAuthHeaders(config) {
  if (config.apiKey) {
    return {
      'X-Api-Key': config.apiKey,
    };
  }
  if (config.apiKeyId && config.apiKeySecret) {
    return {
      'X-Api-App-Key': config.apiKeyId,
      'X-Api-Access-Key': config.apiKeySecret,
    };
  }
  if (config.accessKeyId && config.secretAccessKey) {
    return {
      'X-Api-App-Key': config.accessKeyId,
      'X-Api-Access-Key': config.secretAccessKey,
    };
  }
  return {};
}

function hasDoubaoAuth(config) {
  return Boolean(
    (config.apiKeyId && config.apiKeySecret)
    || config.apiKey
    || (config.accessKeyId && config.secretAccessKey)
  );
}

function parseDoubaoErrorMessage(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return parsed?.message
      || parsed?.header?.message
      || parsed?.error?.message
      || raw;
  } catch {
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
      zh_female_wanwanxiaohe_moon_bigtts: 'zh_female_vv_uranus_bigtts',
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

      if (req.method === 'POST' && url.pathname === '/api/users') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }
        if (!hasPermission(currentUser, 'user_manage')) {
          sendJson(res, 403, { success: false, message: '无账号管理权限' });
          return;
        }

        const body = await readJson(req);
        const result = await createUserAccount(pool, body);
        sendJson(res, result.success ? 201 : (result.status || 400), result);
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
        if (!hasPermission(currentUser, 'config_manage')) {
          sendJson(res, 403, { success: false, message: '无配置修改权限' });
          return;
        }
        const body = await readJson(req);
        const configType = decodeURIComponent(configMatch[1]);
        const saved = await saveAppConfig(pool, configType, body.config || {}, currentUser.loginAccount);
        sendJson(res, 200, { success: true, config: { ...saved, ...saved.payload } });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/tts/doubao-v3') {
        const currentUser = await resolveSessionUser(req, pool, sessionStore);
        if (!currentUser) {
          sendJson(res, 401, { success: false, message: '未登录' });
          return;
        }

        const body = await readJson(req);
        const text = String(body.text || '').trim();
        const voiceType = String(body.voiceType || '').trim();
        if (!text) {
          sendJson(res, 400, { success: false, message: 'TTS 文本为空' });
          return;
        }
        if (!voiceType) {
          sendJson(res, 400, { success: false, message: '豆包 V3 TTS 音色未配置' });
          return;
        }

        const savedConfig = await readAppConfig(pool, 'doubaoTts');
        const doubaoConfig = getDoubaoV3Config(savedConfig);
        if (!hasDoubaoAuth(doubaoConfig)) {
          sendJson(res, 400, { success: false, message: '豆包 V3 API Key 未配置' });
          return;
        }
        if (!doubaoConfig.resourceId) {
          sendJson(res, 400, { success: false, message: '豆包 V3 Resource ID 未配置' });
          return;
        }

        const requestId = randomUUID();
        const resolvedVoiceType = normalizeDoubaoVoiceType(doubaoConfig.resourceId, voiceType);
        const speedRatio = clampNumber(body.rate, 0.5, 2, 1);
        const volumeRatio = clampNumber(Number(body.volume || 100) / 100, 0.1, 2, 1);
        const response = await fetch(doubaoConfig.url, {
          method: 'POST',
          headers: {
            ...buildDoubaoAuthHeaders(doubaoConfig),
            'X-Api-Resource-Id': doubaoConfig.resourceId,
            'X-Api-Request-Id': requestId,
            'Content-Type': 'application/json',
            Connection: 'keep-alive',
          },
          body: JSON.stringify({
            user: {
              uid: doubaoConfig.uid,
            },
            req_params: {
              text,
              speaker: resolvedVoiceType,
              audio_params: {
                format: 'mp3',
                sample_rate: doubaoConfig.sampleRate,
              },
              speed_ratio: speedRatio,
              volume_ratio: volumeRatio,
              language: body.lang || undefined,
            },
          }),
        });

        const logId = response.headers.get('x-tt-logid') || response.headers.get('x-tt-log-id') || '';
        if (!response.ok) {
          const responseText = await response.text();
          sendJson(res, 502, {
            success: false,
            message: parseDoubaoErrorMessage(responseText) || '豆包 V3 TTS 请求失败',
            providerStatus: response.status || 0,
            logId,
          });
          return;
        }

        const contentType = response.headers.get('content-type') || '';
        if (/^audio\/|application\/octet-stream/i.test(contentType)) {
          const audioBuffer = Buffer.from(await response.arrayBuffer());
          if (!audioBuffer.length) {
            sendJson(res, 502, {
              success: false,
              message: '豆包 V3 TTS 返回空音频',
              logId,
            });
            return;
          }
          sendBuffer(res, 200, audioBuffer, contentType.split(';')[0] || 'audio/mpeg', logId ? { 'X-Tt-Logid': logId } : {});
          return;
        }

        const responseText = await response.text();
        const parsedResponse = parseDoubaoJsonLine(responseText);
        if (parsedResponse && Number(parsedResponse.code || 0) !== 0) {
          sendJson(res, 502, {
            success: false,
            message: parsedResponse.message || '豆包 V3 TTS 请求失败',
            providerCode: Number(parsedResponse.code || 0),
            logId,
          });
          return;
        }
        const audioBuffers = extractDoubaoAudioBuffers(responseText);
        if (!audioBuffers.length) {
          sendJson(res, 502, {
            success: false,
            message: '豆包 V3 TTS 未返回音频片段',
            logId,
          });
          return;
        }

        sendBuffer(res, 200, Buffer.concat(audioBuffers), 'audio/mpeg', logId ? { 'X-Tt-Logid': logId } : {});
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
      sendJson(res, 500, { success: false, message: error?.message || '服务异常' });
    }
  };
}
