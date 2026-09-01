const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.ADB_BRIDGE_PORT) || 17321;
const HOST = process.env.ADB_BRIDGE_HOST || '127.0.0.1';
const LOG_SOURCE_ADB = 'adb';
const LOG_SOURCE_SERIAL = 'serial';
const DEVICE_TYPE_AI_TOY = 'ai_toy';
const DEFAULT_KEYWORDS = [
  'WakeupSuccess',
  'WAKEUP_SUCCESS',
  'wakeup success',
  'onCedarWakeup',
  'GlobalControl: onCedarWakeup'
];
const DEFAULT_ASR_KEYWORDS = [
  'ASR result',
  'asrText',
  'recognizedText',
  'finalResult'
];
const DEFAULT_ASR_START_KEYWORDS = [
  '/ASR_STATUS.*PARTIAL/i',
  '/asr_status[^\\n]*(partial)/i',
  '/"asr_status"\\s*:\\s*"partial"/i',
  '/onHandlerCloudMsg==>GoogleLiveResponseBean.*messageType=asr_status/i',
  'ASR start',
  'asr start',
  'recognition start',
  'onBeginOfSpeech',
  'beginning of speech'
];
const DEFAULT_ASR_END_KEYWORDS = [
  '/ASR_STATUS.*FINAL/i',
  '/asr_status[^\\n]*(final)/i',
  '/"asr_status"\\s*:\\s*"final"/i',
  '/onHandlerCloudMsg==>GoogleLiveResponseBean.*messageType=input_text/i',
  'ASR result',
  'asrText',
  'recognizedText',
  'finalResult',
  'ASR end',
  'asr end',
  'recognition end',
  'onEndOfSpeech'
];
const DEFAULT_ASR_FAILURE_KEYWORDS = [
  '/ASR_STATUS.*UNIDENTIFIED/i',
  '/asr_status[^\\n]*(unidentified)/i',
  '/"asr_status"\\s*:\\s*"unidentified"/i',
  'ASR fail',
  'ASR failed',
  'asr error',
  'recognition failed',
  'onError'
];
const DEFAULT_RESPONSE_VAD_START_KEYWORDS = [
  '/VAD_STATUS.*START/i',
  '/vad_status[^\\n]*(start)/i',
  '/"vad_status"\\s*:\\s*"start"/i'
];
const DEFAULT_RESPONSE_VAD_END_KEYWORDS = [
  '/VAD_STATUS.*STOP/i',
  '/vad_status[^\\n]*(stop)/i',
  '/"vad_status"\\s*:\\s*"stop"/i'
];
const DEFAULT_RESPONSE_TTS_KEYWORDS = [
  'TTS_STATUS',
  'tts_status'
];
const AI_TOY_WAKE_KEYWORDS = ['VOICE WAKE WORD HIT ACCEPTED'];
const AI_TOY_INPUT_KEYWORDS = ['Cedar: Input Text'];
const AI_TOY_FIRST_AUDIO_KEYWORDS = ['Audio latency first_downlink_audio'];
const AI_TOY_PLAYBACK_DONE_KEYWORDS = ['TTS playback done'];
const AI_TOY_LISTENING_KEYWORDS = ['Cedar: Start listening'];
const AI_TOY_FAILURE_KEYWORDS = [
  'Application: ║ New State: idle',
  'Application: New State: idle',
  'WS response timeout (no_tts_start)',
  'Rebooting.',
  'Guru Meditation',
  'task_wdt',
  'I2C transaction timeout'
];
const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'adb-bridge.log');

