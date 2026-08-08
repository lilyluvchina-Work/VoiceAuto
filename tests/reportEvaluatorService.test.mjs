import assert from 'node:assert/strict';
import {
  buildEvaluationInput,
  buildEvaluationPrompt,
  evaluateReportWithMiniMax,
  getSavedEvaluationResult,
  getMiniMaxEvaluationConfigStatus,
} from '../src/services/reportEvaluatorService.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

const report = {
  runId: 'run-eval-001',
  importedPlans: ['语音自助交互测试任务'],
  generatedAtText: '2026-08-05 10:30:00',
  totalCases: 6,
  passedCases: 1,
  failedCases: 5,
  passRate: '16.7%',
  reportRows: [
    {
      caseName: '查询余额-普通话识别',
      testAudioText: '查询余额',
      testResult: '执行异常',
      testPassed: false,
      logError: 'AssertionError: 语音识别结果为空',
      logUrl: 'https://example.test/logs/001',
    },
    {
      caseName: '打开二楼',
      testAudioText: '打开二楼',
      testResult: '未通过',
      testPassed: false,
      logError: 'FAILED: agent mismatch',
      logUrl: '',
    },
  ],
};

const input = buildEvaluationInput(report);
assert.equal(input.taskName, '语音自助交互测试任务');
assert.equal(input.executeTime, '2026-08-05 10:30:00');
assert.equal(input.totalCases, 6);
assert.equal(input.passedCases, 1);
assert.equal(input.failedCases, 5);
assert.equal(input.errorCases, 1);
assert.equal(input.failedCaseList.length, 2);
assert.deepEqual(input.failedCaseList[0], {
  caseName: '查询余额-普通话识别',
  result: '执行异常',
  errorMessage: 'AssertionError: 语音识别结果为空',
  logUrl: 'https://example.test/logs/001',
});

const prompt = buildEvaluationPrompt(input);
assert.match(prompt, /不要编造报告中不存在的信息/);
assert.match(prompt, /"taskName": "语音自助交互测试任务"/);

{
  assert.deepEqual(getMiniMaxEvaluationConfigStatus({ config: { enabled: false, apiKey: '' } }), {
    ready: false,
    enabled: false,
    hasApiKey: false,
    message: 'MiniMax 大模型配置未启用，请先到配置中心启用。',
  });

  assert.deepEqual(getMiniMaxEvaluationConfigStatus({ config: { enabled: true, apiKey: '' } }), {
    ready: false,
    enabled: true,
    hasApiKey: false,
    message: 'MiniMax API Key 未配置，请先到配置中心填写并保存。',
  });

  assert.deepEqual(getMiniMaxEvaluationConfigStatus({ config: { enabled: true, apiKey: 'sk-minimax-test' } }), {
    ready: true,
    enabled: true,
    hasApiKey: true,
    message: '',
  });
}

{
  const storage = createMemoryStorage();
  const calls = [];
  const result = await evaluateReportWithMiniMax(report, {
    storage,
    config: {
      enabled: true,
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: 'sk-minimax-test',
      model: 'MiniMax-M2.7',
      temperature: 1,
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '```json\n{"qualityScore":72,"riskLevel":"低","releaseSuggestion":"可以发布","summary":"存在多处异常。","mainProblems":["语音识别结果为空"],"suggestions":["优先排查识别服务"]}\n```',
              },
            },
          ],
        }),
      };
    },
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.minimax.io/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-minimax-test');
  const requestBody = JSON.parse(calls[0].options.body);
  assert.equal(requestBody.model, 'MiniMax-M2.7');
  assert.equal(requestBody.stream, false);
  assert.equal(result.evaluation.qualityScore, 72);
  assert.equal(result.evaluation.riskLevel, '高');
  assert.equal(result.evaluation.releaseSuggestion, '暂缓发布');
  assert.deepEqual(getSavedEvaluationResult('run-eval-001', { storage }).mainProblems, ['语音识别结果为空']);
}

{
  const failed = await evaluateReportWithMiniMax(report, {
    config: {
      enabled: true,
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: 'sk-minimax-test',
      model: 'MiniMax-M2.7',
      temperature: 1,
    },
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ message: 'upstream error' }),
    }),
  });

  assert.equal(failed.success, false);
  assert.match(failed.error, /upstream error/);
}

{
  const lowRiskReport = {
    runId: 'run-eval-low',
    taskName: '全量冒烟测试',
    totalCases: 10,
    passedCases: 10,
    failedCases: 0,
    passRate: '100%',
    reportRows: [
      { caseName: '查询余额', testResult: '通过', testPassed: true },
    ],
  };
  const result = await evaluateReportWithMiniMax(lowRiskReport, {
    config: {
      enabled: true,
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: 'sk-minimax-test',
      model: 'MiniMax-M2.7',
      temperature: 1,
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"qualityScore":98,"summary":"全部通过。","mainProblems":[],"suggestions":["保持回归覆盖"]}',
            },
          },
        ],
      }),
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.evaluation.riskLevel, '低');
  assert.equal(result.evaluation.releaseSuggestion, '可以发布');
}
