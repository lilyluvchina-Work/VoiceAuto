import { CONFIG_TYPES, readConfig as readSecureConfig } from '../modules/config/secureConfigStore.js';

export const REPORT_EVALUATION_STORAGE_KEY = 'voiceauto_report_evaluations_v1';
export const REPORT_EVALUATION_EVENT = 'voiceauto:report-evaluation-updated';

const RISK_ORDER = { 低: 1, 中: 2, 高: 3 };

function getStorage(options = {}) {
  if (options.storage) return options.storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeUrl(value) {
  const text = normalizeText(value);
  return text && text !== '/' && text !== '-' ? text : '';
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampScore(value, fallback) {
  const n = toNumber(value, fallback);
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parsePercent(value) {
  const match = normalizeText(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function getReportRows(report = {}) {
  if (Array.isArray(report.reportRows)) return report.reportRows;
  if (Array.isArray(report.caseDetails)) return report.caseDetails;
  if (Array.isArray(report.failedCaseList)) return report.failedCaseList;
  return [];
}

function isErrorCase(row = {}) {
  const result = normalizeText(row.result || row.testResult || row.executionResult || row.logStatus);
  return /异常|error|exception/i.test(result);
}

function isProblemCase(row = {}) {
  if (row.testPassed === false) return true;
  if (row.passed === false) return true;
  const result = normalizeText(row.result || row.testResult || row.executionResult || row.status || row.logStatus);
  return /异常|失败|未通过|不通过|failed|fail|error|exception/i.test(result);
}

function resolveTaskName(report = {}) {
  if (normalizeText(report.taskName)) return normalizeText(report.taskName);
  if (normalizeText(report.testTaskName)) return normalizeText(report.testTaskName);
  if (Array.isArray(report.importedPlans) && report.importedPlans.length) {
    return report.importedPlans.map(normalizeText).filter(Boolean).join('、');
  }
  return '语音自助交互测试任务';
}

function resolveCaseName(row = {}) {
  return normalizeText(row.caseName || row.name || row.testAudioText || row.caseId || row.sessionID || '未命名用例');
}

function resolveCaseResult(row = {}) {
  return normalizeText(row.result || row.testResult || row.executionResult || row.status || row.logStatus || '未通过');
}

function resolveErrorMessage(row = {}) {
  return normalizeText(row.errorMessage || row.logError || row.error || row.failureReason || row.reason)
    || '未解析到明确错误信息，请查看日志链接。';
}

function buildFailedCaseList(rows) {
  return rows.filter(isProblemCase).map((row) => ({
    caseName: resolveCaseName(row),
    result: resolveCaseResult(row),
    errorMessage: resolveErrorMessage(row),
    logUrl: normalizeUrl(row.logUrl || row.traceUrl || row.url),
  }));
}

export function buildEvaluationInput(report = {}) {
  const rows = getReportRows(report);
  const failedCaseList = buildFailedCaseList(rows);
  const rowErrorCases = rows.filter((row) => isProblemCase(row) && isErrorCase(row)).length;
  const totalCases = toNumber(report.totalCases, rows.length);
  const failedCases = toNumber(report.failedCases, failedCaseList.length);
  const errorCases = toNumber(report.errorCases, rowErrorCases);
  const passedCases = toNumber(report.passedCases, Math.max(0, totalCases - failedCases));
  const passRate = normalizeText(report.passRate)
    || (totalCases > 0 ? `${((passedCases / totalCases) * 100).toFixed(1)}%` : '0%');

  return {
    taskName: resolveTaskName(report),
    executeTime: normalizeText(report.executeTime || report.generatedAtText || report.testTime || report.completedAt),
    totalCases,
    passedCases,
    failedCases,
    errorCases,
    passRate,
    failedCaseList,
  };
}

export function buildEvaluationPrompt(reportInput) {
  return `你是一个资深测试专家，请基于以下自动化测试报告数据进行评测。

请从以下维度分析：
1. 本次测试整体质量评分，满分100分
2. 测试风险等级：高 / 中 / 低
3. 是否建议发布
4. 主要失败原因归类
5. 需要优先修复的问题
6. 给测试人员和开发人员的改进建议

要求：
- 不要编造报告中不存在的信息
- 如果信息不足，请明确指出
- 输出 JSON 格式
- 语言使用中文

测试报告数据如下：
${JSON.stringify(reportInput, null, 2)}`;
}

function readEvaluationStore(options = {}) {
  const storage = getStorage(options);
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(REPORT_EVALUATION_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeEvaluationStore(store, options = {}) {
  const storage = getStorage(options);
  if (!storage) return;
  storage.setItem(REPORT_EVALUATION_STORAGE_KEY, JSON.stringify(store || {}));
}

export function getSavedEvaluationResult(runId, options = {}) {
  const id = normalizeText(runId);
  if (!id) return null;
  return readEvaluationStore(options)[id] || null;
}

export function saveEvaluationResult(runId, evaluation, options = {}) {
  const id = normalizeText(runId);
  if (!id || !evaluation) return evaluation;
  const store = readEvaluationStore(options);
  const record = {
    ...evaluation,
    runId: id,
    evaluatedAt: new Date().toISOString(),
  };
  store[id] = record;
  writeEvaluationStore(store, options);
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent(REPORT_EVALUATION_EVENT, { detail: record }));
  }
  return record;
}

function stripThinkingContent(value) {
  return normalizeText(value).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function extractJsonPayload(value) {
  const text = stripThinkingContent(value).replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error('大模型未返回有效 JSON');
  }
}

function getMessageContent(body = {}) {
  return normalizeText(body.choices?.[0]?.message?.content)
    || normalizeText(body.choices?.[0]?.text)
    || normalizeText(body.output_text)
    || normalizeText(body.content);
}

function inferRiskLevel(input) {
  const passRate = parsePercent(input.passRate);
  const problemCases = Math.max(toNumber(input.failedCases), input.failedCaseList?.length || 0);
  const errorCases = toNumber(input.errorCases);
  if (problemCases >= 5 || errorCases >= 3 || (passRate !== null && passRate < 80)) return '高';
  if (problemCases > 0 || errorCases > 0 || (passRate !== null && passRate < 95)) return '中';
  return '低';
}

function maxRisk(left, right) {
  const a = RISK_ORDER[left] ? left : null;
  const b = RISK_ORDER[right] ? right : null;
  if (!a) return b || '中';
  if (!b) return a;
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

function defaultReleaseSuggestion(riskLevel) {
  if (riskLevel === '高') return '暂缓发布';
  if (riskLevel === '中') return '谨慎发布';
  return '可以发布';
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  const text = normalizeText(value);
  return text ? [text] : [];
}

function buildFallbackSummary(input, riskLevel) {
  return `本次测试通过率为${input.passRate}，共发现${Math.max(input.failedCases, input.failedCaseList.length)}个失败/异常用例，风险等级为${riskLevel}。`;
}

export function normalizeEvaluationResult(rawResult, input) {
  const parsed = rawResult && typeof rawResult === 'object' ? rawResult : {};
  const heuristicRisk = inferRiskLevel(input);
  const riskLevel = maxRisk(parsed.riskLevel, heuristicRisk);
  const qualityScoreFallback = parsePercent(input.passRate) ?? Math.max(0, 100 - input.failedCaseList.length * 10);
  const releaseSuggestion = riskLevel === '高'
    ? '暂缓发布'
    : (normalizeText(parsed.releaseSuggestion) || defaultReleaseSuggestion(riskLevel));

  return {
    qualityScore: clampScore(parsed.qualityScore, qualityScoreFallback),
    riskLevel,
    releaseSuggestion,
    summary: normalizeText(parsed.summary) || buildFallbackSummary(input, riskLevel),
    mainProblems: normalizeStringList(parsed.mainProblems || parsed.mainProblem || parsed.problems),
    suggestions: normalizeStringList(parsed.suggestions || parsed.improvementSuggestions || parsed.recommendations),
  };
}

function buildEndpoint(baseUrl) {
  const normalized = normalizeText(baseUrl || 'https://api.minimax.io/v1').replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function loadMiniMaxConfig(options = {}) {
  return options.config || readSecureConfig(CONFIG_TYPES.MINIMAX, { includeSecrets: true });
}

function resolveSelectedModel(config) {
  const provider = config.activeProvider || 'minimax';
  if (!['minimax', 'codex'].includes(provider)) throw new Error('不支持的大模型，请到配置中心重新选择。');
  return provider === 'codex'
    ? { provider, label: 'Codex', enabled: config.enabled, apiKey: config.codexApiKey,
      baseUrl: config.codexBaseUrl || 'https://api.openai.com/v1', model: config.codexModel || 'gpt-5.3-codex',
      maxTokens: config.codexMaxOutputTokens ?? 8192, timeout: config.codexTimeout ?? 120000 }
    : { provider, label: 'MiniMax', ...config, maxTokens: config.maxCompletionTokens ?? 2048 };
}

function selectedModelStatus(config) {
  const enabled = Boolean(config.enabled);
  const hasApiKey = Boolean(normalizeText(config.apiKey));
  return {
    ready: enabled && hasApiKey,
    enabled,
    hasApiKey,
    message: !enabled ? `${config.label} 大模型配置未启用，请先到配置中心启用。`
      : !hasApiKey ? `${config.label} API Key 未配置，请先到配置中心填写并保存。` : '',
  };
}

export function getLargeModelEvaluationConfigStatus(options = {}) {
  return selectedModelStatus(resolveSelectedModel(loadMiniMaxConfig(options)));
}

export function getMiniMaxEvaluationConfigStatus(options = {}) {
  const config = loadMiniMaxConfig(options);
  const enabled = Boolean(config?.enabled);
  const hasApiKey = Boolean(normalizeText(config?.apiKey));

  if (!enabled) {
    return {
      ready: false,
      enabled,
      hasApiKey,
      message: 'MiniMax 大模型配置未启用，请先到配置中心启用。',
    };
  }

  if (!hasApiKey) {
    return {
      ready: false,
      enabled,
      hasApiKey,
      message: 'MiniMax API Key 未配置，请先到配置中心填写并保存。',
    };
  }

  return {
    ready: true,
    enabled,
    hasApiKey,
    message: '',
  };
}

export async function evaluateReportWithMiniMax(report, options = {}) {
  return evaluateReportWithLargeModel(report, {
    ...options, config: { ...loadMiniMaxConfig(options), activeProvider: 'minimax' },
  });
}

export async function evaluateReportWithLargeModel(report, options = {}) {
  const input = buildEvaluationInput(report);
  let timeoutId;
  try {
    const config = resolveSelectedModel(loadMiniMaxConfig(options));
    const configStatus = selectedModelStatus(config);
    if (!configStatus.ready) throw new Error(configStatus.message);
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持 fetch');

    const isCodex = config.provider === 'codex';
    const baseUrl = normalizeText(config.baseUrl).replace(/\/+$/, '');
    const endpoint = isCodex
      ? (baseUrl.endsWith('/responses') ? baseUrl : `${baseUrl}/responses`)
      : buildEndpoint(config.baseUrl);
    const maxTokens = Number(config.maxTokens);
    const timeout = Number(config.timeout ?? 60000);
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) throw new Error('最大输出 Tokens 必须是正整数');
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new Error('超时时间必须是有效的正整数');
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalizeText(config.apiKey)}`,
      },
      body: JSON.stringify(isCodex ? {
        model: normalizeText(config.model),
        instructions: '你是一个资深测试专家，只能基于输入的自动化测试报告数据输出 JSON 评测结果。',
        input: buildEvaluationPrompt(input),
        max_output_tokens: maxTokens,
        store: false,
        stream: false,
      } : {
        model: normalizeText(config.model) || 'MiniMax-M2.7',
        messages: [
          {
            role: 'system',
            content: '你是一个资深测试专家，只能基于输入的自动化测试报告数据输出 JSON 评测结果。',
          },
          {
            role: 'user',
            content: buildEvaluationPrompt(input),
          },
        ],
        temperature: toNumber(config.temperature, 1),
        max_completion_tokens: maxTokens,
        stream: false,
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.message || body.error?.message || `${config.label} 调用失败：HTTP ${response.status}`);
    }

    if (isCodex && body.status === 'incomplete') {
      throw new Error(body.incomplete_details?.reason === 'max_output_tokens'
        ? 'Codex 输出未完成，请增大最大输出 Tokens 后重试。' : 'Codex 输出未完成，请重试。');
    }
    if (isCodex && body.error) throw new Error(body.error.message || 'Codex 调用失败');
    const messageContent = isCodex
      ? (body.output || []).filter((item) => item.type === 'message')
        .flatMap((item) => item.content || []).filter((item) => item.type === 'output_text')
        .map((item) => item.text || '').join('\n')
      : getMessageContent(body);
    if (!messageContent) throw new Error(`${config.label} 未返回评测内容`);
    const evaluation = normalizeEvaluationResult(extractJsonPayload(messageContent), input);
    const saved = saveEvaluationResult(report?.runId || report?.id || input.taskName, evaluation, options);
    return { success: true, evaluation: saved, input };
  } catch (error) {
    return {
      success: false,
      error: error?.name === 'AbortError' ? '大模型评测超时，请调整超时时间或稍后重试。' : error?.message || '大模型评测失败',
      input,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
