import * as XLSX from 'xlsx';

export const SUMMARY_REPORT_STORAGE_KEY = 'voiceauto_summary_report_v1';
export const SUMMARY_REPORT_EVENT = 'voiceauto-summary-report-updated';

const MISSING = '/';

const SUBMISSION_PARAMS = [
  { category: '模型配置', name: '大模型厂商', value: 'Gemini' },
  { category: '模型配置', name: '模型版本', value: 'v2.0' },
  { category: '模型配置', name: '模型温度', value: '0' },
  { category: '模型配置', name: 'Live模型厂商', value: 'Gemini' },
  { category: '模型配置', name: 'Live模型版本', value: 'v2.0' },
  { category: '模型配置', name: 'Live模型温度', value: '0.9' },
  { category: '语音识别配置', group: 'Speaker', name: '中文TTS', value: MISSING },
  { category: '语音识别配置', group: 'Speaker', name: '中文ASR', value: MISSING },
  { category: '语音识别配置', group: 'Speaker', name: '英文TTS', value: MISSING },
  { category: '语音识别配置', group: 'Speaker', name: '英文ASR', value: MISSING },
  { category: '语音识别配置', group: '魔童', name: '中文TTS', value: MISSING },
  { category: '语音识别配置', group: '魔童', name: '中文ASR', value: MISSING },
  { category: '语音识别配置', group: '魔童', name: '英文TTS', value: MISSING },
  { category: '语音识别配置', group: '魔童', name: '英文ASR', value: MISSING },
];

const SUBMISSION_PARAM_CATEGORY_ORDER = [
  '模型配置',
  '语音识别配置',
];

const SUBMISSION_PARAM_GROUP_ORDER = {
  语音识别配置: ['Speaker', '魔童'],
};

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

function normalizeParamKeyPart(value) {
  return normalizeLine(value)
    .toLowerCase()
    .replace(/[（）]/g, (char) => (char === '（' ? '(' : ')'))
    .replace(/[\s/:：=_\-—–|,，.。()（）[\]【】]+/g, '');
}

function submissionParamIdentity(param) {
  return [
    normalizeParamKeyPart(param?.category),
    normalizeParamKeyPart(param?.group),
    normalizeParamKeyPart(param?.name),
  ].join('|');
}

const SUBMISSION_PARAM_TEMPLATE_BY_ID = new Map(
  SUBMISSION_PARAMS.map((item) => [submissionParamIdentity(item), item])
);

const SUBMISSION_PARAM_ALIASES = [
  ['模型配置', '', '大模型厂商', ['大模型厂商', '模型厂商', 'llm厂商', 'gemini厂商', 'geminiflash厂商']],
  ['模型配置', '', '模型版本', ['模型版本', '大模型版本', 'geminiflash版本', 'gemini-flash版本', 'geminiflash', 'gemini-flash']],
  ['模型配置', '', '模型温度', ['模型温度', '大模型温度', 'temperaturegeminiflash', '温度geminiflash', '温度gemini-flash']],
  ['模型配置', '', 'Live模型厂商', ['live模型厂商', 'geminilive厂商', 'gemini-live厂商', 'live厂商']],
  ['模型配置', '', 'Live模型版本', ['live模型版本', 'geminilive版本', 'gemini-live版本', 'geminilive', 'gemini-live']],
  ['模型配置', '', 'Live模型温度', ['live模型温度', 'temperaturegeminilive', '温度geminilive', '温度gemini-live']],
  ['语音识别配置', 'Speaker', '中文TTS', ['speaker中文tts', 'cedarspeaker中文tts', 'tts中豆包', 'tts中文豆包', '中文tts']],
  ['语音识别配置', 'Speaker', '中文ASR', ['speaker中文asr', 'cedarspeaker中文asr', 'stt微软', 'asr中文微软', '中文asr']],
  ['语音识别配置', 'Speaker', '英文TTS', ['speaker英文tts', 'cedarspeaker英文tts', 'tts英微软', 'tts英文微软', '英文tts']],
  ['语音识别配置', 'Speaker', '英文ASR', ['speaker英文asr', 'cedarspeaker英文asr', 'asr英文微软', '英文asr']],
  ['语音识别配置', '魔童', '中文TTS', ['魔童中文tts', '魔童端中文tts']],
  ['语音识别配置', '魔童', '中文ASR', ['魔童中文asr', '魔童端中文asr']],
  ['语音识别配置', '魔童', '英文TTS', ['魔童英文tts', '魔童端英文tts']],
  ['语音识别配置', '魔童', '英文ASR', ['魔童英文asr', '魔童端英文asr']],
];