function appendBridgeLog(message, details = {}) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}${suffix}\n`, 'utf8');
  } catch (err) {
    console.warn('[ADB Bridge] failed to write log:', err?.message || err);
  }

  console.log(`[ADB Bridge] ${message}`, details);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function resolveLogSource(body = {}) {
  return body.logSource === LOG_SOURCE_SERIAL ? LOG_SOURCE_SERIAL : LOG_SOURCE_ADB;
}

function isAiToy(body = {}) {
  return body.deviceType === DEVICE_TYPE_AI_TOY;
}

async function loadSerialPort() {
  try {
    return require('serialport');
  } catch (err) {
    const error = new Error('USB串口模式需要安装 serialport 依赖：npm install serialport@^12.0.0');
    error.cause = err;
    throw error;
  }
}

async function listSerialPorts() {
  const serial = await loadSerialPort();
  const ports = await serial.SerialPort.list();
  const devices = ports.map((port) => ({
    id: port.path,
    sn: port.serialNumber || port.path,
    state: 'device',
    model: port.manufacturer || '',
    product: port.friendlyName || port.pnpId || '',
    transportId: '',
    label: [port.path, port.manufacturer || port.friendlyName || port.pnpId].filter(Boolean).join(' · '),
    raw: JSON.stringify(port)
  }));

  appendBridgeLog('serial.devices.list', { devices });

  return {
    success: true,
    devices,
    message: ''
  };
}

function normalizeSerialPath(body = {}) {
  return String(body.serialPort || body.deviceId || '').trim();
}

function closeSerialQuietly(port) {
  if (!port) return;
  try {
    if (port.isOpen) {
      port.close(() => {});
    }
  } catch (err) {
    appendBridgeLog('serial.close.error', { message: err?.message || String(err) });
  }
}

function detectFromSerial({
  serialPort,
  baudrate,
  timeoutMs,
  matchers,
  failureMatchers = [],
  extractText = () => '',
  buildSuccess = (line, matcher) => ({ success: true, matchedKeyword: matcher.label, matchedLine: line }),
  buildFailure = (line, matcher) => ({ success: false, status: 'failed_marker', matchedKeyword: matcher.label, matchedLine: line }),
  timeoutMessage = 'Serial marker not detected before timeout'
}) {
  const safeTimeoutMs = Math.max(1000, Number(timeoutMs) || 5000);
  const safeBaudrate = Number(baudrate) || 115200;
  const safeSerialPort = String(serialPort || '').trim();

  if (!safeSerialPort) {
    return Promise.resolve({
      success: false,
      status: 'serial_port_missing',
      eventTime: null,
      matchedKeyword: '',
      matchedLine: '',
      sampleLines: [],
      message: 'USB串口模式需要填写串口号'
    });
  }

  return new Promise(async (resolve, reject) => {
    let done = false;
    let serialModule;
    let serialDevice;
    let buffered = '';
    let extractedText = '';
    const sampleLines = [];

    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      closeSerialQuietly(serialDevice);
      resolve({
        ...payload,
        sampleLines: sampleLines.slice(-30)
      });
    };

    const handleLine = (line) => {
      const text = String(line || '').trim();
      if (!text) return;
      sampleLines.push(text);
      if (sampleLines.length > 200) sampleLines.shift();

      const nextText = extractText(text);
      if (nextText) extractedText = nextText;

      const failureMatcher = failureMatchers.find((item) => item.test(text));
      if (failureMatcher) {
        finish({
          ...buildFailure(text, failureMatcher, extractedText),
          eventTime: Date.now()
        });
        return;
      }

      const matcher = matchers.find((item) => item.test(text));
      if (matcher) {
        const payload = {
          ...buildSuccess(text, matcher, extractedText),
          eventTime: Date.now()
        };
        if (payload.success === false && payload.keepWaiting) {
          return;
        }
        finish(payload);
      }
    };

    const timeoutId = setTimeout(() => {
      finish({
        success: false,
        status: 'timeout',
        eventTime: null,
        matchedKeyword: '',
        matchedLine: '',
        actualAsrText: extractedText,
        message: timeoutMessage
      });
    }, safeTimeoutMs);

    try {
      serialModule = await loadSerialPort();
      serialDevice = new serialModule.SerialPort({
        path: safeSerialPort,
        baudRate: safeBaudrate,
        autoOpen: true
      });
    } catch (err) {
      clearTimeout(timeoutId);
      reject(err);
      return;
    }

    serialDevice.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || '';
      for (const line of lines) {
        handleLine(line);
        if (done) break;
      }
    });

    serialDevice.on('error', (err) => {
      if (done) return;
      clearTimeout(timeoutId);
      closeSerialQuietly(serialDevice);
      reject(err);
    });
  });
}

function buildAdbArgs(deviceId, args) {
  return deviceId ? ['-s', deviceId, ...args] : args;
}

function runAdb(deviceId, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn('adb', buildAdbArgs(deviceId, args), {
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error(`adb ${args.join(' ')} timed out`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `adb ${args.join(' ')} exited with ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAdbSafe(deviceId, args, timeoutMs = 30000) {
  try {
    const result = await runAdb(deviceId, args, timeoutMs);
    return { ok: true, ...result };
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: err?.message || String(err)
    };
  }
}

async function listAdbDevices() {
  const result = await runAdbSafe('', ['devices', '-l'], 10000);
  const devices = parseAdbDevices(result.stdout).map((device) => {
    const line = String(device.rawLine || '');
    const model = line.match(/\bmodel:([^\s]+)/)?.[1] || '';
    const product = line.match(/\bproduct:([^\s]+)/)?.[1] || '';
    const transportId = line.match(/\btransport_id:([^\s]+)/)?.[1] || '';
    return {
      id: device.id,
      sn: device.id,
      state: device.state,
      model,
      product,
      transportId,
      label: [device.id, model || product].filter(Boolean).join(' · '),
      raw: line
    };
  });

  appendBridgeLog('adb.devices.list', {
    ok: result.ok,
    error: result.error || '',
    devices
  });

  return {
    success: result.ok,
    devices,
    message: result.ok ? '' : (result.error || 'adb devices failed')
  };
}

async function getAdbHealth({ deviceId }) {
  const checkedAt = Date.now();
  // Startup self-check: verify ADB, selected device, boot state, and logcat readability together.
  const devicesResult = await listAdbDevices();
  const devices = devicesResult.devices || [];
  const selectedDevice = deviceId
    ? devices.find((device) => device.id === deviceId) || null
    : devices.find((device) => device.state === 'device') || devices[0] || null;
  const selectedDeviceId = selectedDevice?.id || deviceId || '';
  const adbConnected = Boolean(devicesResult.success);
  const speakerOnline = Boolean(selectedDevice && selectedDevice.state === 'device');

  let getStateResult = null;
  let bootResult = null;
  let logcatResult = null;
  if (selectedDeviceId) {
    getStateResult = await runAdbSafe(selectedDeviceId, ['get-state'], 5000);
    bootResult = await runAdbSafe(selectedDeviceId, ['shell', 'getprop', 'sys.boot_completed'], 5000);
    logcatResult = await runAdbSafe(selectedDeviceId, ['logcat', '-d', '-v', 'threadtime'], 8000);
  }

  const getStateText = String(getStateResult?.stdout || '').trim();
  const bootCompleted = String(bootResult?.stdout || '').trim() === '1';
  const logcatReadable = Boolean(logcatResult?.ok);
  const sampleLines = String(logcatResult?.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20);
  const success = Boolean(adbConnected && speakerOnline && logcatReadable);
  const checks = {
    adbConnected,
    speakerOnline,
    deviceState: getStateText || selectedDevice?.state || '',
    bootCompleted,
    logcatReadable,
    logcatHasRecentOutput: sampleLines.length > 0
  };
  const failures = [];
  if (!adbConnected) failures.push(devicesResult.message || 'ADB devices command failed');
  if (!selectedDeviceId) failures.push('未发现 ADB Speaker 设备');
  if (selectedDeviceId && !speakerOnline) failures.push(`设备状态异常：${selectedDevice?.state || 'not_found'}`);
  if (selectedDeviceId && getStateResult && !getStateResult.ok) failures.push(getStateResult.error || 'adb get-state failed');
  if (selectedDeviceId && bootResult && !bootResult.ok) failures.push(bootResult.error || 'boot_completed 读取失败');
  if (selectedDeviceId && logcatResult && !logcatResult.ok) failures.push(logcatResult.error || 'adb logcat 不可读');

  const payload = {
    success,
    checkedAt,
    checkedAtText: new Date(checkedAt).toLocaleString('zh-CN', { hour12: false }),
    selectedDeviceId,
    selectedDevice,
    devices,
    checks,
    sampleLines,
    message: success ? 'Speaker 监听链路可用' : failures.join('；')
  };

  appendBridgeLog('adb.health.check', payload);
  return payload;
}

