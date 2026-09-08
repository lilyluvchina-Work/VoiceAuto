import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRetryQueueItem } from '../src/utils/multiTurnDialogue.js';

// Only replace the React store boundary; execute the real runner.
const source = readFileSync(new URL('../src/runners/aiToyRunner.js', import.meta.url), 'utf8')
  .replace("import { actions } from '../stores/testStore';", 'const actions = new Proxy({}, { get: (_, type) => payload => ({ type, payload }) });');
const { runAiToyTest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

async function runScenario({ interrupt = '', delayed = false, stopWaiting = false, inputEnabled = true,
  stalledTurn = '', stallCount = 1, pauseWaiting = false, missingInput = false, abortRead = false, interruptCount = 1,
  rebootFails = false, bootMissing = false, stopDuringReboot = false, wakeMisses = 0, idleDuringWake = false, endDuringWake = false, advanceTime = () => {}, trace = [], downloads = [], savedLogs = [], notifications = [], dingTalkEnabled = true, notifyFails = false } = {}) {
  const events = trace;
  const reports = [];
  const refs = Object.fromEntries(Object.entries({ isPlayingRef: true, isPausedRef: false, runIdRef: 1,
    firstTestAudioTimeRef: null, lastTestAudioTimeRef: null, wakeFailCountRef: 0,
    abortControllerRef: new AbortController() }).map(([key, current]) => [key, { current }]));
  let snapshot = { phase: 'unknown', ready: false, interrupted: false };
  let pending = [];
  let plays = 0;
  let waits = 0;
  let wakes = 0;
  const queue = [1, 2].map(id => ({ audio: { id, text: '测试' }, needWakeup: true, listIndex: id - 1, round: 1, totalRounds: 1 }));
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
    closeAiToySession: async () => { events.push('close'); return { serialLog: 'session log\n' }; },
    downloadAiToySerialLog: data => downloads.push(data),
    rebootSpeaker: async () => {
      events.push('reboot');
      if (stopDuringReboot) refs.isPlayingRef.current = false;
      return { success: !rebootFails, serialConnected: !rebootFails, bootCompleted: !rebootFails && !bootMissing, recoveredDeviceId: 'COM2', message: 'reset failed', raw: { serialLog: 'reconnect log\n' } };
    },
    detectWakeup: async () => ({ success: true }),
    detectAsr: async () => ({ success: true, actualAsrText: '测试' }),
    detectSpeakerResponseLog: async () => ({ success: true }),
  };
  await runAiToyTest({ runId: 1, reportRunId: 'run', state: {}, wakeWord: { text: '唤醒' },
    defaultVoiceConfig: {}, testOptions: { dingTalkEnabled, autonomousWake: { enabled: true },
      autonomousInput: { enabled: inputEnabled }, autonomousResponse: { enabled: true, responseMaxWaitMs: 35000 } },
    deviceRuntime: { deviceType: 'ai_toy', profile: {}, serialPort: 'COM1' },
    queue,
    dispatch: action => {
      if (action.type === 'addReportCase') reports.push(action.payload);
      if (action.type === 'completeReport') events.push('complete');
      if (action.type === 'setReport' && action.payload.aiToySerialLog) savedLogs.push(action.payload.aiToySerialLog);
    },
    setCurrentAudioText: () => {}, refs,
    services: { adbWakeService: bridge, notifyDingTalk: async (type, context) => { notifications.push({ type, context }); if (notifyFails) throw new Error('notification unavailable'); },
      ttsService: { speak: async () => { events.push('wake'); wakes++; snapshot = idleDuringWake && wakes <= wakeMisses
        ? { phase: 'interrupted', ready: false, interrupted: true, wakeable: true }
        : { phase: 'listening', ready: wakes > wakeMisses }; } },
      playAudioItem: async (_, __, ___, options) => {
        events.push('play'); plays++; options.onStart();
        if (stalledTurn && plays <= stallCount) {
          snapshot = { phase: 'response', ready: false, inputDetected: stalledTurn !== 'input',
            firstAudioDetected: stalledTurn === 'playback', playbackDone: stalledTurn === 'listening' };
        } else if (interrupt && plays <= interruptCount) {
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
      advanceTime();
      if (endDuringWake && snapshot.phase === 'listening') queue.length = 0;
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

test('completion retains serial logs for manual download without starting a download', async () => {
  const downloads = [];
  const savedLogs = [];
  await runScenario({ downloads, savedLogs });
  assert.equal(downloads.length, 0);
  assert.deepEqual(savedLogs, [{ runId: 'run', serialLog: 'session log\n' }]);
});

test('download retains logs before and after recovery in order', async () => {
  const savedLogs = [];
  await runScenario({ savedLogs, interrupt: 'Application: New State: idle', interruptCount: 4 });
  assert.deepEqual(savedLogs, [{ runId: 'run', serialLog: 'session log\nreconnect log\nsession log\n' }]);
});

test('stopping a run also retains the captured serial log for download', async () => {
  const savedLogs = [];
  await runScenario({ savedLogs, delayed: true, stopWaiting: true });
  assert.equal(savedLogs.length, 1);
});

test('wake listening timeout reboots only after five retries and retries the unplayed case', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const savedLogs = [];
  const { events, reports } = await runScenario({ wakeMisses: 6, savedLogs, advanceTime: () => { now += 14000; } });
  const reset = events.indexOf('reboot');
  assert.equal(events[reset - 1], 'close');
  assert.equal(events.slice(0, reset).filter(e => e === 'wake').length, 6);
  assert.equal(events.slice(0, reset).includes('play'), false);
  assert.deepEqual(reports.map(r => r.caseId), [1, 2]);
  assert.ok(events.includes('complete'));
  assert.equal(savedLogs[0].serialLog, 'session log\nreconnect log\nsession log\n');
});

test('ended queue during missing wake listening completes and retains logs without reboot', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const savedLogs = [];
  const { events } = await runScenario({ wakeMisses: 1, endDuringWake: true, savedLogs, advanceTime: () => { now += 14000; } });
  assert.ok(events.includes('complete'));
  assert.equal(events.includes('reboot'), false);
  assert.equal(events.includes('play'), false);
  assert.equal(savedLogs.length, 1);
});

test('stop during missing wake listening retains logs without reboot or false completion', async () => {
  const savedLogs = [];
  const { events } = await runScenario({ wakeMisses: 1, stopWaiting: true, savedLogs });
  assert.equal(events.includes('reboot'), false);
  assert.equal(events.includes('complete'), false);
  assert.equal(savedLogs.length, 1);
});

test('persistent wake timeout stops after the existing recovery limit and retains logs', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const trace = [];
  const savedLogs = [];
  await assert.rejects(runScenario({ wakeMisses: Infinity, trace, savedLogs,
    advanceTime: () => { now += 14000; } }), /重启恢复后仍未收音/);
  assert.equal(trace.filter(e => e === 'reboot').length, 1);
  assert.equal(trace.includes('play'), false);
  assert.equal(trace.includes('complete'), false);
  assert.equal(savedLogs.length, 1);
});

test('failed recovery after wake timeout retains logs and reports reboot failure', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const notifications = [];
  const savedLogs = [];
  await assert.rejects(runScenario({ wakeMisses: 6, rebootFails: true, notifications, savedLogs,
    advanceTime: () => { now += 14000; } }), /重启恢复失败/);
  assert.ok(notifications.some(n => n.type === 'AI_TOY_REBOOT_FAILED'));
  assert.equal(savedLogs.length, 1);
});

for (const wakeMisses of [1, 5]) {
  test(`wake succeeds after ${wakeMisses} retries without reboot`, async (t) => {
    let now = 1000;
    t.mock.method(Date, 'now', () => now);
    const { events, reports } = await runScenario({ wakeMisses, advanceTime: () => { now += 14000; } });
    assert.equal(events.includes('reboot'), false);
    assert.equal(events.filter(e => e === 'wake').length, wakeMisses + 1);
    assert.deepEqual(reports.map(r => r.caseId), [1, 2]);
    assert.ok(reports.every(r => r.success));
  });
}

test('idle during wake immediately re-wakes without waiting for timeout or reboot', async () => {
  const { events, reports } = await runScenario({ wakeMisses: 1, idleDuringWake: true,
    advanceTime: () => { throw new Error('idle must be handled before waiting'); } });
  assert.equal(events.filter(e => e === 'wake').length, 2);
  assert.equal(events.includes('reboot'), false);
  assert.deepEqual(reports.map(r => r.caseId), [1, 2]);
});

test('serial reconnection without confirmed boot cannot resume testing', async () => {
  const trace = [];
  await assert.rejects(runScenario({ interrupt: 'idle', interruptCount: 4, bootMissing: true, trace }), /重启恢复失败/);
  assert.equal(trace.at(-1), 'reboot');
});

for (const [stalledTurn, expectedStage] of [
  ['input', 'AI_TOY_INPUT_TIMEOUT'], ['response', 'AI_TOY_RESPONSE_TIMEOUT'],
  ['playback', 'AI_TOY_RESPONSE_TIMEOUT'], ['listening', 'AI_TOY_LISTENING_TIMEOUT'],
]) {
  test(`${stalledTurn} timeout resets and retries the same case before continuing`, async t => {
    let now = 1000, waits = 0;
    t.mock.method(Date, 'now', () => now);
    const savedLogs = [];
    const { events, reports } = await runScenario({ stalledTurn, savedLogs, advanceTime: () => {
      now += 40000;
      if (++waits > 3) throw new Error('runner waited forever instead of recovering');
    } });
    const reset = events.indexOf('reboot');
    assert.equal(events[reset - 1], 'close');
    assert.deepEqual(reports.map(r => r.caseId), [1, 1, 2]);
    assert.equal(reports[0].success, false);
    assert.equal(reports[0].failStage, expectedStage);
    assert.equal(reports[1].success, true);
    assert.equal(events.filter(e => e === 'reboot').length, 1);
    assert.equal(savedLogs[0].serialLog, 'session log\nreconnect log\nsession log\n');
  });
}

test('persistent missing response stops after reset limit and keeps logs', async t => {
  let now = 1000, waits = 0;
  t.mock.method(Date, 'now', () => now);
  const trace = [], savedLogs = [];
  await assert.rejects(runScenario({ stalledTurn: 'response', stallCount: Infinity, trace, savedLogs,
    advanceTime: () => { now += 40000; if (++waits > 3) throw new Error('waited forever'); } }), /重启恢复后仍异常/);
  assert.equal(trace.filter(e => e === 'reboot').length, 1);
  assert.equal(trace.includes('complete'), false);
  assert.equal(savedLogs.length, 1);
});

test('firmware reports no TTS start and immediately triggers reset recovery', async () => {
  const { events, reports } = await runScenario({ interrupt: 'WS response timeout (no_tts_start)' });
  assert.equal(events.filter(e => e === 'reboot').length, 1);
  assert.deepEqual(reports.map(r => r.caseId), [1, 1, 2]);
});

test('disabled ASR scoring still recovers an unresponsive device', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const { events, reports } = await runScenario({ stalledTurn: 'input', inputEnabled: false,
    advanceTime: () => { now += 40000; } });
  assert.equal(events.filter(e => e === 'reboot').length, 1);
  assert.equal(reports[0].failStage, 'AI_TOY_INPUT_TIMEOUT');
});

test('stop while device is unresponsive keeps logs without triggering reset', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const savedLogs = [];
  const { events } = await runScenario({ stalledTurn: 'response', stopWaiting: true, savedLogs,
    advanceTime: () => { now += 40000; } });
  assert.equal(events.includes('reboot'), false);
  assert.equal(events.includes('complete'), false);
  assert.equal(savedLogs.length, 1);
});