const SUBMISSION_PARAM_ALIAS_BY_KEY = new Map();
for (const [category, group, name, aliases] of SUBMISSION_PARAM_ALIASES) {
  const template = SUBMISSION_PARAM_TEMPLATE_BY_ID.get(submissionParamIdentity({ category, group, name }));
  if (!template) continue;
  for (const alias of aliases) {
    SUBMISSION_PARAM_ALIAS_BY_KEY.set(normalizeParamKeyPart(alias), template);
  }
}

function findSubmissionParamTemplate(param) {
  const explicitTemplate = SUBMISSION_PARAM_TEMPLATE_BY_ID.get(submissionParamIdentity(param));
  if (explicitTemplate) return explicitTemplate;

  const category = normalizeLine(param?.category);
  const group = normalizeLine(param?.group);
  const name = normalizeLine(param?.name);
  const combinedNames = [
    name,
    `${category}${group}${name}`,
    `${group}${name}`,
  ].filter(Boolean);

  for (const candidate of combinedNames) {
    const template = SUBMISSION_PARAM_ALIAS_BY_KEY.get(normalizeParamKeyPart(candidate));
    if (template) return template;
  }

  return null;
}

export function normalizeSubmissionParams(params) {
  const valueById = new Map(SUBMISSION_PARAMS.map((item) => [submissionParamIdentity(item), item.value]));

  for (const item of params || []) {
    const template = findSubmissionParamTemplate(item);
    if (!template) continue;
    valueById.set(submissionParamIdentity(template), valueOrSlash(item.value));
  }

  return SUBMISSION_PARAMS.map((item) => ({
    ...item,
    value: valueById.get(submissionParamIdentity(item)) || item.value,
  }));
}

export function categorizeSubmissionParams(params) {
  const groups = new Map();
  for (const item of normalizeSubmissionParams(params)) {
    const category = item.category;
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category).push(item);
  }

  return Array.from(groups.entries())
    .map(([category, items]) => {
      const groupNames = SUBMISSION_PARAM_GROUP_ORDER[category] || [];
      const subGroups = [];
      const grouped = new Map();
      for (const item of items) {
        const groupName = normalizeLine(item.group);
        if (!groupName) continue;
        if (!grouped.has(groupName)) grouped.set(groupName, []);
        grouped.get(groupName).push(item);
      }
      for (const groupName of groupNames) {
        const groupItems = grouped.get(groupName);
        if (groupItems?.length) subGroups.push({ group: groupName, items: groupItems });
      }
      for (const [groupName, groupItems] of grouped.entries()) {
        if (!groupNames.includes(groupName)) subGroups.push({ group: groupName, items: groupItems });
      }
      return { category, items, subGroups };
    })
    .sort((a, b) => {
      const left = SUBMISSION_PARAM_CATEGORY_ORDER.indexOf(a.category);
      const right = SUBMISSION_PARAM_CATEGORY_ORDER.indexOf(b.category);
      const leftOrder = left >= 0 ? left : SUBMISSION_PARAM_CATEGORY_ORDER.length;
      const rightOrder = right >= 0 ? right : SUBMISSION_PARAM_CATEGORY_ORDER.length;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return a.category.localeCompare(b.category, 'zh-CN');
    });
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
  return firstPresent(row, ['trace_time', 'timestamp', 'startTime', 'createdAt', 'traceTimestamp']);
}

function resolveActualInput(row) {
  return valueOrSlash(firstPresent(row, ['actual_input_text', 'InputText', 'actualInputText', 'input_text', 'inputText']));
}

function resolveHitAgent(row) {
  return valueOrSlash(firstPresent(row, [
    'hit_agent',
    'hitAgent',
    'final_agent',
    'finalAgent',
    'primary_hit_agent',
    'primaryHitAgent',
    'AgentCode',
    'agent_code',
    'agentCode',
  ]));
}

function resolveHitSubAgent(row) {
  return valueOrSlash(firstPresent(row, ['hit_sub_agent', 'hitSubAgent', 'sub_agent', 'subAgent']));
}

function resolveLogOutput(row) {
  return valueOrSlash(firstPresent(row, ['response_text', 'output.content']));
}

function resolveLogError(row) {
  return valueOrSlash(firstPresent(row, ['error_message', 'error']));
}