async function getSerialHealth(body = {}) {
  const checkedAt = Date.now();
  const serialPort = normalizeSerialPath(body);
  const devicesResult = await listSerialPorts();
  const devices = devicesResult.devices || [];
  const selectedDevice = serialPort
    ? devices.find((device) => device.id === serialPort) || null
    : devices[0] || null;
  const selectedDeviceId = selectedDevice?.id || serialPort || '';
  const success = Boolean(selectedDeviceId);
  const checks = {
    adbConnected: false,
    speakerOnline: success,
    deviceState: success ? 'device' : '',
    bootCompleted: false,
    logcatReadable: false,
    logcatHasRecentOutput: false,
    serialConnected: success
  };

  const payload = {
    success,
    checkedAt,
    checkedAtText: new Date(checkedAt).toLocaleString('zh-CN', { hour12: false }),
    selectedDeviceId,
    selectedDevice,
    devices,
    checks,
    sampleLines: [],
    message: success ? 'USB串口监听链路可用' : '未发现 USB 串口设备或未填写串口号'
  };

  appendBridgeLog('serial.health.check', payload);
  return payload;
}

async function recoverAdbLink({ deviceId }) {
  const startedAt = Date.now();
  appendBridgeLog('adb.recover.start', { deviceId: deviceId || '<default>' });
  // Recovery is conservative: restart adb, reselect a live device, clear stale logs, then re-check.
  const killResult = await runAdbSafe('', ['kill-server'], 10000);
  const startResult = await runAdbSafe('', ['start-server'], 10000);
  const devicesResult = await listAdbDevices();
  const devices = devicesResult.devices || [];
  const selectedDevice = deviceId
    ? devices.find((device) => device.id === deviceId && device.state === 'device') || null
    : devices.find((device) => device.state === 'device') || null;
  const recoveredDeviceId = selectedDevice?.id || '';
  const clearResult = recoveredDeviceId
    ? await runAdbSafe(recoveredDeviceId, ['logcat', '-c'], 8000)
    : { ok: false, stdout: '', stderr: '', error: '未发现可用设备，无法清理 logcat' };
  const health = await getAdbHealth({ deviceId: recoveredDeviceId || deviceId || '' });
  const payload = {
    success: Boolean(health.success),
    startedAt,
    finishedAt: Date.now(),
    recoveredDeviceId,
    steps: {
      killServer: { ok: killResult.ok, error: killResult.error || '' },
      startServer: { ok: startResult.ok, error: startResult.error || '' },
      listDevices: { ok: devicesResult.success, error: devicesResult.message || '', devices },
      clearLogcat: { ok: clearResult.ok, error: clearResult.error || '' }
    },
    health,
    message: health.success ? 'ADB / logcat 监听链路已恢复' : (health.message || '监听链路恢复失败')
  };
  appendBridgeLog('adb.recover.finish', payload);
  return payload;
}

async function recoverLogLink(body = {}) {
  if (resolveLogSource(body) === LOG_SOURCE_SERIAL) {
    const health = await getSerialHealth(body);
    return {
      success: Boolean(health.success),
      recoveredDeviceId: health.selectedDeviceId || '',
      steps: {
        serialHealth: { ok: Boolean(health.success), error: health.success ? '' : health.message }
      },
      health,
      message: health.success ? 'USB串口监听链路已确认' : health.message
    };
  }

  return recoverAdbLink(body);
}

function parseAdbDevices(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => {
      const [id, state] = line.split(/\s+/);
      return { id, state, rawLine: line };
    })
    .filter((item) => item.id);
}

async function waitForAdbDevice(deviceId, timeoutMs, pollMs = 2000) {
  const start = Date.now();
  const fallbackAfterMs = 15000;
  while (Date.now() - start < timeoutMs) {
    const result = await runAdbSafe('', ['devices'], 10000);
    const devices = parseAdbDevices(result.stdout);
    const matchedDevice = deviceId
      ? devices.find((item) => item.id === deviceId && item.state === 'device')
      : devices.find((item) => item.state === 'device');
    const fallbackDevice = devices.find((item) => item.state === 'device');
    const shouldFallback = Boolean(deviceId) && Date.now() - start >= fallbackAfterMs;

    appendBridgeLog('adb.wait_device.poll', {
      deviceId: deviceId || '<default>',
      ok: result.ok,
      error: result.error || '',
      devices,
      shouldFallback
    });

    if (matchedDevice) {
      return matchedDevice.id;
    }

    if (shouldFallback && fallbackDevice) {
      appendBridgeLog('adb.wait_device.fallback_matched', {
        requestedDeviceId: deviceId,
        recoveredDeviceId: fallbackDevice.id,
        devices
      });
      return fallbackDevice.id;
    }

    await sleep(pollMs);
  }

  throw new Error('Speaker ADB device recovery timeout');
}

function createKeywordMatchers(keywords) {
  return (Array.isArray(keywords) && keywords.length ? keywords : DEFAULT_KEYWORDS)
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean)
    .map((keyword) => {
      const regexMatch = keyword.match(/^\/(.+)\/([a-z]*)$/i);
      if (regexMatch) {
        try {
          return {
            label: keyword,
            test: (line) => new RegExp(regexMatch[1], regexMatch[2]).test(line)
          };
        } catch (err) {
          return null;
        }
      }

      const lowerKeyword = keyword.toLowerCase();
      return {
        label: keyword,
        test: (line) => line.toLowerCase().includes(lowerKeyword)
      };
    })
    .filter(Boolean);
}

