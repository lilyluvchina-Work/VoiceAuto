import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runnerSource = readFileSync(new URL('../src/hooks/useTestRunner.js', import.meta.url), 'utf8');

assert.doesNotMatch(runnerSource, /notifyDingTalk\('STT_FAILED'/);
assert.doesNotMatch(runnerSource, /notifyDingTalk\('SPEAKER_RESPONSE_NOT_DETECTED'/);
assert.match(runnerSource, /notifyDingTalk\('TEST_STARTED'/);
assert.match(runnerSource, /notifyDingTalk\('TEST_COMPLETED'/);
