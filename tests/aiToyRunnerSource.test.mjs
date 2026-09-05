import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/runners/aiToyRunner.js', import.meta.url), 'utf8');

assert.match(source, /export async function runAiToyTest/);
assert.match(source, /ai_toy\.run\.start/);
assert.match(source, /ai_toy\.test_audio\.play\.start/);
assert.match(source, /playAudioItem\(item\.audio/);
assert.doesNotMatch(source, /responseMonitorService/);
assert.doesNotMatch(source, /waitForLangfuseResponseComplete/);
assert.doesNotMatch(source, /SPEAKER_CONTINUOUS_PLAYBACK_DONE_KEYWORD/);

// Playback ordering, retries and session reuse are exercised in aiToyContinuousRunner.test.mjs.