function extractAsrTextFromLine(line, patterns) {
  const text = String(line || '');
  const customPatterns = Array.isArray(patterns) ? patterns : [];
  for (const pattern of customPatterns) {
    const raw = String(pattern || '').trim();
    if (!raw) continue;
    const regexMatch = raw.match(/^\/(.+)\/([a-z]*)$/i);
    if (!regexMatch) continue;
    try {
      const match = text.match(new RegExp(regexMatch[1], regexMatch[2]));
      if (match?.[1]) return match[1].trim();
    } catch (err) {
      appendBridgeLog('asr.extract.regex.invalid', { pattern: raw, message: err?.message || String(err) });
    }
  }

  const builtInPatterns = [
    /onHandlerCloudMsg==>GoogleLiveResponseBean[\s\S]*?message=Message\(content=([\s\S]*?),\s*messageType=(?:asr_status|input_text)\)/i,
    /message=Message\(content=([\s\S]*?),\s*messageType=(?:asr_status|input_text)\)/i,
    /(?:ASR result|asrText|recognizedText|finalResult|actual_asr_text|asr_result)\s*[:=]\s*["']?([^"',，。；;\]\}]+)/i,
    /"?(?:asrText|recognizedText|finalResult|actual_asr_text|asr_result)"?\s*[:=]\s*"([^"]+)"/i,
    /'?(?:asrText|recognizedText|finalResult|actual_asr_text|asr_result)'?\s*[:=]\s*'([^']+)'/i,
    /(?:识别结果|最终识别|ASR文本)\s*[:：]\s*([^，。；;\]\}]+)/i
  ];

  for (const pattern of builtInPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return '';
}

function extractTtsTextFromLine(line) {
  const text = String(line || '');
  const patterns = [
    /(?:response_text|responseText|ttsText|tts_text|speakText|content|text)\s*[:=]\s*["']([^"']+)["']/i,
    /"?(?:response_text|responseText|ttsText|tts_text|speakText|content|text)"?\s*:\s*"([^"]+)"/i,
    /'?(?:response_text|responseText|ttsText|tts_text|speakText|content|text)'?\s*:\s*'([^']+)'/i,
    /(?:回复内容|播报内容|TTS文本|响应文本)\s*[:：]\s*([^，。；;\]\}]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return '';
}