function resolveExecutionRecord(records, audio, audioIndex, caseId) {
  if (audio?.executionRecord) return audio.executionRecord;

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

function findAudioForExecutionRecord(audios, record) {
  const audioId = rawValue(record?.audioId);
  if (audioId) {
    const byAudioId = (audios || []).find((audio) => rawValue(audio?.id) === audioId);
    if (byAudioId) return byAudioId;
  }

  const recordCaseId = rawValue(record?.caseId || record?.case_id);
  if (recordCaseId) {
    const byCaseId = (audios || []).find((audio, index) => resolveCaseId(audio, index) === recordCaseId);
    if (byCaseId) return byCaseId;
  }

  const listIndex = Number(record?.listIndex);
  if (Number.isInteger(listIndex) && listIndex >= 0 && listIndex < (audios || []).length) {
    return audios[listIndex];
  }

  return null;
}

function buildExecutedReportAudios(audios, executionRecords) {
  const records = Array.isArray(executionRecords) ? executionRecords : [];
  if (records.length === 0) return [];

  return records.map((record, index) => {
    const audio = findAudioForExecutionRecord(audios, record) || {};
    const recordText = rawValue(record?.targetText || record?.text);
    const recordCaseId = rawValue(record?.caseId || record?.case_id);

    return {
      ...audio,
      id: rawValue(audio?.id) || rawValue(record?.audioId) || `executed_audio_${index + 1}`,
      text: recordText || audio?.text || '',
      targetAgent: rawValue(record?.targetAgent) || audio?.targetAgent || audio?.expectedAgent || '',
      caseId: recordCaseId || audio?.caseId || audio?.case_id || '',
      audioFile: rawValue(record?.audioFile) || audio?.audioFile || '',
      executionRecord: record,
    };
  });
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
    模型版本: firstRowValue(rows, ['model_version', 'modelVersion', 'llm_model']),
    Live模型版本: firstRowValue(rows, ['live_model_version', 'liveModelVersion']),
  };

  return normalizeSubmissionParams(SUBMISSION_PARAMS.map((item) => ({
    ...item,
    value: autoValues[item.name] || item.value,
  })));
}

