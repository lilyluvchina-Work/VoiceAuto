export const AGENT_EVALUATION_METRIC_GROUPS = [
  {
    id: 'builtin',
    label: '基础执行',
    metrics: [
      { id: 'case_pass_rate', label: '用例通过率', category: 'builtin' },
      { id: 'task_completion', label: '任务完成率', category: 'builtin' },
      { id: 'keyword_assertion', label: '关键词断言', category: 'builtin' },
    ],
  },
  {
    id: 'link_state',
    label: '语音链路',
    metrics: [
      { id: 'wakeup', label: '唤醒成功率', category: 'link_state' },
      { id: 'asr', label: 'ASR 成功率', category: 'link_state' },
      { id: 'tts', label: 'TTS 文本核查', category: 'link_state' },
      { id: 'tts_play_complete', label: 'TTS 完播率', category: 'link_state' },
      { id: 'response_complete', label: 'response_complete', category: 'link_state' },
    ],
  },
  {
    id: 'semantic',
    label: '语义能力',
    metrics: [
      { id: 'intent', label: '意图理解', category: 'semantic' },
      { id: 'slot', label: '槽位识别', category: 'semantic' },
      { id: 'context', label: '上下文理解', category: 'semantic' },
      { id: 'semantic_continue', label: '语义续聊', category: 'semantic' },
      { id: 'response_quality', label: '回复质量', category: 'semantic' },
    ],
  },
];

export const DEFAULT_AGENT_EVALUATION_METRICS = ['case_pass_rate', 'task_completion'];

const METRIC_BY_ID = new Map(
  AGENT_EVALUATION_METRIC_GROUPS.flatMap((group) => (
    group.metrics.map((metric) => [metric.id, { ...metric, groupLabel: group.label }])
  ))
);

const PLAN_INFO = {
  builtin_rules: {
    planId: 'builtin_rules',
    planName: '方式 1：当前工具功能逻辑',
    category: 'builtin',
    reason: '未选择链路或语义类指标，使用工具内置通过率、任务完成和断言结果进行评测。',
  },
  planA_link_state: {
    planId: 'planA_link_state',
    planName: '方式 2：PlanA Langfuse / 链路状态评测',
    category: 'link_state',
    reason: '勾选项包含唤醒、ASR、TTS、完播或 response_complete，优先使用真实链路数据评测。',
  },
  planB_semantic: {
    planId: 'planB_semantic',
    planName: '方式 3：PlanB 大模型语义评测',
    category: 'semantic',
    reason: '勾选项包含意图、槽位、上下文、语义续聊或回复质量，使用语义评测方案。',
  },
};

function formatPercent(numerator, denominator) {
  if (!denominator) return '0.0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function unique(items) {
  return Array.from(new Set(items));
}

function metricLabel(metricId) {
  return METRIC_BY_ID.get(metricId)?.label || metricId;
}

function metricCategory(metricId) {
  return METRIC_BY_ID.get(metricId)?.category || '';
}

export function getAgentEvaluationMetric(metricId) {
  return METRIC_BY_ID.get(metricId) || null;
}

export function normalizeSelectedEvaluationMetrics(metrics) {
  const valid = unique((metrics || []).filter((metricId) => METRIC_BY_ID.has(metricId)));
  return valid.length ? valid : [...DEFAULT_AGENT_EVALUATION_METRICS];
}

export function selectAgentEvaluationPlan(metrics) {
  const selectedMetrics = normalizeSelectedEvaluationMetrics(metrics);
  const hasLinkMetric = selectedMetrics.some((metricId) => metricCategory(metricId) === 'link_state');
  const hasSemanticMetric = selectedMetrics.some((metricId) => metricCategory(metricId) === 'semantic');
  const info = hasLinkMetric
    ? PLAN_INFO.planA_link_state
    : hasSemanticMetric
    ? PLAN_INFO.planB_semantic
    : PLAN_INFO.builtin_rules;

  return {
    ...info,
    selectedMetrics,
    availableMetrics: AGENT_EVALUATION_METRIC_GROUPS,
  };
}

function countWhere(cases, predicate) {
  return (cases || []).filter(predicate).length;
}

function hasAnyField(item, fields) {
  return fields.some((field) => {
    const value = item?.[field];
    return value != null && value !== '' && value !== false;
  });
}

function buildMetric(metricId, status, patch = {}) {
  return {
    metricId,
    label: metricLabel(metricId),
    status,
    ...patch,
  };
}

function buildBuiltInMetric(cases, metricId) {
  const total = cases.length;
  const passed = countWhere(cases, (item) => item?.success === true);
  if (metricId === 'case_pass_rate' || metricId === 'task_completion') {
    return buildMetric(metricId, 'calculated', {
      passed,
      total,
      score: formatPercent(passed, total),
      evidenceCount: total,
      message: `${passed}/${total} 轮通过`,
    });
  }

  const asserted = countWhere(cases, (item) => hasAnyField(item, ['expectedResult', 'expectedResponseText', 'responseTtsText']));
  return buildMetric(metricId, 'calculated', {
    passed: asserted,
    total,
    score: formatPercent(asserted, total),
    evidenceCount: asserted,
    message: asserted ? `检测到 ${asserted} 条可用于关键词/期望结果核查的记录` : '未检测到关键词或期望结果字段',
  });
}

