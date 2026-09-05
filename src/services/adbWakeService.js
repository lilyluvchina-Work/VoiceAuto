const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:17321';
const WAKEUP_KEYWORDS = [
  'WakeupSuccess',
  'WAKEUP_SUCCESS',
  'wakeup success',
  'onCedarWakeup',
  'GlobalControl: onCedarWakeup'
];
const ASR_KEYWORDS = ['ASR result', 'asrText', 'recognizedText', 'finalResult'];
const ASR_START_KEYWORDS = [
  '/ASR_STATUS.*PARTIAL/i',
  '/asr_status[^\\n]*(partial)/i',
  '/"asr_status"\\s*:\\s*"partial"/i'
];
const ASR_END_KEYWORDS = [
  '/ASR_STATUS.*FINAL/i',
  '/asr_status[^\\n]*(final)/i',
  '/"asr_status"\\s*:\\s*"final"/i'
];
const ASR_FAILURE_KEYWORDS = [
  '/ASR_STATUS.*UNIDENTIFIED/i',
  '/asr_status[^\\n]*(unidentified)/i',
  '/"asr_status"\\s*:\\s*"unidentified"/i'
];

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeBridgeUrl(url) {
  const value = trimTrailingSlash(url || DEFAULT_BRIDGE_URL);
  return value || DEFAULT_BRIDGE_URL;
}

function createTimeoutSignal(timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timeoutId = null;

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  timeoutId = setTimeout(abort, Math.max(1000, timeoutMs || 5000) + 1000);

  if (externalSignal) {
    if (externalSignal.aborted) {
      abort();
    } else {
      externalSignal.addEventListener('abort', abort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId)
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`ADB bridge 返回非 JSON 数据: ${text.slice(0, 120)}`);
  }
}

