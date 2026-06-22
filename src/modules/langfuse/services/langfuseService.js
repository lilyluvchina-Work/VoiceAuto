/**
 * Langfuse API 服务
 * 通过 Vite 代理 /langfuse-api-{env} → 对应环境的 Langfuse 服务器
 */

export const ENVIRONMENTS = {
  UAT: {
    label: 'UAT',
    proxyBase: '/langfuse-api-uat',
    publicKey: 'pk-lf-824d3dc4-e23b-4981-8359-9395acc8aad0',
    secretKey: 'sk-lf-beb47fb2-1c8d-446e-8f33-edfe22ad3a06',
  },
  UAT_LOCAL: {
    label: 'UAT-Local',
    proxyBase: '/langfuse-api-uat-local',
    publicKey: 'pk-lf-91d665c6-bb8c-4645-99e0-76f3edd1b3a3',
    secretKey: 'sk-lf-87f5dfc2-9fd6-4721-9720-d1819b2d158c',
  },
  TEST: {
    label: 'TEST',
    proxyBase: '/langfuse-api-test',
    publicKey: 'pk-lf-420f17d1-b097-46c6-bb69-6f1625e66d3f',
    secretKey: 'sk-lf-5d37c9b6-60f3-4058-9ffd-47090d1ae706',
  },
  PROD: {
    label: 'PROD',
    proxyBase: '/langfuse-api-prod',
    publicKey: 'pk-lf-c9b5bc74-2b57-4a79-95d8-353b47c96857',
    secretKey: 'sk-lf-db191bf7-c073-4300-8a7c-cb775630e4e4',
  },
  PROD_LOCAL: {
    label: 'Prod-Local',
    proxyBase: '/langfuse-api-prod',
    publicKey: 'pk-lf-03ec8378-b8ec-4bd2-8777-e0735bbf4011',
    secretKey: 'sk-lf-edac15c0-589b-4236-928f-1f4344875259',
  },
};

function makeAuthHeader(envKey) {
  const env = ENVIRONMENTS[envKey];
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
  const env = ENVIRONMENTS[envKey];
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