const LINK_METRIC_CONFIG = {
  wakeup: {
    fields: ['speakerWakeStatus', 'wakeAudioPlayStatus', 'wakeEventTime'],
    success: (item) => item?.speakerWakeStatus === 'success' || item?.wakeAudioPlayStatus === 'completed',
    missing: '当前勾选了【唤醒成功率】，但未检测到 wake_success / speakerWakeStatus 埋点，该指标无法计算，请补充唤醒成功事件埋点。',
  },
  asr: {
    fields: ['asrMatchResult', 'actualAsrText', 'asrStatus', 'inputChainPassed'],
    success: (item) => item?.inputChainPassed === true || item?.asrMatchResult === 'matched' || item?.asrStatus === 'success',
    missing: '当前勾选了【ASR 成功率】，但未检测到 asr_success / asr_text 埋点，该指标无法计算，请补充 ASR 结果事件埋点。',
  },
  tts: {
    fields: ['responseTtsText', 'speakerResponseText', 'responseTtsMatchedLine'],
    success: (item) => hasAnyField(item, ['responseTtsText', 'speakerResponseText', 'responseTtsMatchedLine']),
    missing: '当前勾选了【TTS 文本核查】，但未检测到 tts_text 或 Speaker 响应文本，该指标无法计算，请补充 TTS 文本埋点。',
  },
  tts_play_complete: {
    fields: ['ttsPlayComplete', 'tts_play_complete', 'responseTtsPlayComplete'],
    success: (item) => item?.ttsPlayComplete === true || item?.tts_play_complete === true || item?.responseTtsPlayComplete === true,
    missing: '当前勾选了【TTS 完播率】，但未检测到 tts_play_complete 埋点，该指标无法计算，请补充播放完成事件埋点。',
  },
  response_complete: {
    fields: ['responseComplete', 'response_complete', 'responseTtsStatus', 'responseFinishReason'],
    success: (item) => (
      item?.responseComplete === true
      || item?.response_complete === true
      || String(item?.responseTtsStatus || '').includes('complete')
      || String(item?.responseFinishReason || '').includes('complete')
    ),
    missing: '当前勾选了【response_complete】，但未检测到 response_complete 埋点，该指标无法计算，请补充响应完成事件埋点。',
  },
};

function buildLinkMetric(cases, metricId) {
  const config = LINK_METRIC_CONFIG[metricId];
  const evidenceCount = countWhere(cases, (item) => hasAnyField(item, config.fields));
  if (!evidenceCount) {
    return buildMetric(metricId, 'missing_instrumentation', {
      passed: 0,
      total: cases.length,
      score: '/',
      evidenceCount,
      message: config.missing,
      missingMessage: config.missing,
    });
  }

  const passed = countWhere(cases, config.success);
  return buildMetric(metricId, 'calculated', {
    passed,
    total: cases.length,
    score: formatPercent(passed, cases.length),
    evidenceCount,
    message: `${passed}/${cases.length} 轮链路证据通过`,
  });
}

function buildSemanticMetric(metricId) {
  return buildMetric(metricId, 'pending_model', {
    score: '/',
    evidenceCount: 0,
    message: 'MVP 阶段不直接调用大模型；请通过已配置的大模型评测链路生成结构化语义评分。',
  });
}

function buildFailureStages(cases) {
  const result = {};
  for (const item of cases || []) {
    if (item?.success !== false) continue;
    const stage = item?.failStage || item?.responseFailStage || item?.wakeFailStage || 'UNKNOWN';
    result[stage] = (result[stage] || 0) + 1;
  }
  return result;
}

export function evaluateAgentReport(cases = [], metrics) {
  const safeCases = Array.isArray(cases) ? cases : [];
  const plan = selectAgentEvaluationPlan(metrics);
  const selectedMetrics = plan.selectedMetrics.filter((metricId) => metricCategory(metricId) === plan.category);
  const effectiveMetrics = selectedMetrics.length ? selectedMetrics : plan.selectedMetrics;
  const metricResults = effectiveMetrics.map((metricId) => {
    const category = metricCategory(metricId);
    if (category === 'link_state') return buildLinkMetric(safeCases, metricId);
    if (category === 'semantic') return buildSemanticMetric(metricId);
    return buildBuiltInMetric(safeCases, metricId);
  });
  const passedTurns = countWhere(safeCases, (item) => item?.success === true);
  const missingMessages = metricResults
    .map((item) => item.missingMessage)
    .filter(Boolean);

  return {
    plan,
    metrics: metricResults,
    missingMessages,
    summary: {
      totalTurns: safeCases.length,
      passedTurns,
      failedTurns: Math.max(0, safeCases.length - passedTurns),
      passRate: formatPercent(passedTurns, safeCases.length),
      failureStages: buildFailureStages(safeCases),
    },
  };
}
