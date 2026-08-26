import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/hooks/useTestRunner.js', import.meta.url), 'utf8');

assert.match(source, /buildMultiTurnQueue/);
assert.match(source, /buildContinueDecision/);
assert.match(source, /item\.needWakeup/);
assert.match(source, /dialogueTurnKey/);
assert.match(source, /continueDecision/);
assert.match(source, /shouldContinue/);