function detectAsr({ deviceId, timeoutMs, keywords, patterns, startKeywords, endKeywords, failureKeywords }) {
  const safeTimeoutMs = Math.max(1000, Number(timeoutMs) || 8000);
  if (arguments[0] && resolveLogSource(arguments[0]) === LOG_SOURCE_SERIAL) {
    const body = arguments[0];
    const safeStartKeywords = Array.isArray(startKeywords) && startKeywords.length
      ? startKeywords
      : (isAiToy(body) ? AI_TOY_INPUT_KEYWORDS : DEFAULT_ASR_START_KEYWORDS);
    const safeEndKeywords = Array.isArray(endKeywords) && endKeywords.length
      ? endKeywords
      : (isAiToy(body) ? AI_TOY_INPUT_KEYWORDS : (Array.isArray(keywords) && keywords.length ? keywords : DEFAULT_ASR_END_KEYWORDS));
    const safeFailureKeywords = Array.isArray(failureKeywords) && failureKeywords.length
      ? failureKeywords
      : (isAiToy(body) ? AI_TOY_FAILURE_KEYWORDS : DEFAULT_ASR_FAILURE_KEYWORDS);

    return detectFromSerial({
      serialPort: normalizeSerialPath(body),
      baudrate: body.baudrate,
      timeoutMs: safeTimeoutMs,
      matchers: createKeywordMatchers(safeEndKeywords),
      failureMatchers: createKeywordMatchers(safeFailureKeywords),
      extractText: (line) => extractAsrTextFromLine(line, patterns),
      buildSuccess: (line, matcher, actualAsrText) => ({
        success: true,
        status: 'completed',
        matchedKeyword: matcher.label,
        matchedLine: line,
        startDetected: true,
        startMatchedKeyword: createKeywordMatchers(safeStartKeywords).find((item) => item.test(line))?.label || matcher.label,
        startMatchedLine: line,
        startEventTime: Date.now(),
        endMatchedKeyword: matcher.label,
        endMatchedLine: line,
        endEventTime: Date.now(),
        actualAsrText,
        message: actualAsrText ? '' : 'ASR marker detected but text extraction failed'
      }),
      buildFailure: (line, matcher, actualAsrText) => ({
        success: false,
        status: 'failed_marker',
        matchedKeyword: matcher.label,
        matchedLine: line,
        failureMatchedKeyword: matcher.label,
        failureMatchedLine: line,
        actualAsrText,
        message: 'ASR failure marker detected'
      }),
      timeoutMessage: 'Serial ASR marker not detected before timeout'
    });
  }

  const startMatchers = createKeywordMatchers(Array.isArray(startKeywords) && startKeywords.length ? startKeywords : DEFAULT_ASR_START_KEYWORDS);
  const endMatchers = createKeywordMatchers(
    Array.isArray(endKeywords) && endKeywords.length
      ? endKeywords
      : (Array.isArray(keywords) && keywords.length ? keywords : DEFAULT_ASR_END_KEYWORDS)
  );
  const failureMatchers = createKeywordMatchers(Array.isArray(failureKeywords) && failureKeywords.length ? failureKeywords : DEFAULT_ASR_FAILURE_KEYWORDS);
  const detectId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  appendBridgeLog('asr.detect.start', {
    detectId,
    deviceId: deviceId || '<default>',
    timeoutMs: safeTimeoutMs,
    startKeywords: startMatchers.map((item) => item.label),
    endKeywords: endMatchers.map((item) => item.label),
    failureKeywords: failureMatchers.map((item) => item.label),
    patterns: Array.isArray(patterns) ? patterns : []
  });

  return new Promise((resolve, reject) => {
    const child = spawn('adb', buildAdbArgs(deviceId, ['logcat', '-c']), { windowsHide: true });
    let done = false;
    let stderr = '';
    const sampleLines = [];
    let logcatChild = null;
    let startDetected = false;
    let startMatchedKeyword = '';
    let startMatchedLine = '';
    let startEventTime = null;
    let actualAsrText = '';

    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      child.kill();
      if (logcatChild) logcatChild.kill();
      appendBridgeLog('asr.detect.finish', {
        detectId,
        success: Boolean(payload.success),
        status: payload.status || '',
        startMatchedKeyword: payload.startMatchedKeyword || '',
        endMatchedKeyword: payload.endMatchedKeyword || '',
        failureMatchedKeyword: payload.failureMatchedKeyword || '',
        matchedKeyword: payload.matchedKeyword || '',
        actualAsrText: payload.actualAsrText || '',
        matchedLine: payload.matchedLine || '',
        sampleCount: sampleLines.length,
        lastSampleLines: sampleLines.slice(-5)
      });
      resolve({
        ...payload,
        sampleLines: sampleLines.slice(-30)
      });
    };

    const timeoutId = setTimeout(() => {
      finish({
        success: false,
        status: 'timeout',
        eventTime: null,
        matchedKeyword: '',
        matchedLine: '',
        actualAsrText,
        startDetected,
        startMatchedKeyword,
        startMatchedLine,
        startEventTime,
        message: startDetected
          ? 'ASR start detected but end marker not detected before timeout'
          : 'ASR start marker not detected before timeout'
      });
    }, safeTimeoutMs);

    const handleLogcatData = (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        sampleLines.push(line);
        if (sampleLines.length > 200) sampleLines.shift();
        appendBridgeLog('asr.logcat.line', { detectId, line });

        const extractedText = extractAsrTextFromLine(line, patterns);
        if (extractedText) actualAsrText = extractedText;

        const failureMatcher = failureMatchers.find((item) => item.test(line));
        if (failureMatcher) {
          finish({
            success: false,
            status: 'failed_marker',
            eventTime: Date.now(),
            matchedKeyword: failureMatcher.label,
            matchedLine: line,
            failureMatchedKeyword: failureMatcher.label,
            failureMatchedLine: line,
            actualAsrText,
            startDetected,
            startMatchedKeyword,
            startMatchedLine,
            startEventTime,
            message: 'ASR failure marker detected'
          });
          break;
        }

        if (!startDetected) {
          const startMatcher = startMatchers.find((item) => item.test(line));
          if (startMatcher) {
            startDetected = true;
            startMatchedKeyword = startMatcher.label;
            startMatchedLine = line;
            startEventTime = Date.now();
            appendBridgeLog('asr.start.marker.detected', {
              detectId,
              matchedKeyword: startMatcher.label,
              matchedLine: line
            });
          }
        }

        if (!startDetected) continue;

        const endMatcher = endMatchers.find((item) => item.test(line));
        if (endMatcher) {
          finish({
            success: true,
            status: 'completed',
            eventTime: Date.now(),
            matchedKeyword: endMatcher.label,
            matchedLine: line,
            startDetected: true,
            startMatchedKeyword,
            startMatchedLine,
            startEventTime,
            endMatchedKeyword: endMatcher.label,
            endMatchedLine: line,
            endEventTime: Date.now(),
            actualAsrText,
            message: actualAsrText ? '' : 'ASR start/end markers detected but text extraction failed'
          });
          break;
        }
      }
    };

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      appendBridgeLog('asr.logcat.clear.stderr', { detectId, text: chunk.toString() });
    });

    child.on('error', (err) => {
      appendBridgeLog('asr.logcat.clear.error', { detectId, message: err?.message || String(err) });
      reject(err);
    });

    child.on('close', (code) => {
      if (done) return;
      if (code !== 0) {
        clearTimeout(timeoutId);
        appendBridgeLog('asr.logcat.clear.failed', { detectId, code, stderr });
        reject(new Error(stderr.trim() || `adb logcat exited with ${code}`));
        return;
      }

      appendBridgeLog('asr.logcat.realtime.start', { detectId });
      logcatChild = spawn('adb', buildAdbArgs(deviceId, ['logcat', '-v', 'threadtime']), {
        windowsHide: true
      });
      logcatChild.stdout.on('data', handleLogcatData);
      logcatChild.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        appendBridgeLog('asr.logcat.stderr', { detectId, text: chunk.toString() });
      });
      logcatChild.on('error', (err) => {
        appendBridgeLog('asr.logcat.error', { detectId, message: err?.message || String(err) });
        reject(err);
      });
      logcatChild.on('close', (logcatCode) => {
        if (!done && logcatCode !== 0) {
          clearTimeout(timeoutId);
          appendBridgeLog('asr.logcat.failed', { detectId, code: logcatCode, stderr });
          reject(new Error(stderr.trim() || `adb logcat exited with ${logcatCode}`));
        }
      });
    });
  });
}

