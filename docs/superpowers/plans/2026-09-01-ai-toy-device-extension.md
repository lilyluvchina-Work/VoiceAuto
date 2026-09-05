# AI Toy Device Extension Implementation Plan

> 历史设计/实施计划：后续实现已演进为持续会话和启动确认后的恢复。当前操作与限制以[设备测试流程说明](../../product/device-test-workflows.md)为准，本文代码示例和待办状态保留用于追溯。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `AI玩具` as a first-class VoiceAuto device extension with both ADB logcat and USB serial log input.

**Architecture:** Introduce a small device-profile module for event patterns and labels, then thread the selected profile and log source through the existing test runner and bridge API. Keep existing Speaker-compatible result fields while adding profile-aware labels and serial-backed bridge endpoints.

**Tech Stack:** React 18, Vite, Node.js ESM frontend modules, CommonJS bridge script, node:test-style `.mjs` assertions, optional `serialport` package for USB serial mode.

**Spec:** `docs/superpowers/specs/2026-09-01-ai-toy-device-extension-design.md`

## Global Constraints

- Device name must be exactly `AI玩具`.
- Keep `Speaker` as the default device.
- Support both `ADB logcat` and `USB串口` log ingestion.
- Do not port macOS `say` or `afplay`.
- Do not remove historical report fields such as `speakerWakeStatus`.
- Automated tests must not require real ADB devices or serial hardware.

---

### Task 1: Device Profiles

**Files:**
- Create: `src/config/deviceProfiles.js`
- Test: `tests/deviceProfiles.test.mjs`

**Interfaces:**
- Produces: `DEVICE_TYPES`, `LOG_SOURCES`, `DEVICE_PROFILES`, `getDeviceProfile(deviceType)`, `getDefaultDeviceOptions()`, `resolveDeviceRuntimeOptions(testOptions)`
- Consumes: no new project code

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';

import {
  DEVICE_TYPES,
  LOG_SOURCES,
  getDeviceProfile,
  resolveDeviceRuntimeOptions,
} from '../src/config/deviceProfiles.js';

const speaker = getDeviceProfile();
assert.equal(speaker.type, DEVICE_TYPES.SPEAKER);
assert.equal(speaker.label, 'Speaker');

const toy = getDeviceProfile(DEVICE_TYPES.AI_TOY);
assert.equal(toy.label, 'AI玩具');
assert.match(toy.wake.keywords.join('\n'), /VOICE WAKE WORD HIT ACCEPTED/);
assert.match(toy.input.endKeywords.join('\n'), /Cedar: Input Text/);
assert.match(toy.input.extractPatterns.join('\n'), /Cedar: Input Text/);
assert.match(toy.response.firstAudioKeywords.join('\n'), /Audio latency first_downlink_audio/);
assert.match(toy.response.playbackDoneKeywords.join('\n'), /TTS playback done/);
assert.match(toy.failure.keywords.join('\n'), /WS response timeout/);
assert.match(toy.failure.keywords.join('\n'), /Guru Meditation/);

const runtime = resolveDeviceRuntimeOptions({
  device: {
    type: DEVICE_TYPES.AI_TOY,
    logSource: LOG_SOURCES.SERIAL,
    serialPort: 'COM7',
    baudrate: 115200,
  },
});
assert.equal(runtime.profile.label, 'AI玩具');
assert.equal(runtime.logSource, LOG_SOURCES.SERIAL);
assert.equal(runtime.serialPort, 'COM7');
assert.equal(runtime.baudrate, 115200);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/deviceProfiles.test.mjs`

Expected: FAIL with module-not-found for `src/config/deviceProfiles.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/config/deviceProfiles.js` with:

```js
export const DEVICE_TYPES = {
  SPEAKER: 'speaker',
  AI_TOY: 'ai_toy',
};

export const LOG_SOURCES = {
  ADB: 'adb',
  SERIAL: 'serial',
};

