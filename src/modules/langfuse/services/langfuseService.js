/**
 * Langfuse API 服务
 * 通过 Vite 代理 /langfuse-api-{env} → 对应环境的 Langfuse 服务器
 */
import { getLangfuseEnvironmentMap } from '../../config/secureConfigStore.js';

export const LANGFUSE_ENVIRONMENTS_UPDATED_EVENT = 'voiceauto:langfuse-environments-updated';
export const ENVIRONMENTS = {};

function replaceEnvironmentMap(nextMap) {
  Object.keys(ENVIRONMENTS).forEach((key) => {
    delete ENVIRONMENTS[key];
  });
  Object.assign(ENVIRONMENTS, nextMap);
  return ENVIRONMENTS;
}

export function refreshLangfuseEnvironments({ notify = true } = {}) {
  const refreshed = replaceEnvironmentMap(getLangfuseEnvironmentMap());
  if (notify && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LANGFUSE_ENVIRONMENTS_UPDATED_EVENT, {
      detail: { environments: refreshed },
    }));
  }
  return refreshed;
}

refreshLangfuseEnvironments({ notify: false });

export function getLangfuseEnvironmentEntries() {
  return Object.entries(ENVIRONMENTS).filter(([, environment]) => environment?.enabled !== false);
}

export function getDefaultLangfuseEnvironmentKey() {
  return getLangfuseEnvironmentEntries()[0]?.[0] || 'UAT';
}

function resolveEnvironment(envKey, { includeSecrets = false } = {}) {
  const envMap = getLangfuseEnvironmentMap({ includeSecrets });
  const env = envMap[envKey];
  if (!env) {
    throw new Error(`Langfuse 环境不存在：${envKey}`);
  }
  return env;
}

function makeAuthHeader(envKey) {
  const env = resolveEnvironment(envKey, { includeSecrets: true });
  if (!env.publicKey || !env.secretKey) {
    throw new Error(`Langfuse 环境 ${envKey} 未完成 Public Key / Secret Key 配置`);
  }
  return 'Basic ' + btoa(`${env.publicKey}:${env.secretKey}`);
}

const RETRYABLE_NETWORK_PATTERNS = [
  'econnreset',
  'etimedout',
  'socket hang up',
  'networkerror',
  'failed to fetch',
];

function isRetryableNetworkError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return RETRYABLE_NETWORK_PATTERNS.some((token) => message.includes(token));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonResponse(response, envKey, endpoint) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.toLowerCase().includes('application/json')) {
    const looksLikeHtml = /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
    const hint = looksLikeHtml
      ? '服务端返回了 HTML 页面，通常是 Nginx 未配置对应 Langfuse 代理前缀。'
      : 'Langfuse 返回内容不是 JSON。';
    throw new Error(`${hint} 环境：${envKey}，接口：${endpoint}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Langfuse JSON 解析失败：${error.message}`);
  }
}

async function fetchWithRetry(url, options, controller, maxRetries = 3) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    if (controller?.aborted) {
      throw new Error('请求已终止');
    }

    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      const shouldRetry = isRetryableNetworkError(error) && attempt < maxRetries;
      if (!shouldRetry) break;

      const delayMs = Math.min(1000 * (attempt + 1), 3000);
      await wait(delayMs);
      attempt++;
    }
  }

  throw lastError;
}

/**
 * 获取控制器 —— 支持暂停 / 继续 / 终止
 */
export class FetchController {
  constructor() {
    this._paused = false;
    this._aborted = false;
    this._resumeResolve = null;
  }

  pause() {
    if (!this._aborted) this._paused = true;
  }

  resume() {
    this._paused = false;
    if (this._resumeResolve) {
      const r = this._resumeResolve;
      this._resumeResolve = null;
      r();
    }
  }

  /** 终止：同时解除暂停，让循环能走到 abort 检查 */
  abort() {
    this._aborted = true;
    this.resume();
  }

  get aborted() { return this._aborted; }
  get paused()  { return this._paused;  }

  /** 暂停时挂起；resume()/abort() 调用后自动解除 */
  waitIfPaused() {
    if (!this._paused) return Promise.resolve();
    return new Promise((resolve) => { this._resumeResolve = resolve; });
  }
}

/**
 * 分页拉取所有数据（支持控制器）
 * @param {string} envKey  - 环境 key: 'UAT' | 'UAT_LOCAL' | 'TEST' | 'PROD' | 'PROD_LOCAL'
 */
async function fetchAllPages(envKey, endpoint, params, onProgress, controller) {
  const env = resolveEnvironment(envKey, { includeSecrets: true });
  const authHeader = makeAuthHeader(envKey);
  const results = [];
  let page = 1;
  const limit = 100;

  while (true) {
    if (controller?.aborted) break;

    // 暂停时挂起，等待 resume() 或 abort()
    await controller?.waitIfPaused();

    if (controller?.aborted) break;

    const url = new URL(`${env.proxyBase}${endpoint}`, window.location.origin);
    const queryParams = { ...params, page, limit };
    Object.entries(queryParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    });

    const response = await fetchWithRetry(url.toString(), {
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    }, controller);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Langfuse API 错误 ${response.status}: ${text || response.statusText}`);
    }

    const data = await readJsonResponse(response, envKey, endpoint);
    const items = Array.isArray(data.data) ? data.data : [];
    results.push(...items);

    const meta = data.meta || {};
    const totalItems = meta.totalItems ?? items.length;
    // 传递 results 引用，让调用方可以在 abort 时读取到已积累的真实数据
    if (onProgress) onProgress(results, totalItems);

    const totalPages = meta.totalPages ?? 1;
    if (items.length < limit || page >= totalPages) break;
    page++;
  }

  return results;
}

export async function fetchTraces(envKey, fromTimestamp, toTimestamp, onProgress, controller) {
  return fetchAllPages(
    envKey,
    '/api/public/traces',
    { fromTimestamp, toTimestamp },
    onProgress,
    controller
  );
}

export async function fetchObservations(envKey, fromTimestamp, toTimestamp, onProgress, controller) {
  return fetchAllPages(
    envKey,
    '/api/public/observations',
    { fromStartTime: fromTimestamp, toStartTime: toTimestamp },
    onProgress,
    controller
  );
}