function detectSpeakerResponseLog({ deviceId, timeoutMs, maxWaitMs, vadStartKeywords, vadEndKeywords, ttsKeywords, firstAudioKeywords, playbackDoneKeywords, listeningKeywords, failureKeywords }) {
  const safeTimeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
  const safeMaxWaitMs = Math.max(safeTimeoutMs, Number(maxWaitMs) || 60000);
  if (arguments[0] && resolveLogSource(arguments[0]) === LOG_SOURCE_SERIAL) {
    const body = arguments[0];
    const firstAudioMatchers = createKeywordMatchers(
      Array.isArray(firstAudioKeywords) && firstAudioKeywords.length
        ? firstAudioKeywords
        : (isAiToy(body) ? AI_TOY_FIRST_AUDIO_KEYWORDS : DEFAULT_RESPONSE_VAD_START_KEYWORDS)
    );
    const playbackDoneMatchers = createKeywordMatchers(
      Array.isArray(playbackDoneKeywords) && playbackDoneKeywords.length
        ? playbackDoneKeywords
        : (isAiToy(body) ? AI_TOY_PLAYBACK_DONE_KEYWORDS : DEFAULT_RESPONSE_VAD_END_KEYWORDS)
    );
    const listeningMatchers = createKeywordMatchers(
      Array.isArray(listeningKeywords) && listeningKeywords.length
        ? listeningKeywords
        : (isAiToy(body) ? AI_TOY_LISTENING_KEYWORDS : [])
    );
    const failureMatchers = createKeywordMatchers(
      Array.isArray(failureKeywords) && failureKeywords.length
        ? failureKeywords
        : (isAiToy(body) ? AI_TOY_FAILURE_KEYWORDS : [])
    );

    return new Promise(async (resolve, reject) => {
      let firstAudioDetected = false;
      let playbackDoneDetected = false;
      let firstAudioTime = null;
      let playbackDoneTime = null;
      try {
        const result = await detectFromSerial({
          serialPort: normalizeSerialPath(body),
          baudrate: body.baudrate,
          timeoutMs: safeMaxWaitMs,
          matchers: [
            ...firstAudioMatchers,
            ...playbackDoneMatchers,
            ...listeningMatchers
          ],
          failureMatchers,
          extractText: extractTtsTextFromLine,
          buildSuccess: (line, matcher, speakerResponseText) => {
            if (firstAudioMatchers.some((item) => item.label === matcher.label && item.test(line))) {
              firstAudioDetected = true;
              firstAudioTime = Date.now();
            }
            if (playbackDoneMatchers.some((item) => item.label === matcher.label && item.test(line))) {
              playbackDoneDetected = true;
              playbackDoneTime = Date.now();
            }
            const listeningDetected = listeningMatchers.some((item) => item.label === matcher.label && item.test(line));
            const success = isAiToy(body)
              ? Boolean(firstAudioDetected && playbackDoneDetected && listeningDetected)
              : Boolean(firstAudioDetected || playbackDoneDetected || speakerResponseText);

            return {
              success,
              status: success ? 'completed' : 'partial_marker',
              keepWaiting: !success,
              matchedKeyword: matcher.label,
              matchedLine: line,
              vadStarted: firstAudioDetected,
              vadEnded: playbackDoneDetected,
              vadStartTime: firstAudioTime,
              vadEndTime: playbackDoneTime,
              speakerResponseText,
              ttsMatchedLine: line,
              message: success ? '' : 'Serial response marker detected but completion sequence is not finished'
            };
          },
          buildFailure: (line, matcher, speakerResponseText) => ({
            success: false,
            status: 'failed_marker',
            matchedKeyword: matcher.label,
            matchedLine: line,
            vadStarted: firstAudioDetected,
            vadEnded: playbackDoneDetected,
            vadStartTime: firstAudioTime,
            vadEndTime: playbackDoneTime,
            speakerResponseText,
            ttsMatchedLine: '',
            message: 'Serial response failure marker detected'
          }),
          timeoutMessage: 'Serial response marker not detected before timeout'
        });
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  }

  // Once VAD starts, keep waiting up to maxWaitMs so long TTS playback can finish cleanly.
  const startMatchers = createKeywordMatchers(Array.isArray(vadStartKeywords) && vadStartKeywords.length ? vadStartKeywords : DEFAULT_RESPONSE_VAD_START_KEYWORDS);
  const endMatchers = createKeywordMatchers(Array.isArray(vadEndKeywords) && vadEndKeywords.length ? vadEndKeywords : DEFAULT_RESPONSE_VAD_END_KEYWORDS);
  const ttsMatchers = createKeywordMatchers(Array.isArray(ttsKeywords) && ttsKeywords.length ? ttsKeywords : DEFAULT_RESPONSE_TTS_KEYWORDS);
  const detectId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const detectStartTime = Date.now();

  appendBridgeLog('response.detect.start', {
    detectId,
    deviceId: deviceId || '<default>',
    timeoutMs: safeTimeoutMs,
    maxWaitMs: safeMaxWaitMs,
    vadStartKeywords: startMatchers.map((item) => item.label),
    vadEndKeywords: endMatchers.map((item) => item.label),
    ttsKeywords: ttsMatchers.map((item) => item.label)
  });

  return new Promise((resolve, reject) => {
    const child = spawn('adb', buildAdbArgs(deviceId, ['logcat', '-c']), { windowsHide: true });
    let done = false;
    let stderr = '';
    const sampleLines = [];
    let logcatChild = null;
    let vadStarted = false;
    let vadStartTime = null;
    let vadStartLine = '';
    let vadEndTime = null;
    let vadEndLine = '';
    let speakerResponseText = '';
    let ttsMatchedLine = '';

    let timeoutId = null;
    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      child.kill();
      if (logcatChild) logcatChild.kill();
      appendBridgeLog('response.detect.finish', {
        detectId,
        success: Boolean(payload.success),
        speakerResponseText: payload.speakerResponseText || '',
        vadStarted: Boolean(payload.vadStarted),
        vadEnded: Boolean(payload.vadEnded),
        sampleCount: sampleLines.length,
        lastSampleLines: sampleLines.slice(-5)
      });
      resolve({
        ...payload,
        sampleLines: sampleLines.slice(-30)
      });
    };

    const handleTimeout = () => {
      const elapsedMs = Date.now() - detectStartTime;
      const remainingMs = safeMaxWaitMs - elapsedMs;

      if (vadStarted && !vadEndTime && remainingMs > 0) {
        const nextPollMs = Math.min(5000, remainingMs);
        appendBridgeLog('response.detect.waiting_for_vad_end', {
          detectId,
          elapsedMs,
          remainingMs,
          nextPollMs,
          speakerResponseText,
          ttsMatchedLine
        });
        timeoutId = setTimeout(handleTimeout, nextPollMs);
        return;
      }

      finish({
        success: false,
        eventTime: null,
        status: 'timeout',
        vadStarted,
        vadEnded: Boolean(vadEndTime),
        vadStartTime,
        vadEndTime,
        vadStartLine,
        vadEndLine,
        speakerResponseText,
        ttsMatchedLine,
        message: vadStarted
          ? 'VAD start detected but VAD stop not detected before max wait timeout'
          : 'VAD start marker not detected before timeout'
      });
    };

    timeoutId = setTimeout(handleTimeout, safeTimeoutMs);

    const handleLogcatData = (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        sampleLines.push(line);
        if (sampleLines.length > 200) sampleLines.shift();
        appendBridgeLog('response.logcat.line', { detectId, line });

        const ttsMatcher = ttsMatchers.find((item) => item.test(line));
        if (ttsMatcher) {
          const extractedText = extractTtsTextFromLine(line);
          if (extractedText) speakerResponseText = extractedText;
          ttsMatchedLine = line;
          appendBridgeLog('response.tts.detected', {
            detectId,
            matchedKeyword: ttsMatcher.label,
            speakerResponseText,
            matchedLine: line
          });
        }

        if (!vadStarted) {
          const startMatcher = startMatchers.find((item) => item.test(line));
          if (startMatcher) {
            vadStarted = true;
            vadStartTime = Date.now();
            vadStartLine = line;
            appendBridgeLog('response.vad.start.detected', {
              detectId,
              matchedKeyword: startMatcher.label,
              matchedLine: line
            });
          }
        }

        if (!vadStarted) continue;

        const endMatcher = endMatchers.find((item) => item.test(line));
        if (endMatcher) {
          vadEndTime = Date.now();
          vadEndLine = line;
          finish({
            success: Boolean(speakerResponseText),
            eventTime: Date.now(),
            status: speakerResponseText ? 'completed' : 'tts_text_missing',
            vadStarted: true,
            vadEnded: true,
            vadStartTime,
            vadEndTime,
            vadStartLine,
            vadEndLine,
            speakerResponseText,
            ttsMatchedLine,
            message: speakerResponseText ? '' : 'VAD start/stop detected but TTS response text extraction failed'
          });
          break;
        }
      }
    };

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      appendBridgeLog('response.logcat.clear.stderr', { detectId, text: chunk.toString() });
    });

    child.on('error', (err) => {
      appendBridgeLog('response.logcat.clear.error', { detectId, message: err?.message || String(err) });
      reject(err);
    });

    child.on('close', (code) => {
      if (done) return;
      if (code !== 0) {
        clearTimeout(timeoutId);
        appendBridgeLog('response.logcat.clear.failed', { detectId, code, stderr });
        reject(new Error(stderr.trim() || `adb logcat exited with ${code}`));
        return;
      }

      appendBridgeLog('response.logcat.realtime.start', { detectId });
      logcatChild = spawn('adb', buildAdbArgs(deviceId, ['logcat', '-v', 'threadtime']), {
        windowsHide: true
      });
      logcatChild.stdout.on('data', handleLogcatData);
      logcatChild.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        appendBridgeLog('response.logcat.stderr', { detectId, text: chunk.toString() });
      });
      logcatChild.on('error', (err) => {
        appendBridgeLog('response.logcat.error', { detectId, message: err?.message || String(err) });
        reject(err);
      });
      logcatChild.on('close', (logcatCode) => {
        if (!done && logcatCode !== 0) {
          clearTimeout(timeoutId);
          appendBridgeLog('response.logcat.failed', { detectId, code: logcatCode, stderr });
          reject(new Error(stderr.trim() || `adb logcat exited with ${logcatCode}`));
        }
      });
    });
  });
}