export const DEVICE_PROFILES = {
  [DEVICE_TYPES.SPEAKER]: {
    type: DEVICE_TYPES.SPEAKER,
    label: 'Speaker',
    wake: {
      keywords: ['WakeupSuccess', 'WAKEUP_SUCCESS', 'wakeup success', 'onCedarWakeup', 'GlobalControl: onCedarWakeup'],
    },
    input: {
      startKeywords: [
        '/ASR_STATUS.*PARTIAL/i',
        '/asr_status[^\\n]*(partial)/i',
        '/"asr_status"\\s*:\\s*"partial"/i',
        '/onHandlerCloudMsg==>GoogleLiveResponseBean.*messageType=asr_status/i',
      ],
      endKeywords: [
        '/ASR_STATUS.*FINAL/i',
        '/asr_status[^\\n]*(final)/i',
        '/"asr_status"\\s*:\\s*"final"/i',
        '/onHandlerCloudMsg==>GoogleLiveResponseBean.*messageType=input_text/i',
        'ASR result',
        'asrText',
        'recognizedText',
        'finalResult',
      ],
      failureKeywords: [
        '/ASR_STATUS.*UNIDENTIFIED/i',
        '/asr_status[^\\n]*(unidentified)/i',
        '/"asr_status"\\s*:\\s*"unidentified"/i',
      ],
      extractPatterns: [
        '/message=Message\\(content=([\\s\\S]*?),\\s*messageType=(?:asr_status|input_text)\\)/i',
        '/(?:ASR result|asrText|recognizedText|finalResult)\\s*[:=]\\s*["\\']?([^"\\',，。；;\\]\\}]+)/i',
      ],
    },
    response: {
      vadStartKeywords: ['/VAD_STATUS.*START/i', '/vad_status[^\\n]*(start)/i', '/"vad_status"\\s*:\\s*"start"/i'],
      vadEndKeywords: ['/VAD_STATUS.*STOP/i', '/vad_status[^\\n]*(stop)/i', '/"vad_status"\\s*:\\s*"stop"/i'],
      ttsKeywords: ['TTS_STATUS', 'tts_status'],
      firstAudioKeywords: [],
      playbackDoneKeywords: [],
      listeningKeywords: [],
    },
    failure: {
      keywords: [],
    },
    defaults: {
      wakeDetectionTimeoutMs: 5000,
      asrDetectionTimeoutMs: 8000,
      responseWindowMs: 15000,
      responseMaxWaitMs: 120000,
      baudrate: 115200,
    },
  },
  [DEVICE_TYPES.AI_TOY]: {
    type: DEVICE_TYPES.AI_TOY,
    label: 'AI玩具',
    wake: {
      keywords: ['VOICE WAKE WORD HIT ACCEPTED'],
      listeningKeywords: ['Cedar: Start listening'],
    },
    input: {
      startKeywords: ['Cedar: Input Text'],
      endKeywords: ['Cedar: Input Text'],
      failureKeywords: [
        'Application: ║ New State: idle',
        'Application: New State: idle',
        'WS response timeout (no_tts_start)',
        'Rebooting.',
        'Guru Meditation',
        'task_wdt',
        'I2C transaction timeout',
      ],
      extractPatterns: ['/Cedar: Input Text:\\s*(.*)$/i'],
    },
    response: {
      vadStartKeywords: [],
      vadEndKeywords: [],
      ttsKeywords: [],
      firstAudioKeywords: ['Audio latency first_downlink_audio'],
      playbackDoneKeywords: ['TTS playback done'],
      listeningKeywords: ['Cedar: Start listening'],
    },
    failure: {
      keywords: [
        'Application: ║ New State: idle',
        'Application: New State: idle',
        'WS response timeout (no_tts_start)',
        'Rebooting.',
        'Guru Meditation',
        'task_wdt',
        'I2C transaction timeout',
      ],
    },
    defaults: {
      wakeDetectionTimeoutMs: 10000,
      asrDetectionTimeoutMs: 14000,
      responseWindowMs: 18000,
      responseMaxWaitMs: 35000,
      baudrate: 115200,
    },
  },
};

export function getDeviceProfile(deviceType = DEVICE_TYPES.SPEAKER) {
  return DEVICE_PROFILES[deviceType] || DEVICE_PROFILES[DEVICE_TYPES.SPEAKER];
}

export function getDefaultDeviceOptions() {
  return {
    type: DEVICE_TYPES.SPEAKER,
    logSource: LOG_SOURCES.ADB,
    serialPort: '',
    baudrate: 115200,
  };
}

export function resolveDeviceRuntimeOptions(testOptions = {}) {
  const device = {
    ...getDefaultDeviceOptions(),
    ...(testOptions.device || {}),
  };
  const profile = getDeviceProfile(device.type);
  return {
    deviceType: profile.type,
    profile,
    logSource: device.logSource === LOG_SOURCES.SERIAL ? LOG_SOURCES.SERIAL : LOG_SOURCES.ADB,
    serialPort: String(device.serialPort || '').trim(),
    baudrate: Number(device.baudrate) || profile.defaults.baudrate || 115200,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/deviceProfiles.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/deviceProfiles.js tests/deviceProfiles.test.mjs
git commit -m "feat: add device profiles for AI toy"
```

### Task 2: Multi-Turn Retry Policy

**Files:**
- Modify: `src/utils/multiTurnDialogue.js`
- Test: `tests/multiTurnDialogue.test.mjs`

**Interfaces:**
- Consumes: `DEVICE_TYPES` from `src/config/deviceProfiles.js`
- Produces: `buildRetryQueueItem(queueItem, failureResult)`

- [ ] **Step 1: Write the failing test**

Append to `tests/multiTurnDialogue.test.mjs`:

```js
import { DEVICE_TYPES } from '../src/config/deviceProfiles.js';
import { buildRetryQueueItem } from '../src/utils/multiTurnDialogue.js';

const aiToyQueue = buildMultiTurnQueue([
  {
    id: 'toy-turn-1',
    text: '客厅有哪些设备？',
    audioStatus: 'generated',
    multiTurnCaseId: 'toy-dialogue',
    turnIndex: 1,
    turnTotal: 4,
    deviceType: DEVICE_TYPES.AI_TOY,
  },
  {
    id: 'toy-turn-2',
    text: '客厅灯现在是什么状态？',
    audioStatus: 'generated',
    multiTurnCaseId: 'toy-dialogue',
    turnIndex: 2,
    turnTotal: 4,
    deviceType: DEVICE_TYPES.AI_TOY,
  },
], 1);

assert.equal(aiToyQueue[0].needWakeup, true);
assert.equal(aiToyQueue[1].needWakeup, false);

const retry = buildRetryQueueItem(aiToyQueue[1], {
  failureEvent: 'idle',
  failureLog: 'Application: New State: idle',
});
assert.equal(retry.audio.id, aiToyQueue[1].audio.id);
assert.equal(retry.needWakeup, true);
assert.equal(retry.retryOfDialogueTurnKey, 'toy-dialogue#2');
assert.equal(retry.previousFailureEvent, 'idle');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/multiTurnDialogue.test.mjs`

Expected: FAIL because `buildRetryQueueItem` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/utils/multiTurnDialogue.js`, export:

```js
export function buildRetryQueueItem(queueItem = {}, failureResult = {}) {
  return {
    ...queueItem,
    needWakeup: true,
    retryOfDialogueTurnKey: queueItem.dialogueTurnKey || '',
    previousFailureEvent: failureResult.failureEvent || failureResult.result || '',
    previousFailureLog: failureResult.failureLog || failureResult.message || '',
    retryCount: Number(queueItem.retryCount || 0) + 1,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/multiTurnDialogue.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/multiTurnDialogue.js tests/multiTurnDialogue.test.mjs
git commit -m "feat: add retry queue item policy"
```

### Task 3: Frontend Service Payloads

**Files:**
- Modify: `src/services/adbWakeService.js`
- Test: `tests/adbWakeServiceDevicePayload.test.mjs`

**Interfaces:**
- Consumes: runtime fields `{ deviceType, logSource, serialPort, baudrate }`
- Produces: bridge payloads containing these fields for wake, ASR, response, health, recovery, and list requests

- [ ] **Step 1: Write the failing test**

Create `tests/adbWakeServiceDevicePayload.test.mjs`:

```js
import assert from 'node:assert/strict';

import {
  detectAsr,
  detectSpeakerResponseLog,
  detectWakeup,
  listDevices,
} from '../src/services/adbWakeService.js';
import { DEVICE_TYPES, LOG_SOURCES } from '../src/config/deviceProfiles.js';

const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, body: JSON.parse(options.body) });
  return {
    ok: true,
    text: async () => JSON.stringify({ success: true, devices: [] }),
  };
};

const runtime = {
  bridgeUrl: 'http://bridge.local',
  deviceType: DEVICE_TYPES.AI_TOY,
  logSource: LOG_SOURCES.SERIAL,
  serialPort: 'COM7',
  baudrate: 115200,
};

await detectWakeup({ ...runtime, timeoutMs: 1000, keywords: ['VOICE WAKE WORD HIT ACCEPTED'] });
await detectAsr({ ...runtime, timeoutMs: 1000, startKeywords: ['Cedar: Input Text'], endKeywords: ['Cedar: Input Text'] });
await detectSpeakerResponseLog({ ...runtime, timeoutMs: 1000, maxWaitMs: 2000 });
await listDevices(runtime);

assert.equal(calls[0].body.deviceType, DEVICE_TYPES.AI_TOY);
assert.equal(calls[0].body.logSource, LOG_SOURCES.SERIAL);
assert.equal(calls[0].body.serialPort, 'COM7');
assert.equal(calls[0].body.baudrate, 115200);
assert.equal(calls[1].body.deviceType, DEVICE_TYPES.AI_TOY);
assert.equal(calls[2].body.logSource, LOG_SOURCES.SERIAL);
assert.equal(calls[3].body.logSource, LOG_SOURCES.SERIAL);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/adbWakeServiceDevicePayload.test.mjs`

Expected: FAIL because payloads do not include serial/profile fields.

- [ ] **Step 3: Write minimal implementation**

Add a helper in `src/services/adbWakeService.js`:

```js
function buildDevicePayload(options = {}) {
  return {
    deviceType: options.deviceType || '',
    logSource: options.logSource || '',
    serialPort: options.serialPort || '',
    baudrate: Number(options.baudrate) || undefined,
  };
}
```

Spread `buildDevicePayload(argumentsObject)` into every bridge request body in `detectWakeup`, `listDevices`, `checkListenerHealth`, `recoverListenerLink`, `rebootSpeaker`, `detectAsr`, and `detectSpeakerResponseLog`. Add those options to each function parameter destructuring.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/adbWakeServiceDevicePayload.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/adbWakeService.js tests/adbWakeServiceDevicePayload.test.mjs
git commit -m "feat: pass device log source payloads"
```

### Task 4: Bridge Profile and Serial Support

**Files:**
- Modify: `scripts/adbBridge.cjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/adbBridgeSource.test.mjs`

**Interfaces:**
- Consumes: request fields `deviceType`, `logSource`, `serialPort`, `baudrate`, keyword arrays
- Produces: `/api/adb/devices` returns serial metadata in serial mode; detection functions can use serial mode when `serialport` is installed

- [ ] **Step 1: Write the failing test**

Create `tests/adbBridgeSource.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/adbBridge.cjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

assert.match(source, /LOG_SOURCE_SERIAL/);
assert.match(source, /loadSerialPort/);
assert.match(source, /listSerialPorts/);
assert.match(source, /detectFromSerial/);
assert.match(source, /VOICE WAKE WORD HIT ACCEPTED/);
assert.match(source, /Cedar: Input Text/);
assert.match(source, /Audio latency first_downlink_audio/);
assert.match(source, /TTS playback done/);
assert.match(source, /WS response timeout/);
assert.equal(pkg.dependencies.serialport, '^12.0.0');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/adbBridgeSource.test.mjs`

Expected: FAIL because serial bridge support is absent.

- [ ] **Step 3: Add dependency**

Run: `npm install serialport@^12.0.0`

Expected: `package.json` and `package-lock.json` include `serialport`.

- [ ] **Step 4: Write minimal implementation**

Modify `scripts/adbBridge.cjs`:

```js
const LOG_SOURCE_ADB = 'adb';
const LOG_SOURCE_SERIAL = 'serial';

function resolveLogSource(body = {}) {
  return body.logSource === LOG_SOURCE_SERIAL ? LOG_SOURCE_SERIAL : LOG_SOURCE_ADB;
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
  return {
    success: true,
    devices: ports.map((port) => ({
      id: port.path,
      sn: port.serialNumber || port.path,
      state: 'device',
      model: port.manufacturer || '',
      product: port.friendlyName || port.pnpId || '',
      label: [port.path, port.manufacturer || port.friendlyName || port.pnpId].filter(Boolean).join(' · '),
      raw: JSON.stringify(port),
    })),
    message: '',
  };
}
```

Add `detectFromSerial({ serialPort, baudrate, timeoutMs, matchers, failureMatchers, extractText })` that opens `new SerialPort({ path: serialPort, baudRate: Number(baudrate) || 115200 })`, buffers UTF-8 lines, checks matchers/failures, keeps the last 30 sample lines, resolves on success/failure/timeout, and closes the port.

Route serial mode inside `listAdbDevices`, `getAdbHealth`, `detectWakeup`, `detectAsr`, and `detectSpeakerResponseLog` by checking `resolveLogSource(body)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/adbBridgeSource.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/adbBridge.cjs package.json package-lock.json tests/adbBridgeSource.test.mjs
git commit -m "feat: add serial log source bridge"
```

### Task 5: Store and Runner Integration

**Files:**
- Modify: `src/stores/testStore.jsx`
- Modify: `src/hooks/useTestRunner.js`
- Test: `tests/testStoreDeviceOptions.test.mjs`
- Test: `tests/useTestRunnerSource.test.mjs`

**Interfaces:**
- Consumes: `resolveDeviceRuntimeOptions(testOptions)` and profile event arrays
- Produces: persisted `testOptions.device`; runner sends profile/log-source fields to bridge calls and applies AI玩具 retry policy

- [ ] **Step 1: Write the failing store test**

Create `tests/testStoreDeviceOptions.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/stores/testStore.jsx', import.meta.url), 'utf8');

assert.match(source, /testOptions:\s*\{[\s\S]*device:\s*\{/);
assert.match(source, /SET_DEVICE_OPTIONS/);
assert.match(source, /setDeviceOptions/);
assert.match(source, /AI_TOY|ai_toy/);
assert.match(source, /serialPort/);
assert.match(source, /baudrate/);
```

- [ ] **Step 2: Write the failing runner test**

Append to `tests/useTestRunnerSource.test.mjs`:

```js
assert.match(source, /resolveDeviceRuntimeOptions/);
assert.match(source, /deviceRuntime\.deviceType/);
assert.match(source, /deviceRuntime\.logSource/);
assert.match(source, /deviceRuntime\.serialPort/);
assert.match(source, /deviceRuntime\.baudrate/);
assert.match(source, /buildRetryQueueItem/);
assert.match(source, /previousFailureEvent/);
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node tests/testStoreDeviceOptions.test.mjs
node tests/useTestRunnerSource.test.mjs
```

Expected: FAIL because store and runner do not yet include device runtime options.

- [ ] **Step 4: Implement store changes**

In `src/stores/testStore.jsx`:

- Import `DEVICE_TYPES`, `LOG_SOURCES`, and `getDefaultDeviceOptions`.
- Add `device: getDefaultDeviceOptions()` under `testOptions`.
- Add action type `SET_DEVICE_OPTIONS`.
- Add reducer case that shallow-merges `state.testOptions.device`.
- Persist and hydrate `device`, normalizing missing values to default `{ type: DEVICE_TYPES.SPEAKER, logSource: LOG_SOURCES.ADB, serialPort: '', baudrate: 115200 }`.
- Add action creator `setDeviceOptions`.

- [ ] **Step 5: Implement runner changes**

In `src/hooks/useTestRunner.js`:

- Import `resolveDeviceRuntimeOptions` and `buildRetryQueueItem`.
- Resolve `const deviceRuntime = resolveDeviceRuntimeOptions(testOptions);` inside `runTest`.
- Replace bridge calls with payload fields from `deviceRuntime`.
- Use profile wake keywords when autonomous wake keywords are empty.
- Use profile ASR start/end/failure patterns when user config is empty.
- Use profile response markers for AI玩具.
- When a failure result contains AI玩具 profile failure events such as `idle`, `tts_timeout`, `reboot`, or `serial_error`, retry the same cursor by replacing the current queue item with `buildRetryQueueItem(item, failureResult)` and requiring wakeup before continuing.

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
node tests/testStoreDeviceOptions.test.mjs
node tests/useTestRunnerSource.test.mjs
node tests/multiTurnDialogue.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/stores/testStore.jsx src/hooks/useTestRunner.js tests/testStoreDeviceOptions.test.mjs tests/useTestRunnerSource.test.mjs
git commit -m "feat: wire device runtime into test runner"
```

### Task 6: Playback Console UI

**Files:**
- Modify: `src/components/PlaybackConsole.jsx`
- Test: `tests/audioMenuAndVoiceLogicLayout.test.mjs`

**Interfaces:**
- Consumes: `state.testOptions.device` and `actions.setDeviceOptions`
- Produces: user controls for `AI玩具`, `ADB logcat`, `USB串口`, serial port, and baudrate

- [ ] **Step 1: Write the failing test**

Append to `tests/audioMenuAndVoiceLogicLayout.test.mjs`:

```js
assert.match(playbackSource, /AI玩具/);
assert.match(playbackSource, /USB串口/);
assert.match(playbackSource, /ADB logcat/);
assert.match(playbackSource, /setDeviceOptions/);
assert.match(playbackSource, /serialPort/);
assert.match(playbackSource, /baudrate/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/audioMenuAndVoiceLogicLayout.test.mjs`

Expected: FAIL because the UI has no AI玩具 or USB串口 controls.

- [ ] **Step 3: Implement UI**

In `src/components/PlaybackConsole.jsx`:

- Import `DEVICE_TYPES`, `LOG_SOURCES`, and `resolveDeviceRuntimeOptions`.
- Add `const deviceOptions = state.testOptions?.device || {};`.
- Add `const deviceRuntime = resolveDeviceRuntimeOptions(state.testOptions || {});`.
- Add `handleDeviceOptionsChange = (patch) => dispatch(actions.setDeviceOptions(patch));`.
- Add a compact settings block near listener health with:
  - device type select: `Speaker`, `AI玩具`
  - log source select: `ADB logcat`, `USB串口`
  - serial port text input shown when log source is `USB串口`
  - baudrate numeric input shown when log source is `USB串口`
- Replace status text that describes the selected target device with `deviceRuntime.profile.label`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/audioMenuAndVoiceLogicLayout.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlaybackConsole.jsx tests/audioMenuAndVoiceLogicLayout.test.mjs
git commit -m "feat: add AI toy device controls"
```

### Task 7: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Optional Modify: `docs/product/product-use-guide.md`

**Interfaces:**
- Consumes: completed UI/backend behavior
- Produces: user-facing instructions for AI玩具, ADB logcat, and USB串口

- [ ] **Step 1: Update docs**

Add a section to `README.md`:

```md
### AI玩具设备拓展

在「语音控制台」中选择设备类型 `AI玩具`。日志来源支持两种：

- `ADB logcat`：沿用当前 ADB Bridge，适合 Android/Speaker 链路。
- `USB串口`：填写串口号和波特率，按 AI玩具固件日志识别唤醒、ASR、首包音频、TTS 播放完成和 idle/重启失败。

AI玩具连续对话默认只在每个 dialogue 第一轮唤醒；后续轮次复用会话。遇到 idle、TTS 超时、设备重启或串口异常时，系统会记录失败并重新唤醒后重试当前问题。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
node tests/deviceProfiles.test.mjs
node tests/multiTurnDialogue.test.mjs
node tests/adbWakeServiceDevicePayload.test.mjs
node tests/adbBridgeSource.test.mjs
node tests/testStoreDeviceOptions.test.mjs
node tests/useTestRunnerSource.test.mjs
node tests/audioMenuAndVoiceLogicLayout.test.mjs
```

Expected: all PASS.

- [ ] **Step 3: Run project build**

Run: `npm run build`

Expected: Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/product/product-use-guide.md
git commit -m "docs: document AI toy device extension"
```

## Self-Review

- Spec coverage: device name, ADB logcat, USB串口, AI玩具 patterns, retry policy, UI controls, backend bridge, and tests are covered by Tasks 1-7.
- Placeholder scan: no implementation step relies on unnamed functions or future work.
- Type consistency: `deviceType`, `logSource`, `serialPort`, and `baudrate` are introduced in Task 1 and reused consistently in Tasks 3-6.
