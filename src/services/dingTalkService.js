import {
  SUMMARY_REPORT_STORAGE_KEY,
  ENVIRONMENT_INFO_FIELDS,
  normalizeSubmissionParams,
} from '../utils/summaryReportBuilder';
import { ENVIRONMENTS } from '../modules/langfuse/services/langfuseService';

const DEFAULT_PROXY_PATH = '/dingtalk-robot';
const MISSING = '/';

const DINGTALK_MESSAGE_TYPES = {
  TEST_STARTED: {
    title: '开始执行语音测试',
    level: 'INFO',
    node: '开始执行语音测试',
  },
  TEST_PAUSED: {
    title: '测试流程暂停',
    level: 'INFO',
    node: '测试流程暂停',
  },
  TEST_RESET: {
    title: '测试流程重置',
    level: 'INFO',
    node: '测试流程重置',
  },
  SPEAKER_LISTENER_HEALTH_CHECK: {
    title: 'Speaker监听链路自检结果',
    level: 'INFO',
    node: 'Speaker监听链路自检',
  },
  SPEAKER_LISTENER_HEALTH_FAILED: {
    title: 'Speaker监听链路自检异常',
    level: 'ERROR',
    node: 'Speaker监听链路自检',
  },
  WAKE_CONSECUTIVE_FAILED: {
    title: '音响唤醒连续失败',
    level: 'ERROR',
    node: '音响唤醒连续失败',
  },
  SPEAKER_REBOOT_SUCCESS: {
    title: '音箱重启成功',
    level: 'SUCCESS',
    node: '音箱重启成功',
  },
  SPEAKER_REBOOT_FAILED: {
    title: '音箱重启失败',
    level: 'ERROR',
    node: '音箱重启失败',
  },
  TEST_AUDIO_PLAY_FAILED: {
    title: '测试音频播放失败',
    level: 'ERROR',
    node: '测试音频播放失败',
  },
  SPEAKER_RESPONSE_NOT_DETECTED: {
    title: '未监听到音响回复',
    level: 'ERROR',
    node: '未监听到音响回复',
  },
  STT_FAILED: {
    title: 'STT识别失败 / 识别结果为空',
    level: 'ERROR',
    node: 'STT识别失败 / 识别结果为空',
  },
  LANGFUSE_FETCH_FAILED: {
    title: 'Langfuse日志拉取失败',
    level: 'ERROR',
    node: 'Langfuse日志拉取失败',
  },
  LANGFUSE_FETCH_SUCCEEDED: {
    title: 'Langfuse日志拉取成功',
    level: 'SUCCESS',
    node: 'Langfuse日志拉取成功',
  },
  TEST_COMPLETED: {
    title: '语音测试完成',
    level: 'SUCCESS',
    node: '语音测试完成',
  },
  TEST_INTERRUPTED: {
    title: '测试任务执行失败 / 中断',
    level: 'FATAL',
    node: '测试任务执行失败 / 中断',
  },
};

function normalize(value) {
  return String(value ?? '').trim();
}

function valueOrSlash(value) {
  return normalize(value) || MISSING;
}

function formatDateTime(value = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return MISSING;
  const pad = (part) => String(part).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}