function detectWakeup({ deviceId, timeoutMs, keywords }) {
  const safeTimeoutMs = Math.max(1000, Number(timeoutMs) || 5000);
  if (arguments[0] && resolveLogSource(arguments[0]) === LOG_SOURCE_SERIAL) {
    const body = arguments[0];
    const safeKeywords = Array.isArray(keywords) && keywords.length
      ? keywords
      : (isAiToy(body) ? AI_TOY_WAKE_KEYWORDS : DEFAULT_KEYWORDS);
    const listeningMatchers = createKeywordMatchers(isAiToy(body) ? AI_TOY_LISTENING_KEYWORDS : []);
    let wakeDetected = false;
    let wakeMatchedKeyword = '';
    let wakeMatchedLine = '';

    return detectFromSerial({
      serialPort: normalizeSerialPath(body),
      baudrate: body.baudrate,
      timeoutMs: safeTimeoutMs,
      matchers: [
        ...createKeywordMatchers(safeKeywords),
        ...listeningMatchers
      ],
      failureMatchers: createKeywordMatchers(isAiToy(body) ? AI_TOY_FAILURE_KEYWORDS : []),
      buildSuccess: (line, matcher) => {
        const isWake = createKeywordMatchers(safeKeywords).some((item) => item.label === matcher.label && item.test(line));
        const isListening = listeningMatchers.some((item) => item.label === matcher.label && item.test(line));
        if (isWake) {
          wakeDetected = true;
          wakeMatchedKeyword = matcher.label;
          wakeMatchedLine = line;
        }
        const success = isAiToy(body) ? Boolean(wakeDetected && isListening) : Boolean(isWake);
        return {
          success,
          keepWaiting: !success,
          matchedKeyword: wakeMatchedKeyword || matcher.label,
          matchedLine: wakeMatchedLine || line,
          message: success ? '' : 'Serial wake marker detected but listening marker is not finished'
        };
      },
      buildFailure: (line, matcher) => ({
        success: false,
        status: 'failed_marker',
        matchedKeyword: matcher.label,
        matchedLine: line,
        message: 'Serial wake failure marker detected'
      }),
      timeoutMessage: 'Serial wake marker not detected before timeout'
    });
  }

  const keywordMatchers = createKeywordMatchers(keywords);
  const detectId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  appendBridgeLog('wakeup.detect.start', {
    detectId,
    deviceId: deviceId || '<default>',
    timeoutMs: safeTimeoutMs,
    keywords: keywordMatchers.map((item) => item.label)
  });

  return new Promise((resolve, reject) => {
    const child = spawn('adb', buildAdbArgs(deviceId, ['logcat', '-c']), { windowsHide: true });
    let done = false;
    let stderr = '';
    const sampleLines = [];
    let logcatChild = null;

    const finish = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      child.kill();
      if (logcatChild) logcatChild.kill();
      appendBridgeLog('wakeup.detect.finish', {
        detectId,
        success: Boolean(payload.success),
        matchedKeyword: payload.matchedKeyword || '',
        matchedLine: payload.matchedLine || '',
        sampleCount: sampleLines.length,
        lastSampleLines: sampleLines.slice(-5)
      });
      resolve({
        ...payload,
        sampleLines: sampleLines.slice(-30)
      });
    };

    const timeoutId = setTimeout(() => {
      finish({
        success: false,
        eventTime: null,
        matchedKeyword: '',
        matchedLine: '',
        message: 'WakeupSuccess not detected before timeout'
      });
    }, safeTimeoutMs);

    const handleLogcatData = (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        sampleLines.push(line);
        if (sampleLines.length > 200) sampleLines.shift();
        appendBridgeLog('wakeup.logcat.line', {
          detectId,
          line
        });

        const matcher = keywordMatchers.find((item) => item.test(line));
        if (matcher) {
          finish({
            success: true,
            eventTime: Date.now(),
            matchedKeyword: matcher.label,
            matchedLine: line
          });
          break;
        }
      }
    };

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      appendBridgeLog('wakeup.logcat.clear.stderr', {
        detectId,
        text: chunk.toString()
      });
    });

    child.on('error', (err) => {
      appendBridgeLog('wakeup.logcat.clear.error', {
        detectId,
        message: err?.message || String(err)
      });
      reject(err);
    });
    child.on('close', (code) => {
      if (done) return;
      if (code !== 0) {
        clearTimeout(timeoutId);
        appendBridgeLog('wakeup.logcat.clear.failed', {
          detectId,
          code,
          stderr
        });
        reject(new Error(stderr.trim() || `adb logcat exited with ${code}`));
        return;
      }

      appendBridgeLog('wakeup.logcat.realtime.start', {
        detectId
      });
      logcatChild = spawn('adb', buildAdbArgs(deviceId, ['logcat', '-v', 'threadtime']), {
        windowsHide: true
      });
      logcatChild.stdout.on('data', handleLogcatData);
      logcatChild.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        appendBridgeLog('wakeup.logcat.stderr', {
          detectId,
          text: chunk.toString()
        });
      });
      logcatChild.on('error', (err) => {
        appendBridgeLog('wakeup.logcat.error', {
          detectId,
          message: err?.message || String(err)
        });
        reject(err);
      });
      logcatChild.on('close', (logcatCode) => {
        if (!done && logcatCode !== 0) {
          clearTimeout(timeoutId);
          appendBridgeLog('wakeup.logcat.failed', {
            detectId,
            code: logcatCode,
            stderr
          });
          reject(new Error(stderr.trim() || `adb logcat exited with ${logcatCode}`));
        }
      });
    });
  });
}

