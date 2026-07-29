import { randomUUID } from 'node:crypto';
import { readAppConfig } from './configRepository.js';

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

export function getDoubaoV3Config(config = {}) {
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

export function buildDoubaoAuthHeaders(config) {
  if (config.apiKeyId && config.apiKeySecret) {
    return {
      'X-Api-App-Id': config.apiKeyId,
      'X-Api-Access-Key': config.apiKeySecret,
    };
  }
  return {};
}

export function hasDoubaoAuth(config) {
  return Boolean(config.apiKeyId && config.apiKeySecret);
}

export function isDoubaoAppId(value) {
  return /^\d{6,}$/.test(String(value || '').trim());
}

export function parseDoubaoErrorMessage(text) {
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

export function parseDoubaoJsonLine(text) {
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

export function normalizeDoubaoVoiceType(resourceId, voiceType) {
  const text = String(voiceType || '').trim();
  if (String(resourceId || '').trim() === 'seed-tts-2.0') {
    const seedTts2Fallbacks = {
      zh_female_wanwanxiaohe_moon_bigtts: 'zh_female_vv_uranus_bigtts',
      zh_male_m191_uranus_bigtts: 'zh_male_shaonianzixin_uranus_bigtts',
      en_female_dacey_uranus_bigtts: 'zh_female_vv_uranus_bigtts',
      en_male_tim_uranus_bigtts: 'zh_male_shaonianzixin_uranus_bigtts',
      ja_female_bv522_uranus_bigtts: 'zh_female_vv_uranus_bigtts',
      ja_male_bv524_uranus_bigtts: 'zh_male_shaonianzixin_uranus_bigtts',
      ko_female_bv546_uranus_bigtts: 'zh_female_vv_uranus_bigtts',
      ko_male_m03_uranus_bigtts: 'zh_male_shaonianzixin_uranus_bigtts',
      zh_female_shuangkuaisisi_moon_bigtts: 'zh_female_vv_uranus_bigtts',
      zh_female_roumei_moon_bigtts: 'zh_female_vv_uranus_bigtts',
      zh_male_qingshuangjingshen_moon_bigtts: 'zh_male_shaonianzixin_uranus_bigtts',
      zh_male_wennuanahu_moon_bigtts: 'zh_male_shaonianzixin_uranus_bigtts',
      zh_male_shaonianzixin_moon_bigtts: 'zh_male_shaonianzixin_uranus_bigtts',
    };
    return seedTts2Fallbacks[text] || text;
  }
  return text;
}

function getSeedTtsCompatibleVoiceType(voiceType) {
  const text = String(voiceType || '').trim();
  if (!text || text === 'zh_female_vv_uranus_bigtts' || text === 'zh_male_shaonianzixin_uranus_bigtts') {
    return '';
  }
  return text.includes('_male_')
    ? 'zh_male_shaonianzixin_uranus_bigtts'
    : 'zh_female_vv_uranus_bigtts';
}

function shouldRetryWithSeedCompatibleVoice(errorMessage, resourceId, originalVoiceType, resolvedVoiceType) {
  return String(resourceId || '').trim() === 'seed-tts-2.0'
    && /resource ID is mismatched with speaker related resource/i.test(String(errorMessage || ''))
    && Boolean(getSeedTtsCompatibleVoiceType(originalVoiceType || resolvedVoiceType));
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

export function extractDoubaoAudioBuffers(text) {
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

function createTtsError(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, details);
  return error;
}

export async function synthesizeDoubaoV3(pool, input = {}) {
  const text = String(input.text || input.textContent || '').trim();
  const voiceType = String(input.voiceType || input.voiceCode || '').trim();
  if (!text) {
    throw createTtsError(400, 'TTS 文本为空');
  }
  if (!voiceType) {
    throw createTtsError(400, '豆包 V3 TTS 音色未配置');
  }

  const savedConfig = await readAppConfig(pool, 'doubaoTts');
  const doubaoConfig = getDoubaoV3Config(savedConfig);
  if (!hasDoubaoAuth(doubaoConfig)) {
    throw createTtsError(400, '豆包 V3 APP ID 或 Access Token 未配置');
  }
  if (!isDoubaoAppId(doubaoConfig.apiKeyId)) {
    throw createTtsError(
      400,
      '豆包 V3 APP ID 配置不正确：请填写豆包语音控制台“服务接口认证信息”中的数字 APP ID，不是方舟 API Key ID'
    );
  }
  if (!doubaoConfig.resourceId) {
    throw createTtsError(400, '豆包 V3 Resource ID 未配置');
  }

  let resolvedVoiceType = normalizeDoubaoVoiceType(doubaoConfig.resourceId, voiceType);
  const speedRatio = clampNumber(input.rate ?? input.speed, 0.5, 2, 1);
  const volumeRatio = clampNumber(
    input.volume > 2 ? Number(input.volume || 100) / 100 : input.volume,
    0.1,
    2,
    1
  );
  const audioFormat = String(input.audioFormat || 'mp3').toLowerCase();
  const buildRequestOptions = (speaker) => ({
    method: 'POST',
    headers: {
      ...buildDoubaoAuthHeaders(doubaoConfig),
      'X-Api-Resource-Id': doubaoConfig.resourceId,
      'X-Api-Request-Id': randomUUID(),
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
    },
    body: JSON.stringify({
      user: {
        uid: doubaoConfig.uid,
      },
      req_params: {
        text,
        speaker,
        audio_params: {
          format: audioFormat,
          sample_rate: Number(input.sampleRate || doubaoConfig.sampleRate),
        },
        speed_ratio: speedRatio,
        volume_ratio: volumeRatio,
        language: input.lang || input.language || undefined,
      },
    }),
  });
  let response = await fetch(doubaoConfig.url, buildRequestOptions(resolvedVoiceType));

  let logId = response.headers.get('x-tt-logid') || response.headers.get('x-tt-log-id') || '';
  if (!response.ok) {
    const responseText = await response.text();
    const errorMessage = parseDoubaoErrorMessage(responseText) || '豆包 V3 TTS 请求失败';
    if (shouldRetryWithSeedCompatibleVoice(errorMessage, doubaoConfig.resourceId, voiceType, resolvedVoiceType)) {
      const fallbackVoiceType = getSeedTtsCompatibleVoiceType(voiceType || resolvedVoiceType);
      response = await fetch(doubaoConfig.url, buildRequestOptions(fallbackVoiceType));
      logId = response.headers.get('x-tt-logid') || response.headers.get('x-tt-log-id') || logId;
      if (response.ok) {
        resolvedVoiceType = fallbackVoiceType;
      } else {
        const retryText = await response.text();
        throw createTtsError(502, parseDoubaoErrorMessage(retryText) || errorMessage, {
          providerStatus: response.status || 0,
          logId: response.headers.get('x-tt-logid') || response.headers.get('x-tt-log-id') || logId,
        });
      }
    } else {
      throw createTtsError(502, errorMessage, {
      providerStatus: response.status || 0,
      logId,
      });
    }
  }

  const contentType = response.headers.get('content-type') || '';
  if (/^audio\/|application\/octet-stream/i.test(contentType)) {
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    if (!audioBuffer.length) {
      throw createTtsError(502, '豆包 V3 TTS 返回空音频', { logId });
    }
    return {
      buffer: audioBuffer,
      contentType: contentType.split(';')[0] || 'audio/mpeg',
      sampleRate: Number(input.sampleRate || doubaoConfig.sampleRate),
      logId,
    };
  }

  const responseText = await response.text();
  const parsedResponse = parseDoubaoJsonLine(responseText);
  if (parsedResponse && Number(parsedResponse.code || 0) !== 0) {
    throw createTtsError(502, parsedResponse.message || '豆包 V3 TTS 请求失败', {
      providerCode: Number(parsedResponse.code || 0),
      logId,
    });
  }
  const audioBuffers = extractDoubaoAudioBuffers(responseText);
  if (!audioBuffers.length) {
    throw createTtsError(502, '豆包 V3 TTS 未返回音频片段', { logId });
  }

  return {
    buffer: Buffer.concat(audioBuffers),
    contentType: 'audio/mpeg',
    sampleRate: Number(input.sampleRate || doubaoConfig.sampleRate),
    logId,
  };
}