function loadSummaryReport() {
  try {
    const raw = localStorage.getItem(SUMMARY_REPORT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getEnvLabel(envKey) {
  const key = normalize(envKey);
  const label = ENVIRONMENTS[key]?.label || key;
  if (!label) return MISSING;
  return key ? `${label} (${key})` : label;
}

function readEnvironmentInfo(context = {}) {
  const report = loadSummaryReport() || {};
  const state = context.state || {};
  const testOptions = state.testOptions || {};
  const reportState = state.report || {};
  const envKey = context.envKey
    || reportState.langfuseEnvKey
    || testOptions.selectedLangfuseEnv
    || report.envKey
    || '';
  const summaryParams = normalizeSubmissionParams(report.submissionParams || []);
  const paramByName = new Map(summaryParams.map((item) => [item.name, item.value]));

  const serviceRows = ENVIRONMENT_INFO_FIELDS.map((field) => ({
    label: field.label,
    value: valueOrSlash(context.environmentInfo?.[field.key] ?? report[field.key]),
  }));

  const modelRows = [
    '大模型厂商',
    '模型版本',
    '模型温度',
    'Live模型厂商',
    'Live模型版本',
    'Live模型温度',
  ].map((name) => ({
    label: name,
    value: valueOrSlash(context.environmentInfo?.[name] ?? paramByName.get(name)),
  }));

  const voiceRows = summaryParams
    .filter((item) => item.category === '语音识别配置')
    .map((item) => ({
      label: `${item.group ? `${item.group} ` : ''}${item.name}`,
      value: valueOrSlash(item.value),
    }));

  return {
    envKey,
    envText: context.envText || report.testEnvironment || getEnvLabel(envKey),
    serviceRows,
    modelRows,
    voiceRows,
  };
}

function buildMarkdownMessage(type, context = {}) {
  const meta = DINGTALK_MESSAGE_TYPES[type] || type || {};
  const envInfo = readEnvironmentInfo(context);
  const state = context.state || {};
  const report = state.report || {};
  const runId = context.runId || report.runId || MISSING;
  const happenedAt = formatDateTime(context.happenedAt || Date.now());
  const eventDetails = Array.isArray(context.details)
    ? context.details
    : [context.details || context.detail || ''];
  const filteredDetails = eventDetails.map(valueOrSlash).filter((item) => item !== MISSING);

  const lines = [
    `## 【VoiceAuto】【${meta.level || 'INFO'}】${meta.title || '钉钉通知'}`,
    '',
    `- 测试环境：${valueOrSlash(envInfo.envText)}`,
    `- 测试批次ID：${valueOrSlash(runId)}`,
    `- 触发节点：${valueOrSlash(meta.node)}`,
    `- 发生时间：${happenedAt}`,
  ];

  if (context.includeModelInfo) {
    lines.push('', '### 模型配置', ...envInfo.modelRows.map((item) => `- ${item.label}：${item.value}`));
  }

  if (filteredDetails.length) {
    lines.push('', '### 事件详情', ...filteredDetails.map((item) => `- ${item}`));
  }

  return {
    title: `【VoiceAuto】【${meta.level || 'INFO'}】${meta.title || '钉钉通知'}`,
    text: lines.join('\n'),
  };
}

function getRobotConfig() {
  return {
    enabled: import.meta.env.VITE_DINGTALK_ENABLED !== 'false',
    webhook: normalize(import.meta.env.VITE_DINGTALK_WEBHOOK),
    accessToken: normalize(import.meta.env.VITE_DINGTALK_ACCESS_TOKEN),
    secret: normalize(import.meta.env.VITE_DINGTALK_SECRET),
    proxyPath: normalize(import.meta.env.VITE_DINGTALK_PROXY_PATH) || DEFAULT_PROXY_PATH,
  };
}

async function hmacSha256Base64(secret, content) {
  if (!globalThis.crypto?.subtle) {
    return bytesToBase64(hmacSha256Bytes(new TextEncoder().encode(secret), new TextEncoder().encode(content)));
  }

  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(content));
  const bytes = new Uint8Array(signature);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function rightRotate(value, amount) {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Bytes(message) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ];
  const bitLength = message.length * 8;
  const withPadding = new Uint8Array((((message.length + 9 + 63) >> 6) << 6));
  withPadding.set(message);
  withPadding[message.length] = 0x80;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 4, bitLength, false);

  const words = new Uint32Array(64);
  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const output = new Uint8Array(32);
  const outputView = new DataView(output.buffer);
  hash.forEach((value, index) => outputView.setUint32(index * 4, value, false));
  return output;
}

function hmacSha256Bytes(key, message) {
  const blockSize = 64;
  let normalizedKey = key;
  if (normalizedKey.length > blockSize) {
    normalizedKey = sha256Bytes(normalizedKey);
  }

  const innerPad = new Uint8Array(blockSize);
  const outerPad = new Uint8Array(blockSize);
  innerPad.fill(0x36);
  outerPad.fill(0x5c);
  for (let index = 0; index < normalizedKey.length; index += 1) {
    innerPad[index] ^= normalizedKey[index];
    outerPad[index] ^= normalizedKey[index];
  }

  const innerMessage = new Uint8Array(innerPad.length + message.length);
  innerMessage.set(innerPad);
  innerMessage.set(message, innerPad.length);
  const innerHash = sha256Bytes(innerMessage);

  const outerMessage = new Uint8Array(outerPad.length + innerHash.length);
  outerMessage.set(outerPad);
  outerMessage.set(innerHash, outerPad.length);
  return sha256Bytes(outerMessage);
}

async function buildSendUrl(config) {
  const baseUrl = config.proxyPath || config.webhook;
  const url = new URL(baseUrl, window.location.origin);

  if (!url.searchParams.get('access_token')) {
    const token = config.accessToken || new URL(config.webhook || window.location.href).searchParams.get('access_token');
    if (token) url.searchParams.set('access_token', token);
  }

  if (config.secret) {
    const timestamp = Date.now();
    const sign = await hmacSha256Base64(config.secret, `${timestamp}\n${config.secret}`);
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', sign);
  }

  return url.toString();
}

export async function sendDingTalkNotification(type, context = {}) {
  const config = getRobotConfig();
  if (!config.enabled) return { skipped: true, reason: 'disabled' };
  if (!config.webhook && !config.accessToken) return { skipped: true, reason: 'missing-config' };

  const markdown = buildMarkdownMessage(type, context);
  const body = {
    msgtype: 'markdown',
    markdown,
  };

  try {
    const response = await fetch(await buildSendUrl(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json().catch(() => ({}));
    if (result.errcode && result.errcode !== 0) {
      throw new Error(result.errmsg || `DingTalk errcode ${result.errcode}`);
    }
    return { success: true, result };
  } catch (error) {
    console.warn('[VoiceAuto][DingTalk] notification failed:', error);
    return { success: false, error };
  }
}

export function notifyDingTalk(type, context = {}) {
  return sendDingTalkNotification(type, context);
}