async function rebootAndWait({ deviceId, recoveryTimeoutMs }) {
  const timeoutMs = Math.max(10000, Number(recoveryTimeoutMs) || 180000);
  const start = Date.now();
  appendBridgeLog('reboot.start', {
    deviceId: deviceId || '<default>',
    recoveryTimeoutMs: timeoutMs
  });

  const rebootResult = await runAdbSafe(deviceId, ['reboot'], 15000);
  appendBridgeLog('reboot.command.result', {
    ok: rebootResult.ok,
    stderr: rebootResult.stderr,
    error: rebootResult.error || ''
  });

  if (!rebootResult.ok && !/no devices|device .* not found|offline|closed/i.test(rebootResult.error || '')) {
    throw new Error(rebootResult.error || 'ADB reboot failed');
  }

  let recoveredDeviceId = '';
  try {
    recoveredDeviceId = await waitForAdbDevice(deviceId, timeoutMs);
  } catch (err) {
    appendBridgeLog('reboot.device.recovery.failed', {
      requestedDeviceId: deviceId || '<default>',
      message: err?.message || String(err)
    });
    return {
      success: false,
      bootCompleted: false,
      message: err?.message || 'Speaker ADB device recovery timeout',
      rebootCommandOk: rebootResult.ok,
      rebootCommandError: rebootResult.error || ''
    };
  }
  appendBridgeLog('reboot.device.recovered', {
    requestedDeviceId: deviceId || '<default>',
    recoveredDeviceId
  });

  while (Date.now() - start < timeoutMs) {
    const result = await runAdbSafe(recoveredDeviceId, ['shell', 'getprop', 'sys.boot_completed'], 10000);
    appendBridgeLog('reboot.boot_completed.poll', {
      recoveredDeviceId,
      ok: result.ok,
      stdout: result.stdout.trim(),
      error: result.error || ''
    });

    if (result.stdout.trim() === '1') {
      return {
        success: true,
        bootCompleted: true,
        message: 'sys.boot_completed=1',
        recoveredDeviceId,
        rebootCommandOk: rebootResult.ok,
        rebootCommandError: rebootResult.error || ''
      };
    }
    await sleep(2000);
  }

  return {
    success: false,
    bootCompleted: false,
    message: 'Speaker boot_completed recovery timeout',
    recoveredDeviceId,
    rebootCommandOk: rebootResult.ok,
    rebootCommandError: rebootResult.error || ''
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { success: false, message: 'method not allowed' });
    return;
  }

  try {
    const body = await readBody(req);

    if (req.url === '/api/adb/wakeup/detect') {
      sendJson(res, 200, await detectWakeup(body));
      return;
    }

    if (req.url === '/api/adb/devices') {
      sendJson(res, 200, resolveLogSource(body) === LOG_SOURCE_SERIAL
        ? await listSerialPorts()
        : await listAdbDevices());
      return;
    }

    if (req.url === '/api/adb/health') {
      sendJson(res, 200, resolveLogSource(body) === LOG_SOURCE_SERIAL
        ? await getSerialHealth(body)
        : await getAdbHealth(body));
      return;
    }

    if (req.url === '/api/adb/recover') {
      sendJson(res, 200, await recoverLogLink(body));
      return;
    }

    if (req.url === '/api/adb/asr/detect') {
      sendJson(res, 200, await detectAsr(body));
      return;
    }

    if (req.url === '/api/adb/response/detect') {
      sendJson(res, 200, await detectSpeakerResponseLog(body));
      return;
    }

    if (req.url === '/api/adb/reboot-and-wait') {
      sendJson(res, 200, await rebootAndWait(body));
      return;
    }

    sendJson(res, 404, { success: false, message: 'not found' });
  } catch (err) {
    sendJson(res, 500, {
      success: false,
      message: err?.message || String(err)
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ADB bridge listening on http://${HOST}:${PORT}`);
});
