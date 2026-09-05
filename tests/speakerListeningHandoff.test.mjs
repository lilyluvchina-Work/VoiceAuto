import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('../src/services/responseMonitorService.js', import.meta.url), 'utf8');
const loop = source.slice(source.indexOf('    const deadline = detectStartTime + responseWindowMs;'), source.indexOf('    const detectEndTime = now();'));
async function run(complete) {
  let time = 1000;
  const context = { config: { isPlaybackComplete: () => complete }, now: () => time,
    detectStartTime: 0, responseWindowMs: 20000, signal: null, calculateByteRms: () => 0,
    analyser: {}, analyserBuffer: [], peakRms: 0, latestDynamicThreshold: 0, baseThreshold: 0.02,
    noiseFloor: 0, audioDetected: true, audioStartTime: 0, lastVoiceTime: 500,
    finalSilenceMs: 0, minProtectReachedLogged: false, audioEndTime: null, finishReason: '', speakerState: '',
    timingPlan: { minProtectMs: 10000, silenceEndMs: 2000, maxRecordMs: 20000, replyStartTimeoutMs: 20000 },
    postRollMs: 1000, onLog: () => {}, wait: async ms => { time += ms; } };
  await vm.runInNewContext(`(async () => { ${loop} })()`, context);
  return { time, ...context };
}
test('confirmed device playback end releases recording before the listening window expires', async () => {
  const result = await run(true);
  assert.equal(result.time, 1000);
  assert.equal(result.speakerState, 'FINISHED');
});
test('without a confirmed end signal the existing recording protection remains', async () => {
  assert.ok((await run(false)).time >= 10000);
});


test('cooldown applies only when the next turn requires another wakeup', () => {
  const runner = readFileSync(new URL('../src/hooks/useTestRunner.js', import.meta.url), 'utf8');
  const condition = runner.match(/if \((!isLastCase &&[^\n]+!speakerSingleTurnLangfuseWakeGateEnabled)\)/)[1];
  const context = { isLastCase: false, isSpeakerRun: true, autonomousResponseEnabled: true,
    speakerSingleTurnLangfuseWakeGateEnabled: false, nextItem: {needWakeup: false} };
  assert.equal(vm.runInNewContext(condition, context), false);
  context.nextItem.needWakeup = true;
  assert.equal(vm.runInNewContext(condition, context), true);
});
