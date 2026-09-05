import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const playbackSource = readFileSync(new URL('../src/components/PlaybackConsole.jsx', import.meta.url), 'utf8');
const readmeSource = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const legacyWakeWordConfigUrl = new URL('../src/components/WakeWordConfig.jsx', import.meta.url);

assert.match(appSource, /audio:\s*'audio'/);
assert.match(
  appSource,
  /\{ key: MODES\.cases,[\s\S]*?label: '测试用例管理' \},\s*\{ key: MODES\.audio,[\s\S]*?label: '测试音频' \},\s*\{ key: MODES\.voice,[\s\S]*?label: '语音控制' \}/
);
assert.match(appSource, /activeMode === MODES\.audio/);

assert.match(playbackSource, /Speaker 响应采集/);
assert.match(playbackSource, /方案1：沿用当前 Speaker 响应采集逻辑/);
assert.match(playbackSource, /方案2：Langfuse response_complete 确认后进入下一轮/);
assert.match(playbackSource, /未命中会标记本轮失败，并继续进入下一轮唤醒/);
assert.match(playbackSource, /实时轮询 Langfuse 日志/);
assert.match(playbackSource, /AI玩具/);
assert.match(playbackSource, /USB串口/);
assert.match(playbackSource, /ADB logcat/);
assert.match(playbackSource, /setDeviceOptions/);
assert.match(playbackSource, /serialPort/);
assert.match(playbackSource, /baudrate/);
assert.match(playbackSource, /selectSerialPortCandidate/);
assert.match(playbackSource, /已自动填充/);
assert.match(playbackSource, /formatUsbDiagnostics/);
assert.match(playbackSource, /usbDiagnostics/);
assert.match(playbackSource, /系统已识别到 USB 异常设备/);
assert.match(playbackSource, /serial-port-candidates/);
assert.match(playbackSource, /handleDeviceTypeChange/);
assert.match(playbackSource, /speakerContinuousDialogue/);
assert.match(playbackSource, /Speaker 连续对话/);
assert.match(playbackSource, /wakeIntervalDelayUsed/);
assert.match(playbackSource, /wakeIntervalDelayUsed[\s\S]*唤醒间延迟/);
assert.match(playbackSource, /wakeIntervalDelayUsed[\s\S]*等待 \{wakeWord\.wakeIntervalDelay\}ms/);
assert.match(playbackSource, /DEVICE_TYPES\.AI_TOY[\s\S]*LOG_SOURCES\.SERIAL/);
assert.equal(existsSync(legacyWakeWordConfigUrl), false);
assert.doesNotMatch(readmeSource, /WakeWordConfig\.jsx/);
assert.match(readmeSource, /唤醒间延迟仅在固定节奏重新唤醒时显示并生效/);
assert.doesNotMatch(playbackSource, /三种语音控制方式/);
assert.doesNotMatch(playbackSource, /固定节奏控制/);
assert.doesNotMatch(playbackSource, /输入识别控制/);
assert.doesNotMatch(playbackSource, /完整闭环控制/);
assert.doesNotMatch(playbackSource, /选择此方式/);
assert.doesNotMatch(playbackSource, /applyVoiceControlMode/);
