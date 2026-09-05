import assert from 'node:assert/strict';
import test from 'node:test';
import { planSpeakerRecovery } from '../src/utils/speakerRecovery.js';
const item = { audio: {id: 1}, dialogueTurnKey: 'd:1', turnIndex: 1, needWakeup: false };
test('missing playback end re-wakes and retries the same turn', () => {
  const retry = planSpeakerRecovery(item, { status: 'timeout', message: 'no end' });
  assert.equal(retry.audio, item.audio); assert.equal(retry.turnIndex, 1);
  assert.equal(retry.needWakeup, true); assert.equal(retry.retryCount, 1);
  assert.equal(retry.forceWakeDetection, true);
});
test('confirmed playback end needs no recovery', () => {
  assert.equal(planSpeakerRecovery(item, { success: true, status: 'playback_done' }), null);
});
test('recovery has a finite limit and preserves original failure', () => {
  assert.throws(() => planSpeakerRecovery({...item, retryCount: 3}, {message:'no end'}), /恢复.*上限.*no end/);
});


import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const hook = readFileSync(new URL('../src/hooks/useTestRunner.js', import.meta.url), 'utf8');
const wakeFunction = hook.slice(hook.indexOf('    const ensureSpeakerWakeup ='), hook.indexOf('    dispatch(actions.startPlayback(reportRunId));'));
async function wakeScenario(bootCompleted) {
  const events = []; let attempts = 0;
  const context = { testOptions: {autonomousWake: {enabled: true, maxRebootsPerCase:1,maxRebootsPerRun:3}},
    isSpeakerContinuousDialogue:true, parseWakeKeywords:()=>[], toLines:()=>[],
    deviceRuntime:{profile:{label:'Speaker',wake:{keywords:[]},defaults:{}},logSource:'adb'},
    shouldStop:()=>false, logWake:()=>{}, dispatch:()=>{},
    actions:new Proxy({}, {get:()=>x=>x}), setCurrentAudioText:()=>{},
    wakeWord:{text:'wake'}, defaultVoiceConfig:{}, Date, console,
    wakeFailCountRef:{current:0}, rebootCountRef:{current:0}, abortControllerRef:{current:null},
    reportRunIdRef:{current:'run'}, state:{}, resolveAudioCaseId:()=>1,
    notifyDingTalk:()=>{}, LOG_SOURCES:{SERIAL:'serial'}, POST_REBOOT_WAKE_RETRY_DELAY_MS:0,
    wait:async()=>{}, ttsService:{speak:async()=>events.push('wake')},
    adbWakeService:{ detectWakeup:async()=>({success:++attempts>5}),
      rebootSpeaker:async()=>{events.push('reboot');return {success:true,bootCompleted};} } };
  vm.runInNewContext(wakeFunction+';this.run = ensureSpeakerWakeup;',context);
  let error; let result;
  try { result = await context.run({audio:{id:1,text:'test'},round:1,totalRounds:1},0); } catch(e) {error=e;}
  return {events,result,error};
}
test('five failed wakes reboot, confirmed startup then retries wake', async () => {
  const result = await wakeScenario(true);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.events, ['wake','wake','wake','wake','wake','reboot','wake']);
  assert.equal(result.result.speaker_wake_status,'success');
});
test('unconfirmed startup stops without playing another wake word', async () => {
  const result = await wakeScenario(false);
  assert.ok(result.error);
  assert.equal(result.events.at(-1),'reboot');
});