async function postJson(path, payload, options = {}) {
  const { bridgeUrl, timeoutMs, signal } = options;
  const timeout = createTimeoutSignal(timeoutMs, signal);

  try {
    const response = await fetch(`${normalizeBridgeUrl(bridgeUrl)}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload || {}),
      signal: timeout.signal
    });

    const data = await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(data?.message || data?.error || `ADB bridge 请求失败: ${response.status}`);
    }

    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('ADB bridge 请求超时');
    }
    throw err;
  } finally {
    timeout.cleanup();
  }
}

function buildDevicePayload(options = {}) {
  return {
    deviceType: options.deviceType || '',
    logSource: options.logSource || '',
    serialPort: options.serialPort || '',
    baudrate: Number(options.baudrate) || undefined,
  };
}

export async function detectWakeup({
  bridgeUrl,
  deviceId,
  deviceType,
  logSource,
  serialPort,
  baudrate,
  timeoutMs = 5000,
  keywords = WAKEUP_KEYWORDS,
  signal
} = {}) {
  const data = await postJson('/api/adb/wakeup/detect', {
    ...buildDevicePayload({ deviceType, logSource, serialPort, baudrate }),
    deviceId: deviceId || '',
    timeoutMs,
    keywords
  }, {
    bridgeUrl,
    timeoutMs: timeoutMs + 1500,
    signal
  });

  return {
    success: Boolean(data?.success || data?.detected),
    eventTime: data?.eventTime || data?.wakeEventTime || (data?.success ? Date.now() : null),
    matchedKeyword: data?.matchedKeyword || data?.keyword || '',
    matchedLine: data?.matchedLine || data?.line || '',
    sampleLines: Array.isArray(data?.sampleLines) ? data.sampleLines : [],
    raw: data
  };
}

export async function listDevices({
  bridgeUrl,
  deviceType,
  logSource,
  serialPort,
  baudrate,
  timeoutMs = 5000,
  signal
} = {}) {
  const data = await postJson('/api/adb/devices', {
    ...buildDevicePayload({ deviceType, logSource, serialPort, baudrate }),
  }, {
    bridgeUrl,
    timeoutMs,
    signal
  });

  return {
    success: data?.success !== false,
    devices: Array.isArray(data?.devices)
      ? data.devices.map((device) => ({
          id: device?.id || device?.sn || '',
          sn: device?.sn || device?.id || '',
          state: device?.state || '',
          model: device?.model || '',
          product: device?.product || '',
          label: device?.label || [device?.sn || device?.id, device?.model || device?.product].filter(Boolean).join(' · '),
          raw: device?.raw || ''
        })).filter((device) => device.id)
      : [],
    message: data?.message || '',
    usbDiagnostics: Array.isArray(data?.usbDiagnostics) ? data.usbDiagnostics : [],
    raw: data
  };
}

export async function checkListenerHealth({
  bridgeUrl,
  deviceId,
  deviceType,
  logSource,
  serialPort,
  baudrate,
  timeoutMs = 35000,
  signal
} = {}) {
  const data = await postJson('/api/adb/health', {
    ...buildDevicePayload({ deviceType, logSource, serialPort, baudrate }),
    deviceId: deviceId || ''
  }, {
    bridgeUrl,
    timeoutMs,
    signal
  });

  return {
    success: Boolean(data?.success),
    checkedAt: data?.checkedAt || null,
    checkedAtText: data?.checkedAtText || '',
    selectedDeviceId: data?.selectedDeviceId || '',
    selectedDevice: data?.selectedDevice || null,
    devices: Array.isArray(data?.devices) ? data.devices : [],
    checks: data?.checks || {},
    sampleLines: Array.isArray(data?.sampleLines) ? data.sampleLines : [],
    usbDiagnostics: Array.isArray(data?.usbDiagnostics) ? data.usbDiagnostics : [],
    message: data?.message || '',
    raw: data
  };
}

export async function recoverListenerLink({
  bridgeUrl,
  deviceId,
  deviceType,
  logSource,
  serialPort,
  baudrate,
  timeoutMs = 70000,
  signal
} = {}) {
  const data = await postJson('/api/adb/recover', {
    ...buildDevicePayload({ deviceType, logSource, serialPort, baudrate }),
    deviceId: deviceId || ''
  }, {
    bridgeUrl,
    timeoutMs,
    signal
  });

  return {
    success: Boolean(data?.success),
    recoveredDeviceId: data?.recoveredDeviceId || '',
    steps: data?.steps || {},
    health: data?.health || null,
    message: data?.message || '',
    raw: data
  };
}

export async function rebootSpeaker({
  bridgeUrl,
  deviceId,
  deviceType,
  logSource,
  serialPort,
  baudrate,
  recoveryTimeoutMs = 180000,
  signal
} = {}) {
  const data = await postJson('/api/adb/reboot-and-wait', {
    ...buildDevicePayload({ deviceType, logSource, serialPort, baudrate }),
    deviceId: deviceId || '',
    recoveryTimeoutMs
  }, {
    bridgeUrl,
    timeoutMs: recoveryTimeoutMs + 5000,
    signal
  });

  return {
    success: data?.success !== false,
    bootCompleted: data?.bootCompleted === true,
    recoveredDeviceId: data?.recoveredDeviceId || '',
    rebootCommandOk: data?.rebootCommandOk !== false,
    rebootCommandError: data?.rebootCommandError || '',
    health: data?.health || null,
    message: data?.message || '',
    raw: data
  };
}

export async function detectAsr({
  bridgeUrl,
  deviceId,
  deviceType,
  logSource,
  serialPort,
  baudrate,
  timeoutMs = 8000,
  keywords = ASR_KEYWORDS,
  startKeywords = ASR_START_KEYWORDS,
  endKeywords = ASR_END_KEYWORDS,
  failureKeywords = ASR_FAILURE_KEYWORDS,
  patterns = [],
  signal
} = {}) {
  const data = await postJson('/api/adb/asr/detect', {
    ...buildDevicePayload({ deviceType, logSource, serialPort, baudrate }),
    deviceId: deviceId || '',
    timeoutMs,
    keywords,
    startKeywords,
    endKeywords,
    failureKeywords,
    patterns
  }, {
    bridgeUrl,
    timeoutMs: timeoutMs + 1500,
    signal
  });

  return {
    success: Boolean(data?.success),
    status: data?.status || '',
    eventTime: data?.eventTime || (data?.success ? Date.now() : null),
    matchedKeyword: data?.matchedKeyword || data?.keyword || '',
    matchedLine: data?.matchedLine || data?.line || '',
    startDetected: Boolean(data?.startDetected),
    startMatchedKeyword: data?.startMatchedKeyword || '',
    startMatchedLine: data?.startMatchedLine || '',
    startEventTime: data?.startEventTime || null,
    endMatchedKeyword: data?.endMatchedKeyword || '',
    endMatchedLine: data?.endMatchedLine || '',
    endEventTime: data?.endEventTime || null,
    failureMatchedKeyword: data?.failureMatchedKeyword || '',
    failureMatchedLine: data?.failureMatchedLine || '',
    actualAsrText: data?.actualAsrText || data?.actual_asr_text || '',
    message: data?.message || '',
    sampleLines: Array.isArray(data?.sampleLines) ? data.sampleLines : [],
    raw: data
  };
}

export async function detectSpeakerResponseLog({
  bridgeUrl,
  deviceId,
  deviceType,
  logSource,
  serialPort,
  baudrate,
  timeoutMs = 15000,
  maxWaitMs = 60000,
  vadStartKeywords,
  vadEndKeywords,
  ttsKeywords,
  firstAudioKeywords,
  playbackDoneKeywords,
  listeningKeywords,
  failureKeywords,
  signal
} = {}) {
  const data = await postJson('/api/adb/response/detect', {
    ...buildDevicePayload({ deviceType, logSource, serialPort, baudrate }),
    deviceId: deviceId || '',
    timeoutMs,
    maxWaitMs,
    vadStartKeywords,
    vadEndKeywords,
    ttsKeywords,
    firstAudioKeywords,
    playbackDoneKeywords,
    listeningKeywords,
    failureKeywords
  }, {
    bridgeUrl,
    timeoutMs: Math.max(timeoutMs, maxWaitMs) + 1500,
    signal
  });

  return {
    success: Boolean(data?.success),
    status: data?.status || '',
    eventTime: data?.eventTime || (data?.success ? Date.now() : null),
    vadStarted: Boolean(data?.vadStarted),
    vadEnded: Boolean(data?.vadEnded),
    vadStartTime: data?.vadStartTime || null,
    vadEndTime: data?.vadEndTime || null,
    vadStartLine: data?.vadStartLine || '',
    vadEndLine: data?.vadEndLine || '',
    speakerResponseText: data?.speakerResponseText || data?.responseText || '',
    ttsMatchedLine: data?.ttsMatchedLine || '',
    message: data?.message || '',
    sampleLines: Array.isArray(data?.sampleLines) ? data.sampleLines : [],
    raw: data
  };
}

async function aiToySessionRequest(action, options = {}) {
  const { bridgeUrl, signal, sessionId, mode, expectsVoiceResponse } = options;
  return postJson('/api/adb/ai-toy/session', {
    ...buildDevicePayload(options), action, sessionId, mode, expectsVoiceResponse,
  }, { bridgeUrl, signal, timeoutMs: 15000 });
}

export const openAiToySession = options => aiToySessionRequest('open', options);
export const readAiToySession = options => aiToySessionRequest('read', options);
export const armAiToySession = options => aiToySessionRequest('arm', options);
export const closeAiToySession = options => aiToySessionRequest('close', options);

export const adbWakeService = {
  openAiToySession,
  readAiToySession,
  armAiToySession,
  closeAiToySession,
  DEFAULT_BRIDGE_URL,
  WAKEUP_KEYWORDS,
  ASR_KEYWORDS,
  ASR_START_KEYWORDS,
  ASR_END_KEYWORDS,
  ASR_FAILURE_KEYWORDS,
  listDevices,
  checkListenerHealth,
  recoverListenerLink,
  detectWakeup,
  rebootSpeaker,
  detectAsr,
  detectSpeakerResponseLog
};

export default adbWakeService;