function tableCell(value) {
  return valueOrSlash(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function breakSentencesForExport(value) {
  const text = valueOrSlash(value);
  if (text === MISSING) return text;
  return text
    .replace(/([。.!?！？；;])\s*/g, '$1\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function buildMarkdownTable(headers, rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const importantIndexes = new Set(options.importantIndexes || []);
  const headerLine = `| ${headers.map(tableCell).join(' | ')} |`;
  const dividerLine = `| ${headers.map(() => '---').join(' | ')} |`;
  if (safeRows.length === 0) {
    return [headerLine, dividerLine, `| ${headers.map((_, index) => (index === 0 ? '无可用数据' : '/')).join(' | ')} |`].join('\n');
  }
  const rowLines = safeRows.map((row) => `| ${row.map((cell, index) => {
    const value = tableCell(cell);
    return importantIndexes.has(index) ? `**${value}**` : value;
  }).join(' | ')} |`);
  return [headerLine, dividerLine, ...rowLines].join('\n');
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
  const paramGroups = categorizeSubmissionParams(params);

  const overviewRows = [
    ['生成时间', safeReport.generatedAtText],
    ['测试批次ID', safeReport.runId],
    ['测试环境', safeReport.testEnvironment],
    ['日志时间范围', safeReport.rangeText],
    ['测试时间', safeReport.testTime],
    ['测试负责人', safeReport.testOwner],
    ['导入的测试计划', Array.isArray(safeReport.importedPlans) && safeReport.importedPlans.length ? safeReport.importedPlans.join('、') : MISSING],
    ['用例总数', safeReport.totalCases],
    ['用例执行数量', safeReport.executedCases],
    ['用例执行率', safeReport.executionRate],
    ['执行通过率', safeReport.passRate],
    ['Agent总命中率', safeReport.overallAgentHitRate],
    ['整体平均耗时', safeReport.overallAvgResponseText || formatMs(safeReport.overallAvgResponseMs)],
  ];
  const paramSections = paramGroups.length > 0
    ? paramGroups.map((group) => [
      `### ${group.category}`,
      '',
      group.subGroups?.length
        ? group.subGroups.map((subGroup) => [
          `#### ${subGroup.group}`,
          '',
          buildMarkdownTable(['参数', '值'], subGroup.items.map((item) => [item.name, item.value])),
        ].join('\n')).join('\n\n')
        : buildMarkdownTable(['参数', '值'], group.items.map((item) => [item.name, item.value])),
    ].join('\n')).join('\n\n')
    : buildMarkdownTable(['参数', '值'], []);
  const moduleRows = modules.map((item) => [
    item.module,
    item.caseCount,
    item.agentHitRate,
    item.avgResponseText || formatMs(item.avgResponseMs),
  ]);
  const errorRows = cases
    .filter((item) => valueOrSlash(item.logError) !== MISSING || valueOrSlash(item.logSummary) !== MISSING || item.testPassed === false)
    .map((item, index) => [
      item.index || index + 1,
      item.caseId,
      item.caseTitle || item.testAudioText,
      item.testResult,
      item.logStatus,
      item.logError,
      item.logSummary,
    ]);
  const detailRows = cases.map((item, index) => [
    item.index || index + 1,
    item.caseId,
    item.module,
    item.testAudioText,
    breakSentencesForExport(item.logInputText),
    breakSentencesForExport(item.logOutput),
    item.targetAgent,
    item.actualAgent,
    item.actualSubAgent,
    item.agentMatched,
    item.testResult,
    item.responseText || formatMs(item.responseMs),
    item.logError,
    item.inputSimilarity,
    item.textMatchStatus,
    item.matchMethod,
    item.logStatus,
    item.vadDuration,
    item.asrDuration,
    item.ttsDuration,
    item.llmDuration,
    item.firstTokenDuration,
  ]);

  return [
    '# VoiceAuto 总结报告',
    '',
    '## 一、报告概览',
    '',
    buildMarkdownTable(['项目', '内容'], overviewRows),
    '',
    '## 二、提测参数',
    '',
    paramSections,
    '',
    '## 三、功能模块统计',
    '',
    buildMarkdownTable(['功能模块', '用例数', 'Agent命中率', '平均耗时'], moduleRows),
    '',
    '## 四、错误信息',
    '',
    buildMarkdownTable(['序号', '用例ID', '用例名称', '结论', '日志状态', '错误信息', '异常信息'], errorRows),
    '',
    '## 五、测试明细',
    '',
    buildMarkdownTable([
      '序号',
      '用例ID',
      '功能模块',
      '目标文本',
      '实际输入',
      '输出',
      '目标Agent',
      '命中Agent',
      '命中子Agent',
      'Agent是否命中',
      '结论',
      '响应耗时',
      '错误信息',
      '文本相似度',
      '文本匹配状态',
      '匹配方式',
      '日志状态',
      'VadDuration',
      'ASRDuration',
      'TTSDuration',
      'LLMDuration',
      'FirstToken',
    ], detailRows, { importantIndexes: [4, 5, 6, 7, 9, 10, 11, 12] }),
  ].join('\n');
}

function escapeHtml(value) {
  return valueOrSlash(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
}

function buildHtmlTable(headers, rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const importantIndexes = new Set(options.importantIndexes || []);
  const wideIndexes = new Set(options.wideIndexes || []);
  const bodyRows = safeRows.length > 0 ? safeRows : [headers.map((_, index) => (index === 0 ? '无可用数据' : MISSING))];
  const classNameForIndex = (index) => [
    importantIndexes.has(index) ? 'highlight-col' : '',
    wideIndexes.has(index) ? 'wide-text-col' : '',
  ].filter(Boolean).join(' ');
  return [
    '<table>',
    '<thead>',
    `<tr>${headers.map((header, index) => `<th class="${classNameForIndex(index)}">${escapeHtml(header)}</th>`).join('')}</tr>`,
    '</thead>',
    '<tbody>',
    ...bodyRows.map((row) => `<tr>${row.map((cell, index) => `<td class="${classNameForIndex(index)}">${escapeHtml(cell)}</td>`).join('')}</tr>`),
    '</tbody>',
    '</table>',
  ].join('');
}

export function buildSummaryReportHtml(report) {
  const safeReport = report || {};
  const params = Array.isArray(safeReport.submissionParams) ? safeReport.submissionParams : [];
  const modules = Array.isArray(safeReport.moduleStats || safeReport.moduleAverages)
    ? (safeReport.moduleStats || safeReport.moduleAverages)
    : [];
  const cases = Array.isArray(safeReport.reportRows || safeReport.caseDetails)
    ? (safeReport.reportRows || safeReport.caseDetails)
    : [];
  const paramGroups = categorizeSubmissionParams(params);

  const overviewRows = [
    ['生成时间', safeReport.generatedAtText],
    ['测试批次ID', safeReport.runId],
    ['测试环境', safeReport.testEnvironment],
    ['日志时间范围', safeReport.rangeText],
    ['测试时间', safeReport.testTime],
    ['测试负责人', safeReport.testOwner],
    ['导入的测试计划', Array.isArray(safeReport.importedPlans) && safeReport.importedPlans.length ? safeReport.importedPlans.join('、') : MISSING],
    ['用例总数', safeReport.totalCases],
    ['用例执行数量', safeReport.executedCases],
    ['用例执行率', safeReport.executionRate],
    ['执行通过率', safeReport.passRate],
    ['Agent总命中率', safeReport.overallAgentHitRate],
    ['整体平均耗时', safeReport.overallAvgResponseText || formatMs(safeReport.overallAvgResponseMs)],
  ];
  const paramHtml = paramGroups.length > 0
    ? paramGroups.map((group) => [
      `<h3 class="subsection-title">${escapeHtml(group.category)}</h3>`,
      group.subGroups?.length
        ? group.subGroups.map((subGroup) => [
          `<h4 class="param-group-title">${escapeHtml(subGroup.group)}</h4>`,
          `<div class="table-wrap">${buildHtmlTable(['参数', '值'], subGroup.items.map((item) => [item.name, item.value]))}</div>`,
        ].join('')).join('')
        : `<div class="table-wrap">${buildHtmlTable(['参数', '值'], group.items.map((item) => [item.name, item.value]))}</div>`,
    ].join('')).join('')
    : `<div class="table-wrap">${buildHtmlTable(['参数', '值'], [])}</div>`;
  const moduleRows = modules.map((item) => [
    item.module,
    item.caseCount,
    item.agentHitRate,
    item.avgResponseText || formatMs(item.avgResponseMs),
  ]);
  const errorRows = cases
    .filter((item) => valueOrSlash(item.logError) !== MISSING || valueOrSlash(item.logSummary) !== MISSING || item.testPassed === false)
    .map((item, index) => [
      item.index || index + 1,
      item.caseId,
      item.caseTitle || item.testAudioText,
      item.testResult,
      item.logStatus,
      item.logError,
      item.logSummary,
    ]);
  const detailRows = cases.map((item, index) => [
    item.index || index + 1,
    item.caseId,
    item.module,
    item.testAudioText,
    breakSentencesForExport(item.logInputText),
    breakSentencesForExport(item.logOutput),
    item.targetAgent,
    item.actualAgent,
    item.actualSubAgent,
    item.agentMatched,
    item.testResult,
    item.responseText || formatMs(item.responseMs),
    item.logError,
    item.inputSimilarity,
    item.textMatchStatus,
    item.matchMethod,
    item.logStatus,
    item.vadDuration,
    item.asrDuration,
    item.ttsDuration,
    item.llmDuration,
    item.firstTokenDuration,
  ]);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>VoiceAuto 总结报告</title>
  <style>
    body { margin: 0; padding: 32px; color: #1f2937; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    main { max-width: 1280px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 8px; font-size: 28px; color: #111827; }
    h2 { margin: 28px 0 12px; font-size: 18px; color: #111827; border-left: 4px solid #2563eb; padding-left: 10px; }
    .subsection-title { margin: 18px 0 8px; font-size: 14px; color: #1e3a8a; }
    .param-group-title { margin: 12px 0 8px; font-size: 13px; color: #374151; }
    .meta { margin: 0 0 24px; color: #6b7280; font-size: 13px; }
    .table-wrap { overflow-x: auto; margin-bottom: 16px; border: 1px solid #e5e7eb; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; background: #fff; }
    th { background: #f3f4f6; color: #374151; text-align: left; font-weight: 600; white-space: nowrap; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 9px 10px; vertical-align: top; line-height: 1.55; }
    tr:last-child td { border-bottom: 0; }
    td { color: #374151; word-break: break-word; }
    .highlight-col { background: #eff6ff; color: #1e3a8a; font-weight: 600; }
    .wide-text-col { min-width: 320px; max-width: 520px; white-space: normal; }
    @media print {
      body { background: #fff; padding: 0; }
      main { box-shadow: none; border: 0; border-radius: 0; max-width: none; }
      .table-wrap { overflow: visible; }
    }
  </style>
</head>
<body>
  <main>
    <h1>VoiceAuto 总结报告</h1>
    <p class="meta">生成时间：${escapeHtml(safeReport.generatedAtText)}</p>
    <h2>一、报告概览</h2>
    <div class="table-wrap">${buildHtmlTable(['项目', '内容'], overviewRows)}</div>
    <h2>二、提测参数</h2>
    ${paramHtml}
    <h2>三、功能模块统计</h2>
    <div class="table-wrap">${buildHtmlTable(['功能模块', '用例数', 'Agent命中率', '平均耗时'], moduleRows)}</div>
    <h2>四、错误信息</h2>
    <div class="table-wrap">${buildHtmlTable(['序号', '用例ID', '用例名称', '结论', '日志状态', '错误信息', '异常信息'], errorRows)}</div>
    <h2>五、测试明细</h2>
    <div class="table-wrap">${buildHtmlTable([
      '序号',
      '用例ID',
      '功能模块',
      '目标文本',
      '实际输入',
      '输出',
      '目标Agent',
      '命中Agent',
      '命中子Agent',
      'Agent是否命中',
      '结论',
      '响应耗时',
      '错误信息',
      '文本相似度',
      '文本匹配状态',
      '匹配方式',
      '日志状态',
      'VadDuration',
      'ASRDuration',
      'TTSDuration',
      'LLMDuration',
      'FirstToken',
    ], detailRows, { importantIndexes: [4, 5, 6, 7, 9, 10, 11, 12], wideIndexes: [4, 5] })}</div>
  </main>
</body>
</html>`;
}

function styleWorksheet(ws, columnWidths = [], options = {}) {
  ws['!cols'] = columnWidths.map((width) => ({ wch: width }));
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const importantColumns = new Set(options.importantColumns || []);
  const headerRows = new Set(options.headerRows || [0]);
  const sectionRows = new Set(options.sectionRows || []);
  const titleRows = new Set(options.titleRows || []);
  const headerFill = 'E5E7EB';
  const sectionFill = 'DBEAFE';
  const titleFill = '1E3A8A';
  const importantFill = 'EFF6FF';

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const ref = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[ref];
      if (!cell) continue;
      const isHeader = headerRows.has(row);
      const isSection = sectionRows.has(row);
      const isTitle = titleRows.has(row);
      const isImportant = importantColumns.has(col);
      cell.s = {
        font: {
          name: 'Microsoft YaHei',
          bold: isHeader || isSection || isTitle || isImportant,
          color: { rgb: isTitle ? 'FFFFFF' : (isImportant || isSection ? '1E3A8A' : '1F2937') },
        },
        fill: isHeader || isImportant || isSection || isTitle
          ? { fgColor: { rgb: isTitle ? titleFill : (isSection ? sectionFill : (isHeader ? headerFill : importantFill)) } }
          : undefined,
        alignment: {
          vertical: 'top',
          horizontal: isTitle || isSection || isHeader ? 'center' : 'left',
          wrapText: true,
        },
      };
    }
  }

  if (range.e.r >= 1 && range.e.c >= 0) {
    ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  }
  ws['!rows'] = Array.from({ length: range.e.r + 1 }, (_, index) => ({
    hpt: titleRows.has(index) ? 30 : (headerRows.has(index) || sectionRows.has(index) ? 24 : 48),
  }));
  if (options.merges) {
    ws['!merges'] = options.merges;
  }
  if (options.freeze) {
    ws['!freeze'] = options.freeze;
  }
}

function sheetFromRows(rows, columnWidths, options = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['无可用数据']]);
  styleWorksheet(ws, columnWidths, options);
  return ws;
}

function percentNumber(value) {
  const numeric = Number(String(valueOrSlash(value)).replace('%', ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function buildConclusionSummary(report, failedCount) {
  const passRate = percentNumber(report?.passRate);
  const agentHitRate = percentNumber(report?.overallAgentHitRate);
  if (failedCount > 0) {
    return `本次测试存在 ${failedCount} 条未通过/异常用例，建议优先查看“错误信息”和“重点数据”Sheet定位失败原因。`;
  }
  if (passRate != null && passRate >= 95 && agentHitRate != null && agentHitRate >= 95) {
    return '本次测试整体表现良好，执行通过率与 Agent 命中率均达到较高水平，可作为向上汇报的通过结论。';
  }
  return '本次测试已完成，请结合执行通过率、Agent 命中率和模块统计判断是否满足发布要求。';
}

function buildDashboardSheet(report, modules, errorRows) {
  const failedCount = Number(report?.failedCases) || Math.max(0, errorRows.length - 1);
  const dashboardModules = modules.slice(0, 12);
  const failureSectionRow = 13 + dashboardModules.length;
  const failureHeaderRow = failureSectionRow + 1;
  const dashboardRows = [
    ['VoiceAuto 测试报告', '', '', '', '', ''],
    [`生成时间：${valueOrSlash(report?.generatedAtText)}`, `测试环境：${valueOrSlash(report?.testEnvironment)}`, `测试批次：${valueOrSlash(report?.runId)}`, '', '', ''],
    ['', '', '', '', '', ''],
    ['核心指标', '', '', '', '', ''],
    ['用例总数', '执行数量', '执行率', '通过率', 'Agent命中率', '整体平均耗时'],
    [
      valueOrSlash(report?.totalCases),
      valueOrSlash(report?.executedCases),
      valueOrSlash(report?.executionRate),
      valueOrSlash(report?.passRate),
      valueOrSlash(report?.overallAgentHitRate),
      valueOrSlash(report?.overallAvgResponseText || formatMs(report?.overallAvgResponseMs)),
    ],
    ['', '', '', '', '', ''],
    ['结论摘要', '', '', '', '', ''],
    [buildConclusionSummary(report, failedCount), '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['功能模块统计', '', '', '', '', ''],
    ['功能模块', '用例数', 'Agent命中率', '平均耗时', '', ''],
    ...dashboardModules.map((item) => [
      valueOrSlash(item.module),
      valueOrSlash(item.caseCount),
      valueOrSlash(item.agentHitRate),
      valueOrSlash(item.avgResponseText || formatMs(item.avgResponseMs)),
      '',
      '',
    ]),
    ['', '', '', '', '', ''],
    ['失败/错误摘要', '', '', '', '', ''],
    ['序号', '用例ID', '用例名称', '结论', '错误信息', '异常信息'],
    ...errorRows.slice(1, 11).map((row) => row.slice(0, 6)),
  ];
  const ws = sheetFromRows(dashboardRows, [18, 18, 20, 18, 18, 56], {
    titleRows: [0],
    sectionRows: [3, 7, 10, failureSectionRow],
    headerRows: [4, 11, failureHeaderRow],
    importantColumns: [2, 3, 4, 5],
    merges: [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } },
      { s: { r: 7, c: 0 }, e: { r: 7, c: 5 } },
      { s: { r: 8, c: 0 }, e: { r: 8, c: 5 } },
      { s: { r: 10, c: 0 }, e: { r: 10, c: 5 } },
      { s: { r: failureSectionRow, c: 0 }, e: { r: failureSectionRow, c: 5 } },
    ],
  });
  ws['!rows'] = (ws['!rows'] || []).map((row, index) => ({
    ...row,
    hpt: index === 0 ? 34 : (index === 8 ? 54 : row.hpt),
  }));
  return ws;
}

export function exportSummaryReportExcel(report, filename) {
  const safeReport = report || {};
  const params = Array.isArray(safeReport.submissionParams) ? safeReport.submissionParams : [];
  const modules = Array.isArray(safeReport.moduleStats || safeReport.moduleAverages)
    ? (safeReport.moduleStats || safeReport.moduleAverages)
    : [];
  const cases = Array.isArray(safeReport.reportRows || safeReport.caseDetails)
    ? (safeReport.reportRows || safeReport.caseDetails)
    : [];

  const overviewRows = [
    ['项目', '内容'],
    ['生成时间', valueOrSlash(safeReport.generatedAtText)],
    ['测试批次ID', valueOrSlash(safeReport.runId)],
    ['测试环境', valueOrSlash(safeReport.testEnvironment)],
    ['日志时间范围', valueOrSlash(safeReport.rangeText)],
    ['测试时间', valueOrSlash(safeReport.testTime)],
    ['测试负责人', valueOrSlash(safeReport.testOwner)],
    ['导入的测试计划', Array.isArray(safeReport.importedPlans) && safeReport.importedPlans.length ? safeReport.importedPlans.join('、') : MISSING],
    ['用例总数', valueOrSlash(safeReport.totalCases)],
    ['用例执行数量', valueOrSlash(safeReport.executedCases)],
    ['用例执行率', valueOrSlash(safeReport.executionRate)],
    ['执行通过率', valueOrSlash(safeReport.passRate)],
    ['Agent总命中率', valueOrSlash(safeReport.overallAgentHitRate)],
    ['整体平均耗时', valueOrSlash(safeReport.overallAvgResponseText || formatMs(safeReport.overallAvgResponseMs))],
  ];
  const paramRows = [
    ['分类', '分组', '参数', '值'],
    ...categorizeSubmissionParams(params).flatMap((group) => (
      group.items.map((item) => [
        group.category,
        valueOrSlash(item.group),
        valueOrSlash(item.name),
        valueOrSlash(item.value),
      ])
    )),
  ];
  const moduleRows = [
    ['功能模块', '用例数', 'Agent命中率', '平均耗时'],
    ...modules.map((item) => [
      valueOrSlash(item.module),
      valueOrSlash(item.caseCount),
      valueOrSlash(item.agentHitRate),
      valueOrSlash(item.avgResponseText || formatMs(item.avgResponseMs)),
    ]),
  ];
  const errorRows = [
    ['序号', '用例ID', '用例名称', '结论', '日志状态', '错误信息', '异常信息'],
    ...cases
      .filter((item) => valueOrSlash(item.logError) !== MISSING || valueOrSlash(item.logSummary) !== MISSING || item.testPassed === false)
      .map((item, index) => [
        item.index || index + 1,
        valueOrSlash(item.caseId),
        valueOrSlash(item.caseTitle || item.testAudioText),
        valueOrSlash(item.testResult),
        valueOrSlash(item.logStatus),
        valueOrSlash(item.logError),
        valueOrSlash(item.logSummary),
      ]),
  ];
  const keyRows = [
    ['序号', '用例ID', '实际输入', '输出', '目标Agent', '命中Agent', 'Agent是否命中', '结论', '响应耗时', '错误信息'],
    ...cases.map((item, index) => [
      item.index || index + 1,
      valueOrSlash(item.caseId),
      breakSentencesForExport(item.logInputText),
      breakSentencesForExport(item.logOutput),
      valueOrSlash(item.targetAgent),
      valueOrSlash(item.actualAgent),
      valueOrSlash(item.agentMatched),
      valueOrSlash(item.testResult),
      valueOrSlash(item.responseText || formatMs(item.responseMs)),
      valueOrSlash(item.logError),
    ]),
  ];
  const detailRows = [
    [
      '序号',
      '用例ID',
      '功能模块',
      '目标文本',
      '实际输入',
      '输出',
      '目标Agent',
      '命中Agent',
      '命中子Agent',
      'Agent是否命中',
      '结论',
      '响应耗时',
      '错误信息',
      '文本相似度',
      '文本匹配状态',
      '匹配方式',
      '日志状态',
      'VadDuration',
      'ASRDuration',
      'TTSDuration',
      'LLMDuration',
      'FirstToken',
    ],
    ...cases.map((item, index) => [
      item.index || index + 1,
      valueOrSlash(item.caseId),
      valueOrSlash(item.module),
      valueOrSlash(item.testAudioText),
      breakSentencesForExport(item.logInputText),
      breakSentencesForExport(item.logOutput),
      valueOrSlash(item.targetAgent),
      valueOrSlash(item.actualAgent),
      valueOrSlash(item.actualSubAgent),
      valueOrSlash(item.agentMatched),
      valueOrSlash(item.testResult),
      valueOrSlash(item.responseText || formatMs(item.responseMs)),
      valueOrSlash(item.logError),
      valueOrSlash(item.inputSimilarity),
      valueOrSlash(item.textMatchStatus),
      valueOrSlash(item.matchMethod),
      valueOrSlash(item.logStatus),
      valueOrSlash(item.vadDuration),
      valueOrSlash(item.asrDuration),
      valueOrSlash(item.ttsDuration),
      valueOrSlash(item.llmDuration),
      valueOrSlash(item.firstTokenDuration),
    ]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildDashboardSheet(safeReport, modules, errorRows), '汇报看板');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(overviewRows, [24, 90], { importantColumns: [1] }), '报告概览');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(paramRows, [20, 18, 28, 42], { importantColumns: [0, 1, 3] }), '提测参数');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(moduleRows, [30, 12, 18, 18], { importantColumns: [2, 3] }), '功能模块统计');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(errorRows, [8, 22, 46, 12, 16, 90, 70], { importantColumns: [3, 5, 6] }), '错误信息');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(keyRows, [8, 22, 64, 90, 24, 24, 16, 12, 16, 90], { importantColumns: [2, 3, 4, 5, 6, 7, 8, 9] }), '重点数据');
  XLSX.utils.book_append_sheet(wb, sheetFromRows(detailRows, [8, 22, 20, 42, 64, 90, 24, 24, 22, 16, 12, 16, 90, 14, 16, 16, 14, 14, 14, 14, 14, 14], { importantColumns: [4, 5, 6, 7, 9, 10, 11, 12] }), '测试明细');
  XLSX.writeFile(wb, filename);
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
  const executionRecords = Array.isArray(testReport?.cases) ? testReport.cases : [];
  const reportAudios = buildExecutedReportAudios(safeAudios, executionRecords);
  const totalCases = reportAudios.length;
  const executedCases = reportAudios.length;
  const executionRate = formatPercent(executedCases, totalCases);
  const importedPlans = getImportedPlans(reportAudios);
  const testOwners = getTestOwners(reportAudios);
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
  const rowAssignments = assignRowsToAudios(reportAudios, safeRows, {
    executionRecords,
    runId: reportRunId === MISSING ? '' : reportRunId,
  });
  const reportRows = reportAudios.map((audio, index) => {
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
    const actualSubAgent = resolveHitSubAgent(row);
    const hasComparableAgent = targetAgent !== MISSING && (actualAgent !== MISSING || actualSubAgent !== MISSING);
    const agentMatched = hasComparableAgent
      ? normalizeComparable(targetAgent) === normalizeComparable(actualAgent)
        || normalizeComparable(targetAgent) === normalizeComparable(actualSubAgent)
      : null;
    const logStatus = valueOrSlash(row?.log_status);
    const testPassed = logStatus !== 'error' && agentMatched === true;

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
      actualSubAgent,
      agentMatched: agentMatched == null ? MISSING : (agentMatched ? '一致' : '不一致'),
      vadDuration,
      asrDuration,
      ttsDuration,
      llmDuration,
      firstTokenDuration,
      testPassed,
      testResult: testPassed ? '通过' : '不通过',
      logOutput: resolveLogOutput(row),
      logError: resolveLogError(row),
      logSummary: valueOrSlash(row?.异常信息),
      logStatus,
      agentSource: valueOrSlash(row?.agent_source),
      agentConfidence: valueOrSlash(row?.agent_confidence),
      agentCandidates: valueOrSlash(row?.agent_candidates),
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
