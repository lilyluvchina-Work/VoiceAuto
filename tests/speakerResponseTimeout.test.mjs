import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import test from 'node:test';
const source = readFileSync(new URL('../scripts/adbBridge.cjs', import.meta.url), 'utf8');
const detector = source.slice(source.indexOf('function detectSpeakerResponseLog('), source.indexOf('function detectWakeup('));
function setup() {
  let now = 0; const timers = new Map(); let timerId = 0; const children = [];
  const ctx = { Date: { now: () => now }, Math, resolveLogSource: () => 'adb', LOG_SOURCE_SERIAL: 'serial',
    DEFAULT_RESPONSE_VAD_START_KEYWORDS: ['VAD_START'], DEFAULT_RESPONSE_VAD_END_KEYWORDS: ['VAD_END'],
    DEFAULT_RESPONSE_PLAYBACK_DONE_KEYWORDS: ['onLiveTtsEnd==>false'], DEFAULT_RESPONSE_TTS_KEYWORDS: ['TTS_TEXT'],
    createKeywordMatchers: keys => keys.map(label => ({label, test: line => line.includes(label)})),
    appendBridgeLog: () => {}, extractTtsTextFromLine: () => '', buildAdbArgs: (_, args) => args,
    setTimeout: (fn, delay) => { timers.set(++timerId, {fn, at: now + delay}); return timerId; },
    clearTimeout: id => timers.delete(id),
    spawn: () => { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => {}; children.push(child); return child; },
  };
  vm.runInNewContext(detector + ';this.detect = detectSpeakerResponseLog;', ctx);
  const promise = ctx.detect({ timeoutMs: 8000, maxWaitMs: 60000 });
  children[0].emit('close', 0);
  return { promise, emit: text => children[1].stdout.emit('data', Buffer.from(text + '\n')),
    advance: time => { now = time; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } } };
}
test('continues past 8 seconds without VAD and detects a later playback completion', async () => {
  const f = setup(); let settled = false; f.promise.then(() => { settled = true; });
  f.advance(8000); await Promise.resolve();
  assert.equal(settled, false);
  f.advance(20000); f.emit('SpeechService: onLiveTtsEnd==>false');
  const result = await f.promise; assert.equal(result.status, 'playback_done'); assert.equal(result.vadEnded, true);
});
test('still times out at the configured maximum wait', async () => {
  const f = setup(); f.advance(8000); f.advance(60000);
  const result = await f.promise; assert.equal(result.status, 'timeout'); assert.equal(result.success, false);
});
