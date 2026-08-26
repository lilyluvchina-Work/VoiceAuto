import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/utils/reportGenerator.js', import.meta.url), 'utf8');

assert.match(source, /agentEvaluation/);
assert.match(source, /multiTurnCaseId/);
assert.match(source, /turnIndex/);
assert.match(source, /needWakeup/);
assert.match(source, /多轮对话/);
assert.match(source, /智能体评测/);
