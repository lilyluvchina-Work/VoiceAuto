import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDeviceProfile } from '../src/config/deviceProfiles.js';
const keyword = getDeviceProfile('speaker').response.playbackDoneKeywords[0];
const matcher = new RegExp(keyword.slice(1, keyword.lastIndexOf('/')), keyword.slice(keyword.lastIndexOf('/') + 1));
assert.equal(matcher.test('D SpeechService: SpeechService.handleLiveTtsEnd(SpeechService:1392) - onLiveTtsEnd==>false'), true);
assert.equal(matcher.test('D SpeechService: onLiveTtsEnd==>falseExtra'), false);
assert.equal(matcher.test('D SpeechService: onLiveTtsEnd==>true'), false);
assert.equal(matcher.test('D SpeechService: onLiveTtsEnd==>$stopRecord'), true);
for (const file of ['../src/hooks/useTestRunner.js', '../scripts/adbBridge.cjs']) {
  assert.ok(readFileSync(new URL(file, import.meta.url), 'utf8').includes(keyword.replaceAll('\\', '\\\\')));
}
console.log('Speaker playback marker checks passed');
