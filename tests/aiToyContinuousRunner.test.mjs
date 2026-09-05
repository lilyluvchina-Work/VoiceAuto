import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRetryQueueItem } from '../src/utils/multiTurnDialogue.js';

// Only replace the React store boundary; execute the real runner.
const source = readFileSync(new URL('../src/runners/aiToyRunner.js', import.meta.url), 'utf8')
  .replace("import { actions } from '../stores/testStore';", 'const actions = new Proxy({}, { get: (_, type) => payload => ({ type, payload }) });');
const { runAiToyTest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

async function runScenario({ interrupt = '', delayed = false, stopWaiting = false, inputEnabled = true,
  pauseWaiting = false, missingInput = false, abortRead = false, interruptCount = 1,
  rebootFails = false, stopDuringReboot = false, trace = [], notifications = [], dingTalkEnabled = true, notifyFails = false } = {}) {
  const events = trace;
  const reports = [];
  const refs = Object.fromEntries(Object.entries({ isPlayingRef: true, isPausedRef: false, runIdRef: 1,
    firstTestAudioTimeRef: null, lastTestAudioTimeRef: null, wakeFailCountRef: 0,
    abortControllerRef: new AbortController() }).map(([key, current]) => [key, { current }]));
  let snapshot = { phase: 'unknown', ready: false, interrupted: false };
  let pending = [];
  let plays = 0;
  let waits = 0;
  const bridge = {
    openAiToySession: async ({ serialPort }) => { events.push('open'); events.push(`port:${serialPort}`); return { sessionId: 'session' }; },
    readAiToySession: async () => {
      if (abortRead && plays) { refs.isPlayingRef.current = false; throw new Error('request aborted'); }
      if (pending.length) snapshot = pending.shift();
      return snapshot;
    },
    armAiToySession: async ({ mode }) => {
      events.push(`arm:${mode}`);
      if (mode === 'turn' && !snapshot.ready) throw new Error('Not listening');
      snapshot = { ready: false, interrupted: false, phase: mode };
      return snapshot;
    },
    closeAiToySession: async () => events.push('close'),
    rebootSpeaker: async () => {
      events.push('reboot');
      if (stopDuringReboot) refs.isPlayingRef.current = false;
      return { success: !rebootFails, bootCompleted: !rebootFails, recoveredDeviceId: 'COM2', message: 'reset failed' };
    },
    detectWakeup: async () => ({ success: true }),
    detectAsr: async () => ({ success: true, actualAsrText: '测试' }),
    detectSpeakerResponseLog: async () => ({ success: true }),
  };
  await runAiToyTest({ runId: 1, reportRunId: 'run', state: {}, wakeWord: { text: '唤醒' },
    defaultVoiceConfig: {}, testOptions: { dingTalkEnabled, autonomousWake: { enabled: true },
      autonomousInput: { enabled: inputEnabled }, autonomousResponse: { enabled: true, responseMaxWaitMs: 1 } },
    deviceRuntime: { deviceType: 'ai_toy', profile: {}, serialPort: 'COM1' },
    queue: [1, 2].map(id => ({ audio: { id, text: '测试' }, needWakeup: true, listIndex: id - 1, round: 1, totalRounds: 1 })),
    dispatch: action => { if (action.type === 'addReportCase') reports.push(action.payload); },
    setCurrentAudioText: () => {}, refs,
    services: { adbWakeService: bridge, notifyDingTalk: async (type, context) => { notifications.push({ type, context }); if (notifyFails) throw new Error('notification unavailable'); },
      ttsService: { speak: async () => { events.push('wake'); snapshot = { phase: 'listening', ready: true }; } },
      playAudioItem: async (_, __, ___, options) => {
        events.push('play'); plays++; options.onStart();
        if (interrupt && plays <= interruptCount) {
          snapshot = { phase: 'interrupted', interrupted: true, interruptionReason: interrupt, ready: false };
        } else {
          snapshot = { phase: 'speaking', actualAsrText: '测试', inputDetected: true, ready: false };
          const complete = { phase: 'listening', actualAsrText: missingInput ? '' : '测试', inputDetected: !missingInput, ready: true,
            playbackDone: true, firstAudioDetected: true, listeningDetected: true };
          pending = delayed ? Array(5).fill(snapshot).concat(complete) : [complete];
        }
      } },
    helpers: { wait: async () => {
      events.push('wait'); waits++;
      if (stopWaiting) refs.isPlayingRef.current = false;
      if (pauseWaiting) refs.isPausedRef.current = waits < 3;
    },
      resolveAudioCaseId: audio => audio.id, textSimilarity: () => 1, buildRetryQueueItem,
      buildContinueDecision: () => ({}), resolveExpectsVoiceResponse: () => true,
      logWake: () => {}, logInput: () => {}, logResponse: () => {},
      resolveConfiguredList: () => [], toLines: () => [] },
  });
  return { events, reports, notifications };
}

test('separate AI toy cases share listening session and only wake once', async () => {
  const { events, reports } = await runScenario();
  assert.equal(events.filter(e => e === 'wake').length, 1);
  assert.equal(events.filter(e => e === 'play').length, 2);
  assert.equal(events.at(-1), 'close');
  assert.equal(reports[1].needWakeup, false);
});

test('long playback waits without waking or replaying the current audio', async () => {
  const { events } = await runScenario({ delayed: true });
  assert.equal(events.filter(e => e === 'wake').length, 1);
  assert.equal(events.filter(e => e === 'play').length, 2);
  assert.ok(events.filter(e => e === 'wait').length >= 5);
});

for (const interrupt of ['Rebooting.', 'Application: New State: idle']) {
  test(`explicit interruption allows re-wake: ${interrupt}`, async () => {
    const { events } = await runScenario({ interrupt });
    assert.equal(events.filter(e => e === 'wake').length, 2);
    assert.equal(events.filter(e => e === 'play').length, 3);
  });
}

test('stop while waiting closes listener and does not start another audio', async () => {
  const { events } = await runScenario({ delayed: true, stopWaiting: true });
  assert.equal(events.filter(e => e === 'play').length, 1);
  assert.equal(events.at(-1), 'close');
});

test('disabled ASR evaluation still waits for device listening before next audio', async () => {
  const { events } = await runScenario({ delayed: true, inputEnabled: false });
  assert.ok(events.filter(e => e === 'wait').length >= 5);
  assert.equal(events.filter(e => e === 'wake').length, 1);
});

test('pause and resume during response keeps waiting and does not abandon the runner', async () => {
  const { events } = await runScenario({ delayed: true, pauseWaiting: true });
  assert.equal(events.filter(e => e === 'play').length, 2);
  assert.equal(events.filter(e => e === 'wake').length, 1);
  assert.equal(events.at(-1), 'close');
});

test('missing input telemetry records failure without re-waking a listening device', async () => {
  const { events, reports } = await runScenario({ missingInput: true });
  assert.equal(events.filter(e => e === 'play').length, 2);
  assert.equal(events.filter(e => e === 'wake').length, 1);
  assert.equal(reports[0].failStage, 'AI_TOY_ASR');
});

test('user stop during a bridge request releases the listener without reporting a timeout error', async () => {
  const { events } = await runScenario({ abortRead: true });
  assert.equal(events.filter(e => e === 'play').length, 1);
  assert.equal(events.at(-1), 'close');
});


test('exhausted interruption retries release serial port, reboot and retry the same case', async () => {
  const { events, reports } = await runScenario({ interrupt: 'idle', interruptCount: 4 });
  const reset = events.indexOf('reboot');
  assert.equal(events[reset - 1], 'close');
  assert.deepEqual(events.slice(reset + 1, reset + 5), ['open', 'port:COM2', 'arm:wake', 'wake']);
  assert.equal(events.filter(e => e === 'reboot').length, 1);
  assert.deepEqual(reports.map(r => r.caseId), [1, 1, 1, 1, 1, 2]);
  assert.equal(reports[4].success, true);
});

test('persistent interruption after fallback reboot stops without another reboot', async () => {
  const trace = [];
  await assert.rejects(runScenario({ interrupt: 'idle', interruptCount: Infinity, trace }), /重启恢复后仍中断/);
  assert.equal(trace.filter(e => e === 'reboot').length, 1);
  assert.equal(trace.at(-1), 'close');
});

test('failed reboot stops without reopening or playing audio', async () => {
  const trace = [];
  await assert.rejects(runScenario({ interrupt: 'idle', interruptCount: 4, rebootFails: true, trace }), /重启恢复失败.*reset failed/);
  assert.equal(trace.at(-1), 'reboot');
});

test('stop during reboot prevents reopening and replay', async () => {
  const { events } = await runScenario({ interrupt: 'idle', interruptCount: 4, stopDuringReboot: true });
  assert.equal(events.at(-1), 'reboot');
});


test('AI toy notifies wake and each turn result with run and case context', async () => {
  const { notifications } = await runScenario();
  assert.equal(notifications.filter(n => n.type === 'AI_TOY_WAKE_SUCCESS').length, 1);
  const results = notifications.filter(n => n.type === 'AI_TOY_TURN_RESULT');
  assert.equal(results.length, 2);
  assert.equal(results[0].context.runId, 'run');
  assert.ok(results[0].context.details.some(d => d.includes('COM1')));
  assert.ok(results[0].context.details.some(d => d.includes('用例：1')));
});
test('AI toy reports interruption and successful reboot in order', async () => {
  const { notifications } = await runScenario({ interrupt: 'idle', interruptCount: 4 });
  const types = notifications.map(n => n.type);
  assert.equal(types.filter(t => t === 'AI_TOY_INTERRUPTED').length, 4);
  assert.ok(types.indexOf('AI_TOY_REBOOT_STARTED') < types.indexOf('AI_TOY_REBOOT_SUCCESS'));
  assert.ok(types.indexOf('AI_TOY_REBOOT_SUCCESS') < types.lastIndexOf('AI_TOY_WAKE_SUCCESS'));
});
test('failed reboot sends failure but no success message', async () => {
  const notifications = [];
  await assert.rejects(runScenario({ interrupt: 'idle', interruptCount: 4, rebootFails: true, notifications }));
  assert.equal(notifications.filter(n => n.type === 'AI_TOY_REBOOT_FAILED').length, 1);
  assert.equal(notifications.filter(n => n.type === 'AI_TOY_REBOOT_SUCCESS').length, 0);
});
test('disabled messages skip AI toy event notifications', async () => {
  const { notifications } = await runScenario({ dingTalkEnabled: false });
  assert.equal(notifications.filter(n => n.type.startsWith('AI_TOY_')).length, 0);
});
test('notification errors do not interrupt AI toy tests', async () => {
  const { reports } = await runScenario({ notifyFails: true });
  assert.equal(reports.filter(r => r.success).length, 2);
});
