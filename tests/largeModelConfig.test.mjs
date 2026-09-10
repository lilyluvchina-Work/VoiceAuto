import assert from 'node:assert/strict';
import { CONFIG_TYPES, CONFIG_SCHEMAS, readConfig, saveConfig, getConfigStatus } from '../src/modules/config/secureConfigStore.js';
import * as evaluator from '../src/services/reportEvaluatorService.js';

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const type = CONFIG_TYPES.MINIMAX; // Existing database records remain compatible.
assert.equal(CONFIG_SCHEMAS[type].label, '大模型配置');
assert.equal(readConfig(type, { storage }).activeProvider, 'minimax');
saveConfig(type, { enabled: true, apiKey: 'mini-secret-12345', model: 'MiniMax-M2.7' }, { storage });
const legacy = readConfig(type, { storage, includeSecrets: true });
assert.equal(legacy.activeProvider, 'minimax');
saveConfig(type, { ...legacy, activeProvider: 'codex', codexApiKey: 'codex-secret-67890' }, { storage });
const config = readConfig(type, { storage, includeSecrets: true });
assert.equal(config.apiKey, 'mini-secret-12345');
assert.equal(config.codexApiKey, 'codex-secret-67890');
assert.equal(config.codexBaseUrl, 'https://api.openai.com/v1');
assert.equal([...values.values()].join('').includes('codex-secret-67890'), false);
assert.notEqual(readConfig(type, { storage }).codexApiKey, config.codexApiKey);
assert.equal(getConfigStatus(type, { storage }).complete, true);
saveConfig(type, { ...config, activeProvider: 'minimax', apiKey: '', codexApiKey: '' }, { storage });
assert.equal(readConfig(type, { storage, includeSecrets: true }).codexApiKey, 'codex-secret-67890');

const report = { runId: 'codex-report', taskName: '模型切换测试', totalCases: 1, passedCases: 1, failedCases: 0 };
const output = JSON.stringify({ qualityScore: 95, summary: '测试通过', mainProblems: [], suggestions: [] });
const calls = [];
const result = await evaluator.evaluateReportWithLargeModel(report, {
  config, storage,
  fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, json: async () => ({ status: 'completed', output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: output }] },
    ] }) };
  },
});
assert.equal(result.success, true, result.error);
assert.equal(result.evaluation.summary, '测试通过');
assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
assert.equal(calls[0].headers.Authorization, 'Bearer codex-secret-67890');
const body = JSON.parse(calls[0].body);
assert.equal(body.model, config.codexModel);
assert.equal(body.max_output_tokens, config.codexMaxOutputTokens);
assert.equal(body.temperature, undefined);
assert.equal(body.messages, undefined);
assert.equal(body.store, false);
assert.match(body.input, /模型切换测试/);

let fetched = false;
const missing = await evaluator.evaluateReportWithLargeModel(report, {
  config: { ...config, codexApiKey: '' },
  fetchImpl: async () => { fetched = true; },
});
assert.equal(missing.success, false);
assert.match(missing.error, /Codex API Key/);
assert.equal(fetched, false);

const incomplete = await evaluator.evaluateReportWithLargeModel(report, {
  config,
  fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }) }),
});
assert.equal(incomplete.success, false);
assert.match(incomplete.error, /最大输出 Tokens/);

const mini = await evaluator.evaluateReportWithLargeModel(report, {
  config: { ...config, activeProvider: 'minimax' }, storage,
  fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.minimax.io/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer mini-secret-12345');
    assert.equal(JSON.parse(options.body).model, 'MiniMax-M2.7');
    return { ok: true, json: async () => ({ choices: [{ message: { content: output } }] }) };
  },
});
assert.equal(mini.success, true, mini.error);

const codexOnlyStorage = { getItem: (key) => codexValues.get(key) ?? null, setItem: (key, value) => codexValues.set(key, value) };
const codexValues = new Map();
saveConfig(type, { activeProvider: 'codex', codexApiKey: 'only-codex-key', enabled: true }, { storage: codexOnlyStorage });
assert.equal(getConfigStatus(type, { storage: codexOnlyStorage }).complete, true);
assert.equal(evaluator.getLargeModelEvaluationConfigStatus({ config: { ...config, enabled: false } }).ready, false);

const timeout = await evaluator.evaluateReportWithLargeModel(report, {
  config: { ...config, codexTimeout: 5 },
  fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }),
});
assert.equal(timeout.success, false);
assert.match(timeout.error, /超时/);
const failed = await evaluator.evaluateReportWithLargeModel(report, {
  config,
  fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid API key' } }) }),
});
assert.equal(failed.success, false);
assert.equal(failed.error, 'Invalid API key');
console.log('largeModelConfig tests passed');
