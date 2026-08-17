import assert from 'node:assert/strict';
import {
  shouldExpectVoiceResponse,
  tapdCaseToTestAudios,
} from '../src/modules/tapd/utils/tapdParser.js';

assert.equal(shouldExpectVoiceResponse('预期结果：无需语音回复，只需要页面展示'), false);
assert.equal(shouldExpectVoiceResponse('期望：Speaker 不需要播报'), false);
assert.equal(shouldExpectVoiceResponse('Expected: no voice response'), false);
assert.equal(shouldExpectVoiceResponse('预期结果：回复可有可无，无回复不算错误'), false);
assert.equal(shouldExpectVoiceResponse('预期：没有播报也正常'), false);
assert.equal(shouldExpectVoiceResponse('预期结果：回复余额信息'), true);

const rows = tapdCaseToTestAudios({
  id: 'CASE-1',
  name: '静默执行用例',
  steps: 'Human: 打开设置',
  expectation: '预期结果：无需语音回复，页面进入设置',
}, {
  testPlanId: 'PLAN-1',
  testPlanName: '回归测试',
}, {}, () => 'local-1');

assert.equal(rows.length, 1);
assert.equal(rows[0].audio.expectsVoiceResponse, false);
assert.equal(rows[0].audio.expectedResult, '预期结果：无需语音回复，页面进入设置');
