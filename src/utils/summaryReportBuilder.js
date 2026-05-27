export const SUMMARY_REPORT_STORAGE_KEY = 'voiceauto_summary_report_v1';
export const SUMMARY_REPORT_EVENT = 'voiceauto-summary-report-updated';

const MISSING = '/';

const SUBMISSION_PARAMS = [
  { name: 'Cedar TV APP', value: 'v1.6.0' },
  { name: 'Cedar Speaker APP', value: 'v1.6.0' },
  { name: 'Cedar 服务', value: 'v1.6.0' },
  { name: '魔童端', value: 'v1.6.0' },
  { name: 'Gemini-flash版本', value: 'v2.0' },
  { name: 'Gemini-live', value: 'v2.0' },
  { name: 'XHome', value: 'v4.1' },
  { name: '温度 / Gemini-flash', value: '0' },
  { name: '温度 / Gemini-live', value: '0.9' },
  { name: 'TTS(中) / 豆包', value: MISSING },
  { name: 'TTS(英) / 微软', value: MISSING },
  { name: 'STT / 微软', value: MISSING },
  { name: '提示词语言 / 中文/英文', value: MISSING },
  { name: '测试环境 / Cedar', value: 'POC' },
  { name: '测试环境 / XHome', value: 'UAT' },
  { name: '租户ID', value: MISSING },
  { name: '用户ID', value: MISSING },
  { name: '家庭ID', value: MISSING },
];

function normalizeLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeComparable(value) {
  return normalizeLine(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function valueOrSlash(value) {
  const text = normalizeLine(value);
  return text || MISSING;
}

function rawValue(value) {
  const text = normalizeLine(value);
  return text || '';
}

function formatPercent(numerator, denominator) {
  if (!denominator) return MISSING;
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function isAtLeastSimilarity(similarityText, threshold) {
  const numeric = Number(String(similarityText || '').replace('%', ''));
  return Number.isFinite(numeric) && numeric >= threshold;
}

function parseMs(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function formatMs(value) {
  const num = parseMs(value);
  if (num == null) return MISSING;
  return `${num.toFixed(1)}ms`;
}

function formatDurationCell(value) {
  const num = parseMs(value);
  if (num == null) return MISSING;
  return Number(num.toFixed(1));
}

function resolveModuleName(testAudio) {
  return valueOrSlash(
    testAudio?.module
    || testAudio?.tapdPlanDirectory
    || testAudio?.tapdCategoryName
    || testAudio?.caseDirectory
    || '未分类'
  );
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length];
}

function similarity(a, b) {
  const left = normalizeComparable(a);
  const right = normalizeComparable(b);
  const maxLen = Math.max(left.length, right.length);
  if (!maxLen) return 0;
  return Math.max(0, 1 - (levenshteinDistance(left, right) / maxLen));
}

function firstPresent(source, fields) {
  for (const field of fields) {
    const value = rawValue(source?.[field]);
    if (value) return value;
  }
  return '';
}

function resolveCaseId(testAudio, index) {
  const explicit = firstPresent(testAudio, ['case_id', 'caseId', 'testCaseId', 'tapdCaseAudioId']);
  if (explicit) return explicit;

  const tapdCaseId = rawValue(testAudio?.tapdCaseId);
  const humanIndex = rawValue(testAudio?.humanIndex);
  if (tapdCaseId && humanIndex) return `${tapdCaseId}_${humanIndex}`;
  if (tapdCaseId) return tapdCaseId;

  return rawValue(testAudio?.id) || `case_${index + 1}`;
}

function resolveRowRunId(row) {
  return firstPresent(row, ['run_id', 'runId', 'test_run_id', 'testRunId']);
}

function resolveRowCaseId(row) {
  return firstPresent(row, ['case_id', 'caseId', 'test_case_id', 'testCaseId']);
}

function resolveRowAudioFile(row) {
  return firstPresent(row, ['audio_file', 'audioFile']);
}

function resolveRowTimestamp(row) {
  return firstPresent(row, ['timestamp', 'startTime', 'createdAt', 'traceTimestamp']);
}

function resolveActualInput(row) {
  return valueOrSlash(firstPresent(row, ['InputText', 'actual_input_text', 'actualInputText', 'input_text', 'inputText']));
}

function resolveHitAgent(row) {
  return valueOrSlash(firstPresent(row, [
    'final_agent',
    'finalAgent',
    'primary_hit_agent',
    'primaryHitAgent',
    'hit_agent',
    'hitAgent',
    'AgentCode',
    'agent_code',
    'agentCode',
  ]));
}

function resolveExecutionRecord(records, audio, audioIndex, caseId) {
  const list = Array.isArray(records) ? records : [];
  const byCase = list.find((item) => rawValue(item?.caseId || item?.case_id) === caseId);
  if (byCase) return byCase;

  const audioId = rawValue(audio?.id);
  if (audioId) {
    const byAudio = list.find((item) => rawValue(item?.audioId) === audioId);
    if (byAudio) return byAudio;
  }

  return list.find((item) => Number(item?.listIndex) === audioIndex || Number(item?.index) === audioIndex) || null;
}

function toTime(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function assignRowsToAudios(audios, rows, options = {}) {
  const { executionRecords = [], runId = '' } = options;
  const assignments = new Array((audios || []).length).fill(null);
  const usedRowIndexes = new Set();

  const assign = (audioIndex, rowIndex, similarityScore, matchedBy, matchStatus = '已对齐') => {
    if (assignments[audioIndex] || usedRowIndexes.has(rowIndex)) return false;
    assignments[audioIndex] = {
      row: rows[rowIndex],
      similarity: similarityScore,
      matchedBy,
      matchStatus,
    };
    usedRowIndexes.add(rowIndex);
    return true;
  };

  // 1. 强匹配：run_id + case_id。若日志暂未写入 run_id，则退化为 case_id。
  for (let audioIndex = 0; audioIndex < (audios || []).length; audioIndex += 1) {
    const caseId = resolveCaseId(audios[audioIndex], audioIndex);
    if (!caseId) continue;

    let bestRowIndex = -1;
    for (let rowIndex = 0; rowIndex < (rows || []).length; rowIndex += 1) {
      if (usedRowIndexes.has(rowIndex)) continue;
      const row = rows[rowIndex];
      const rowCaseId = resolveRowCaseId(row);
      if (!rowCaseId || rowCaseId !== caseId) continue;
      const rowRunId = resolveRowRunId(row);
      const reportRunId = rawValue(runId);
      if (reportRunId && rowRunId && reportRunId !== rowRunId) continue;
      bestRowIndex = rowIndex;
      break;
    }

    if (bestRowIndex >= 0) {
      const row = rows[bestRowIndex];
      const method = rawValue(runId) && resolveRowRunId(row) ? 'run_id+case_id' : 'case_id';
      assign(audioIndex, bestRowIndex, similarity(audios[audioIndex]?.text, resolveActualInput(row)), method);
    }
  }

  // 2. 中匹配：audio_file 或播放时间窗口。
  for (let audioIndex = 0; audioIndex < (audios || []).length; audioIndex += 1) {
    if (assignments[audioIndex]) continue;
    const audio = audios[audioIndex];
    const caseId = resolveCaseId(audio, audioIndex);
    const record = resolveExecutionRecord(executionRecords, audio, audioIndex, caseId);
    const audioFile = rawValue(record?.audioFile || audio?.audioFile);

    if (audioFile) {
      const rowIndex = (rows || []).findIndex((row, idx) => (
        !usedRowIndexes.has(idx)
        && resolveRowAudioFile(row)
        && resolveRowAudioFile(row) === audioFile
      ));
      if (rowIndex >= 0) {
        assign(audioIndex, rowIndex, similarity(audio?.text, resolveActualInput(rows[rowIndex])), 'audio_file');
        continue;
      }
    }

    const playStartTime = toTime(record?.playStartTime);
    const playEndTime = toTime(record?.playEndTime);
    if (playStartTime == null || playEndTime == null) continue;

    const windowStart = playStartTime - 2000;
    const windowEnd = playEndTime + 10000;
    let best = null;
    for (let rowIndex = 0; rowIndex < (rows || []).length; rowIndex += 1) {
      if (usedRowIndexes.has(rowIndex)) continue;
      const rowTime = toTime(resolveRowTimestamp(rows[rowIndex]));
      if (rowTime == null || rowTime < windowStart || rowTime > windowEnd) continue;
      const distance = Math.abs(rowTime - playEndTime);
      if (!best || distance < best.distance) best = { rowIndex, distance };
    }

    if (best) {
      assign(audioIndex, best.rowIndex, similarity(audio?.text, resolveActualInput(rows[best.rowIndex])), '时间窗口');
    }
  }

  const candidates = [];

  // 3. 弱匹配：文本相似度，仅作为日志缺少 case_id 时的兜底。
  for (let audioIndex = 0; audioIndex < (audios || []).length; audioIndex += 1) {
    if (assignments[audioIndex]) continue;
    for (let rowIndex = 0; rowIndex < (rows || []).length; rowIndex += 1) {
      if (usedRowIndexes.has(rowIndex)) continue;
      const score = similarity(audios[audioIndex]?.text, resolveActualInput(rows[rowIndex]));
      if (score >= 0.9) {
        candidates.push({ audioIndex, rowIndex, score });
      }
    }
  }

  candidates
    .sort((a, b) => b.score - a.score)
    .forEach((item) => {
      assign(item.audioIndex, item.rowIndex, item.score, '文本相似度');
    });

  // 4. 最后兜底：按照当前列表顺序一一使用剩余日志，避免重复占用同一条日志。
  let fallbackCursor = 0;
  for (let audioIndex = 0; audioIndex < assignments.length; audioIndex += 1) {
    if (assignments[audioIndex]) continue;
    while (fallbackCursor < (rows || []).length && usedRowIndexes.has(fallbackCursor)) {
      fallbackCursor += 1;
    }
    if (fallbackCursor >= (rows || []).length) break;

    const row = rows[fallbackCursor];
    assign(audioIndex, fallbackCursor, similarity(audios[audioIndex]?.text, resolveActualInput(row)), '顺序兜底');
    fallbackCursor += 1;
  }

  return assignments;
}

function resolveTargetAgent(testAudio) {
  const direct = valueOrSlash(
    testAudio?.targetAgent
    || testAudio?.target_agent
    || testAudio?.expectedAgent
    || testAudio?.agentCode
    || testAudio?.AgentCode
  );
  if (direct !== MISSING) return direct;

  const sources = [
    testAudio?.expectedResult,
    testAudio?.expectation,
    testAudio?.tapdSteps,
    testAudio?.steps,
    testAudio?.tapdTestPlanName,
    testAudio?.tapdPlanDirectory,
    testAudio?.tapdCategoryName,
    testAudio?.module,
    testAudio?.caseTitle,
  ];

  for (const source of sources) {
    const text = normalizeLine(source);
    if (!text) continue;

    const explicitMatch = text.match(/(?:目标\s*agent|目标Agent|target\s*agent|期望\s*agent|预期\s*agent|命中\s*agent|AgentCode|agent_code|agent)\s*[:：=]\s*([A-Za-z0-9_-]+)/i);
    if (explicitMatch?.[1]) return valueOrSlash(explicitMatch[1]);

    const routeMatch = text.match(/(?:路由到|命中到|进入|调用)\s*([A-Za-z][A-Za-z0-9_-]*(?:_agent|Agent))/i);
    if (routeMatch?.[1]) return valueOrSlash(routeMatch[1]);

    const codeMatch = text.match(/(?:^|[\s【\[\(（])([A-Za-z][A-Za-z0-9_-]*(?:_agent|Agent))(?=$|[\s】\]\)）])/);
    if (codeMatch?.[1]) return valueOrSlash(codeMatch[1]);
  }

  return MISSING;
}

function getImportedPlans(testAudios) {
  const plans = [];
  const seen = new Set();
  for (const audio of testAudios || []) {
    const plan = valueOrSlash(audio?.tapdTestPlanName);
    if (plan === MISSING || seen.has(plan)) continue;
    seen.add(plan);
    plans.push(plan);
  }
  return plans;
}

function getTestOwners(testAudios) {
  const owners = [];
  const seen = new Set();
  for (const audio of testAudios || []) {
    const owner = valueOrSlash(audio?.tapdTestPlanOwner || audio?.testPlanOwner || audio?.owner);
    if (owner === MISSING || seen.has(owner)) continue;
    seen.add(owner);
    owners.push(owner);
  }
  return owners;
}

function formatTime(value) {
  if (!value) return MISSING;
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return MISSING;
  }
}

function firstRowValue(rows, fields) {
  for (const row of rows || []) {
    for (const field of fields) {
      const value = valueOrSlash(row?.[field]);
      if (value !== MISSING) return value;
    }
  }
  return MISSING;
}

function buildSubmissionParams(rows) {
  const autoValues = {
    租户ID: firstRowValue(rows, ['tenantid', 'tenant_id', 'tenantId']),
    用户ID: firstRowValue(rows, ['user_id', 'userId', 'uid']),
    家庭ID: firstRowValue(rows, ['family_id', 'family_uuid', 'familyId', 'familyUuid']),
  };

  return SUBMISSION_PARAMS.map((item) => ({
    ...item,
    value: autoValues[item.name] || item.value,
  }));
}

export function buildSummaryReportText(report) {
  const safeReport = report || {};
  const params = Array.isArray(safeReport.submissionParams) ? safeReport.submissionParams : [];
  const modules = Array.isArray(safeReport.moduleStats || safeReport.moduleAverages)
    ? (safeReport.moduleStats || safeReport.moduleAverages)
    : [];
  const cases = Array.isArray(safeReport.reportRows || safeReport.caseDetails)
    ? (safeReport.reportRows || safeReport.caseDetails)
    : [];

  const moduleLines = modules.length > 0
    ? modules.map((item) => `- ${valueOrSlash(item.module)}: agent命中率 ${valueOrSlash(item.agentHitRate)}，平均耗时 ${valueOrSlash(item.avgResponseText || formatMs(item.avgResponseMs))}（${valueOrSlash(item.caseCount)} 条）`).join('\n')
    : '- 无可用数据';
  const caseLines = cases.length > 0
    ? cases.map((item, index) => `- ${item.index || index + 1}. 用例ID: ${valueOrSlash(item.caseId)} | 目标文本: ${valueOrSlash(item.testAudioText)} | 目标Agent: ${valueOrSlash(item.targetAgent)} | 实际输入: ${valueOrSlash(item.logInputText)} | 命中Agent: ${valueOrSlash(item.actualAgent)} | Agent是否命中: ${valueOrSlash(item.agentMatched)} | 文本匹配状态: ${valueOrSlash(item.textMatchStatus)} | 匹配方式: ${valueOrSlash(item.matchMethod)} | 结论: ${valueOrSlash(item.testResult)} | 输出: ${valueOrSlash(item.logOutput)} | VadDuration: ${valueOrSlash(item.vadDuration)} | ASRDuration: ${valueOrSlash(item.asrDuration)} | TTSDuration: ${valueOrSlash(item.ttsDuration)} | LLMDuration: ${valueOrSlash(item.llmDuration)} | FirstToken: ${valueOrSlash(item.firstTokenDuration)}`).join('\n')
    : '- 无可用数据';
  const errorLines = cases.length > 0
    ? cases.map((item, index) => {
      const error = valueOrSlash(item.logError);
      const summary = valueOrSlash(item.logSummary);
      return `- ${item.index || index + 1}. ${valueOrSlash(item.caseTitle)} | 错误信息: ${error} | 异常信息: ${summary}`;
    }).join('\n')
    : '- 无可用数据';

  return [
    'VoiceAuto 总结报告',
    `生成时间: ${valueOrSlash(safeReport.generatedAtText)}`,
    `测试批次ID: ${valueOrSlash(safeReport.runId)}`,
    `测试环境: ${valueOrSlash(safeReport.testEnvironment)}`,
    `日志时间范围: ${valueOrSlash(safeReport.rangeText)}`,
    `测试时间: ${valueOrSlash(safeReport.testTime)}`,
    `测试负责人: ${valueOrSlash(safeReport.testOwner)}`,
    `导入的测试计划: ${Array.isArray(safeReport.importedPlans) && safeReport.importedPlans.length ? safeReport.importedPlans.join('、') : MISSING}`,
    `用例总数: ${valueOrSlash(safeReport.totalCases)}`,
    `用例执行数量: ${valueOrSlash(safeReport.executedCases)}`,
    `用例执行率: ${valueOrSlash(safeReport.executionRate)}`,
    `执行通过率: ${valueOrSlash(safeReport.passRate)}`,
    '',
    '提测参数:',
    params.length > 0
      ? params.map((item) => `- ${valueOrSlash(item.name)}: ${valueOrSlash(item.value)}`).join('\n')
      : '- 无可用数据',
    '',
    '功能模块统计:',
    moduleLines,
    `Agent总命中率: ${valueOrSlash(safeReport.overallAgentHitRate)}`,
    `整体平均耗时: ${valueOrSlash(safeReport.overallAvgResponseText || formatMs(safeReport.overallAvgResponseMs))}`,
    '',
    '错误信息:',
    errorLines,
    '',
    '报告表格:',
    caseLines,
  ].join('\n');
}

export function buildSummaryReportPayload({
  sessionRows,
  testAudios,
  envLabel,
  envKey,
  range,
  testReport,
}) {
  const safeRows = Array.isArray(sessionRows) ? sessionRows : [];
  const safeAudios = Array.isArray(testAudios) ? testAudios : [];
  const totalCases = safeAudios.length;
  const executedCases = safeRows.length || Number(testReport?.cases?.length || 0);
  const executionRate = formatPercent(executedCases, totalCases);
  const importedPlans = getImportedPlans(safeAudios);
  const testOwners = getTestOwners(safeAudios);
  const generatedAt = Date.now();
  const generatedAtText = formatTime(generatedAt);
  const testEnvironment = `${envLabel || envKey || MISSING}${envKey ? ` (${envKey})` : ''}`;
  const rangeText = range?.fromDate && range?.fromTime && range?.toDate && range?.toTime
    ? `${range.fromDate} ${range.fromTime} -> ${range.toDate} ${range.toTime}`
    : MISSING;
  const testTime = testReport?.firstTestAudioTime || testReport?.startTime || testReport?.endTime
    ? `${formatTime(testReport?.firstTestAudioTime || testReport?.startTime)} -> ${formatTime(testReport?.lastTestAudioTime || testReport?.endTime)}`
    : rangeText;

  const moduleMap = new Map();
  const reportRunId = valueOrSlash(testReport?.runId || testReport?.run_id);
  const executionRecords = Array.isArray(testReport?.cases) ? testReport.cases : [];
  const rowAssignments = assignRowsToAudios(safeAudios, safeRows, {
    executionRecords,
    runId: reportRunId === MISSING ? '' : reportRunId,
  });
  const reportRows = safeAudios.map((audio, index) => {
    const assignment = rowAssignments[index];
    const row = assignment?.row || null;
    const inputSimilarity = assignment ? `${(assignment.similarity * 100).toFixed(1)}%` : MISSING;
    const matchMethod = assignment?.matchedBy || '无日志';
    const textMatchStatus = assignment
      ? (isAtLeastSimilarity(inputSimilarity, 90) ? '文本相似' : '已对齐')
      : '未匹配到日志';
    const caseId = resolveCaseId(audio, index);
    const moduleName = resolveModuleName(audio);
    const vadDuration = formatDurationCell(row?.['first_token.vad_duration']);
    const asrDuration = formatDurationCell(row?.['first_token.asr_duration']);
    const ttsDuration = formatDurationCell(row?.['first_token.tts_duration']);
    const llmDuration = formatDurationCell(row?.['first_token.llm_duration']);
    const firstTokenDuration = ttsDuration !== MISSING && llmDuration !== MISSING
      ? Number((Number(ttsDuration) + Number(llmDuration)).toFixed(1))
      : MISSING;
    const responseMs = firstTokenDuration !== MISSING ? firstTokenDuration : parseMs(row?.['first_token.total']);
    const targetAgent = resolveTargetAgent(audio);
    const actualAgent = resolveHitAgent(row);
    const hasComparableAgent = targetAgent !== MISSING && actualAgent !== MISSING;
    const agentMatched = hasComparableAgent
      ? normalizeComparable(targetAgent) === normalizeComparable(actualAgent)
      : null;
    const testPassed = agentMatched === true;

    if (!moduleMap.has(moduleName)) {
      moduleMap.set(moduleName, {
        module: moduleName,
        caseCount: 0,
        responseCount: 0,
        responseTotalMs: 0,
        comparableAgentCount: 0,
        matchedAgentCount: 0,
      });
    }
    const moduleItem = moduleMap.get(moduleName);
    moduleItem.caseCount += 1;
    if (responseMs != null) {
      moduleItem.responseCount += 1;
      moduleItem.responseTotalMs += responseMs;
    }
    moduleItem.comparableAgentCount += 1;
    if (testPassed) {
      moduleItem.matchedAgentCount += 1;
    }

    return {
      index: index + 1,
      runId: reportRunId,
      caseId,
      sessionID: valueOrSlash(row?.sessionID),
      testAudioText: valueOrSlash(audio?.text),
      logInputText: resolveActualInput(row),
      inputSimilarity,
      textMatchStatus,
      matchMethod,
      caseTitle: valueOrSlash(audio?.caseTitle || audio?.name || audio?.text),
      module: moduleName,
      responseMs,
      responseText: formatMs(responseMs),
      targetAgent,
      actualAgent,
      agentMatched: agentMatched == null ? MISSING : (agentMatched ? '一致' : '不一致'),
      vadDuration,
      asrDuration,
      ttsDuration,
      llmDuration,
      firstTokenDuration,
      testPassed,
      testResult: testPassed ? '通过' : '不通过',
      logOutput: valueOrSlash(row?.['output.content']),
      logError: valueOrSlash(row?.error),
      logSummary: valueOrSlash(row?.异常信息),
    };
  });

  const moduleStats = Array.from(moduleMap.values())
    .map((item) => ({
      module: item.module,
      caseCount: item.caseCount,
      avgResponseMs: item.responseCount > 0
        ? Number((item.responseTotalMs / item.responseCount).toFixed(1))
        : null,
      avgResponseText: item.responseCount > 0
        ? formatMs(item.responseTotalMs / item.responseCount)
        : MISSING,
      agentHitRate: formatPercent(item.matchedAgentCount, item.comparableAgentCount),
      matchedAgentCount: item.matchedAgentCount,
      comparableAgentCount: item.comparableAgentCount,
    }))
    .sort((a, b) => a.module.localeCompare(b.module, 'zh-CN'));

  const passedCases = reportRows.filter((item) => item.testPassed).length;
  const failedCases = Math.max(0, reportRows.length - passedCases);
  const passRate = reportRows.length > 0 ? formatPercent(passedCases, reportRows.length) : MISSING;

  const responseValues = reportRows.map((item) => item.responseMs).filter((value) => value != null);
  const overallAvgResponseMs = responseValues.length > 0
    ? Number((responseValues.reduce((sum, value) => sum + value, 0) / responseValues.length).toFixed(1))
    : null;
  const comparableAgentCount = moduleStats.reduce((sum, item) => sum + item.comparableAgentCount, 0);
  const matchedAgentCount = moduleStats.reduce((sum, item) => sum + item.matchedAgentCount, 0);
  const caseDetails = reportRows;
  const inputSimilarityPairs = reportRows.filter((item) => isAtLeastSimilarity(item.inputSimilarity, 90));

  const payload = {
    generatedAt,
    generatedAtText,
    runId: reportRunId,
    testEnvironment,
    rangeText,
    testTime,
    testOwner: testOwners.length ? testOwners.join('、') : MISSING,
    importedPlans,
    totalCases,
    executedCases,
    executionRate,
    passedCases,
    failedCases,
    passRate,
    submissionParams: buildSubmissionParams(safeRows),
    moduleStats,
    moduleAverages: moduleStats,
    overallAgentHitRate: formatPercent(matchedAgentCount, comparableAgentCount),
    overallAvgResponseMs,
    overallAvgResponseText: overallAvgResponseMs == null ? MISSING : formatMs(overallAvgResponseMs),
    caseDetails,
    reportRows,
    inputSimilarityPairs,
  };

  return {
    ...payload,
    text: buildSummaryReportText(payload),
  };
}
