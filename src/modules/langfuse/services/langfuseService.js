/**
 * Langfuse API 服务
 * 通过 Vite 代理 /langfuse-api-{env} → 对应环境的 Langfuse 服务器
 */

export const ENVIRONMENTS = {
  UAT: {
    label: 'UAT',
    proxyBase: '/langfuse-api-uat',
    publicKey: 'pk-lf-e2e66182-6508-4abf-914f-d227a678c048',
    secretKey: 'sk-lf-6ea10ab6-2ab5-4ae8-8167-d514e2377538',
  },
  UAT_LOCAL: {
    label: 'UAT-Local',
    proxyBase: '/langfuse-api-uat-local',
    publicKey: 'pk-lf-9cd5f164-a78c-4c49-8593-74f2298c97f3',
    secretKey: 'sk-lf-69f34a45-47a0-4cb8-a238-2cdffa3f5a97',
  },
  TEST: {
    label: 'TEST',
    proxyBase: '/langfuse-api-test',
    publicKey: 'pk-lf-9ee9be4a-744d-4d4f-a15e-e2118061f297',
    secretKey: 'sk-lf-2403e91a-11ed-45d3-b76a-550a8090477f',
  },
  PROD: {
    label: 'PROD',
    proxyBase: '/langfuse-api-prod',
    publicKey: 'pk-lf-452ce6be-7eee-4543-a2ad-0f611357c279',
    secretKey: 'sk-lf-b71813e3-75df-4624-87bc-011aa4a7bcdc',
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
 * @param {string} envKey  - 环境 key: 'UAT' | 'UAT_LOCAL' | 'TEST' | 'PROD'
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

    const data = await response.json();
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
