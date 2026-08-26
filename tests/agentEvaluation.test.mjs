import assert from 'node:assert/strict';

import {
  DEFAULT_AGENT_EVALUATION_METRICS,
  evaluateAgentReport,
  normalizeSelectedEvaluationMetrics,
  selectAgentEvaluationPlan,
} from '../src/utils/agentEvaluation.js';

assert.deepEqual(normalizeSelectedEvaluationMetrics([]), DEFAULT_AGENT_EVALUATION_METRICS);
assert.deepEqual(normalizeSelectedEvaluationMetrics(['unknown', 'asr']), ['asr']);

assert.equal(selectAgentEvaluationPlan(['intent']).planId, 'planB_semantic');
assert.equal(selectAgentEvaluationPlan(['intent', 'asr']).planId, 'planA_link_state');
assert.equal(selectAgentEvaluationPlan(['case_pass_rate']).planId, 'builtin_rules');

const builtinResult = evaluateAgentReport([
  { success: true, failStage: '' },
  { success: false, failStage: 'ASR', failReason: '未识别' },
], ['case_pass_rate']);

assert.equal(builtinResult.plan.planId, 'builtin_rules');
assert.equal(builtinResult.summary.totalTurns, 2);
assert.equal(builtinResult.summary.passedTurns, 1);
assert.equal(builtinResult.summary.passRate, '50.0%');
assert.equal(builtinResult.metrics.find((item) => item.metricId === 'case_pass_rate').status, 'calculated');

const linkResult = evaluateAgentReport([
  {
    success: true,
    speakerWakeStatus: 'success',
    asrMatchResult: 'matched',
    responseTtsText: '好的',
    responseTtsStatus: 'response_complete',
  },
], ['tts_play_complete', 'response_complete']);

assert.equal(linkResult.plan.planId, 'planA_link_state');
assert.match(linkResult.missingMessages[0], /tts_play_complete/);
assert.equal(linkResult.metrics.find((item) => item.metricId === 'response_complete').status, 'calculated');

const semanticResult = evaluateAgentReport([{ success: true }], ['intent', 'response_quality']);

assert.equal(semanticResult.plan.planId, 'planB_semantic');
assert.equal(semanticResult.metrics.length, 2);
assert.equal(semanticResult.metrics[0].status, 'pending_model');
assert.match(semanticResult.metrics[0].message, /大模型/);
