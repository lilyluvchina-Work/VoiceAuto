import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const playbackSource = readFileSync(new URL('../src/components/PlaybackConsole.jsx', import.meta.url), 'utf8');
const reportSource = readFileSync(new URL('../src/components/TestReport.jsx', import.meta.url), 'utf8');

assert.match(playbackSource, /AGENT_EVALUATION_METRIC_GROUPS/);
assert.match(playbackSource, /setAgentEvaluationMetrics/);
assert.match(playbackSource, /智能体评测项/);
assert.match(playbackSource, /推荐方案/);

assert.match(reportSource, /summarizeMultiTurnCases/);
assert.match(reportSource, /evaluateAgentReport/);
assert.match(reportSource, /多轮对话/);
assert.match(reportSource, /智能体评测/);
