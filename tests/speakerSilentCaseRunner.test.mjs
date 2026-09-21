import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ordering from '../src/utils/testCaseOrdering.js';
import { buildDeviceExecutionQueue } from '../src/utils/deviceExecutionQueue.js';
import * as dialogue from '../src/utils/multiTurnDialogue.js';
import { shouldExpectVoiceResponse } from '../src/modules/tapd/utils/tapdParser.js';
import { waitForLangfuseResponseComplete } from '../src/utils/langfuseResponseGate.js';
import { isGeneratedTestAudio } from '../src/utils/testAudioStatus.js';
import { DEVICE_TYPES, LOG_SOURCES } from '../src/config/deviceProfiles.js';

// Run the real hook orchestration with React state and physical/network I/O replaced.
const source = readFileSync(new URL('../src/hooks/useTestRunner.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?\n/gm, '')
  .replace('export default function useTestRunner', 'function useTestRunner');
async function runScenario({ silent = true, continuous = true, langfuse = false, marker = true, stopRecord = false } = {}) {
const reports = [];
const plays = [];
let wakeCount = 0;
let langfuseFetches = 0;
let complete;
const done = new Promise(resolve => { complete = resolve; });
const state = {
  wakeWord: { text: '你好', wakeAfterDelay: 0 }, defaultVoiceConfig: {}, playback: { currentIndex: -1 },
  testAudios: [1, 2].map(id => ({ id: String(id), text: `创建场景${id}`, source: 'tapd',
    audioStatus: 'generated', audioUrl: 'test.wav', expectedResult: silent ? '无需语音回复，调用工具即可' : '回复创建成功' })),
  testOptions: { loopCount: 1, autonomousWake: { enabled: true }, autonomousInput: { enabled: true },
    autonomousResponse: { enabled: true, langfuseResponseGateEnabled: langfuse }, selectedLangfuseEnv: 'TEST' },
};
const dependencies = {
  ...ordering, ...dialogue, buildDeviceExecutionQueue, shouldExpectVoiceResponse,
  waitForLangfuseResponseComplete, isGeneratedTestAudio, DEVICE_TYPES, LOG_SOURCES,
  useState: value => [value, () => {}], useRef: current => ({ current }), useCallback: callback => callback,
  useTest: () => ({ state, dispatch: action => {
    if (action.type === 'addReportCase') reports.push(action.payload);
    if (action.type === 'completeReport') complete();
  } }),
  actions: new Proxy({}, { get: (_, type) => payload => ({ type, payload }) }),
  resolveDeviceRuntimeOptions: () => ({ deviceType: DEVICE_TYPES.SPEAKER, speakerContinuousDialogue: continuous,
    profile: { defaults: {}, wake: {}, input: {}, response: {} } }),
  ttsService: { speak: async () => { wakeCount++; }, stopAudio() {} }, notifyDingTalk: async () => {},
  playAudioItem: async (audio, tts, config, options) => { plays.push(audio.text); options.onStart(); },
  adbWakeService: { detectWakeup: async () => ({ success: true }),
    detectAsr: async () => ({ success: true, actualAsrText: state.testAudios[plays.length]?.text || plays.at(-1) }),
    detectSpeakerResponseLog: async () => {
      if (!marker) return { success: false, status: 'timeout' };
      return { success: true, status: 'playback_done', vadEnded: true, vadEndLine: `D SpeechService: onLiveTtsEnd==>${stopRecord}` };
    } },
  responseMonitorService: { detectSpeakerResponse: async () => {
    assert.equal(silent, false, 'Silent case must not wait for TTS');
    return { success: true };
  } },
  fetchTraces: async () => { langfuseFetches++; return [{ id: 'current', input: { content: plays.at(-1) } }]; },
  fetchObservations: async () => [{ id: 'tool', traceId: 'current', name: silent ? '[output_tool]' : '[response_complete]', output: { content: '创建成功' } }],
  getDefaultLangfuseEnvironmentKey: () => 'TEST',
  planSpeakerRecovery: () => { throw new Error('Silent success must not re-wake or retry'); },
  runAiToyTest: () => { throw new Error('Unexpected device'); },
  window: { dispatchEvent() {} }, CustomEvent: class {},
  console: { log() {}, error: error => { throw error; } }, alert: message => { throw new Error(message); },
  setTimeout: (callback, ms) => { if (ms < 10000) queueMicrotask(callback); return 0; }, clearTimeout() {},
};
const hook = new Function(...Object.keys(dependencies), `${source}\nreturn useTestRunner;`)(...Object.values(dependencies));
hook().start();
await Promise.race([done, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Speaker runner did not finish')), 2000); timer.unref(); })]);
assert.deepEqual(plays, ['创建场景1', '创建场景2']);
assert.equal(reports.length, 2);
if (marker) assert.ok(reports.every(row => row.success));
if (silent) assert.ok(reports.every(row => !row.toolCalled && row.expectsVoiceResponse === false));
assert.equal(wakeCount, marker && !stopRecord ? 1 : 2, 'Only a detected listening marker may reuse the session');
assert.equal(langfuseFetches, 0, 'Speaker execution must not wait for silent tool confirmation');
}

await runScenario();
await runScenario({ silent: false, continuous: false });
await runScenario({ silent: false, continuous: false, langfuse: true });
await runScenario({ silent: false, continuous: true });

await runScenario({ silent: false, continuous: true, marker: false });
await runScenario({ silent: true, continuous: true, marker: false });

await runScenario({ silent: true, continuous: false });

await runScenario({ silent: false, stopRecord: true });
await runScenario({ silent: true, stopRecord: true });
