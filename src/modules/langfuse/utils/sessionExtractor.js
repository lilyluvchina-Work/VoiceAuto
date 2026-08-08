/**
 * 日志 Session 提取器
 * 按 sessionID 聚合 Traces 和 Observations，生成提取行
 */

// ─── 字段定义 ───
export const INPUT_FIELDS = [
  'tenantid', 'family_id', 'family_uuid', 'device_id', 'device_type',
  'user_id', 'userId', 'uid', 'run_id', 'runId', 'case_id', 'caseId',
  'play_index', 'playIndex', 'audio_file', 'audioFile',
  'request_id', 'tts_code', 'stt_code', 'tts_voice', 'live_model',
  'llm_model', 'app_id',
];

export const FIRST_TOKEN_DURATIONS = ['vad_duration', 'asr_duration', 'tts_duration', 'llm_duration'];

/**
 * 尝试将 JSON 字符串解析为对象，非字符串或解析失败则原样返回
 */
function parseIfString(val) {
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return val; }
}

/**
 * 在对象中深度查找 key，最多查 maxDepth 层，返回第一个非 null/undefined 的值
 */
function deepFind(obj, key, maxDepth = 3) {
  if (maxDepth <= 0 || obj == null || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  if (key in obj && obj[key] != null) return obj[key];
  for (const v of Object.values(obj)) {
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      const r = deepFind(v, key, maxDepth - 1);
      if (r != null) return r;
    }
  }
  return undefined;
}

function deepFindAny(value, key, maxDepth = 4) {
  if (maxDepth <= 0 || value == null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = deepFindAny(item, key, maxDepth - 1);
      if (result != null) return result;
    }
    return undefined;
  }
  if (key in value && value[key] != null) return value[key];
  for (const child of Object.values(value)) {
    const result = deepFindAny(child, key, maxDepth - 1);
    if (result != null) return result;
  }
  return undefined;
}

/**
 * 从 trace 中解析 input 字段
 * 查找顺序：trace.input（深度2） → trace.metadata（深度2）
 */
function resolveInputField(trace, field) {
  const rawInput = parseIfString(trace.input);
  if (rawInput != null && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    const v = deepFind(rawInput, field, 2);
    if (v != null) return v;
  }
  const meta = trace.metadata;
  if (meta != null && typeof meta === 'object') {
    const v = deepFind(meta, field, 2);
    if (v != null) return v;
  }
  return '';
}

/**
 * 从 observation 中提取 first_token duration 字段
 * 查找顺序：input.field → output.first_token.field → output.field → metadata.first_token.field → metadata.field
 */
function resolveDuration(obs, field) {
  // input 字段
  const inp = parseIfString(obs?.input);
  if (inp != null && typeof inp === 'object' && !Array.isArray(inp)) {
    if (field in inp) return inp[field];
    if (inp.first_token != null && typeof inp.first_token === 'object' && field in inp.first_token) {
      return inp.first_token[field];
    }
  }
  const out = parseIfString(obs?.output);
  if (out != null && typeof out === 'object' && !Array.isArray(out)) {
    if (out.first_token != null && typeof out.first_token === 'object' && field in out.first_token) {
      return out.first_token[field];
    }
    if (field in out) return out[field];
  }
  const meta = obs?.metadata;
  if (meta != null && typeof meta === 'object') {
    if (meta.first_token != null && typeof meta.first_token === 'object' && field in meta.first_token) {
      return meta.first_token[field];
    }
    if (field in meta) return meta[field];
  }
  return undefined;
}

function resolveObservationValue(obs, fields) {
  const sources = [
    parseIfString(obs?.input_data ?? obs?.inputData),
    parseIfString(obs?.input),
    parseIfString(obs?.output_data ?? obs?.outputData),
    parseIfString(obs?.output),
    obs?.metadata,
  ];

  for (const source of sources) {
    if (source == null || typeof source !== 'object') continue;
    for (const field of fields) {
      const direct = deepFindAny(source, field, 4);
      if (direct != null && direct !== '') return direct;
    }
  }

  return '';
}

function stringifyError(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => stringifyError(item)).filter(Boolean).join('\n').trim();
  }
  if (typeof value === 'object') {
    const candidate =
      value.message
      ?? value.msg
      ?? value.error
      ?? value.reason
      ?? value.detail
      ?? value.description;
    const normalized = stringifyError(candidate);
    if (normalized) return normalized;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

function isFullAnswerObservation(obs) {
  const obsName = String(obs?.name || '').toLowerCase();
  return obsName === 'full_answer'
    || obsName === 'full-answer'
    || obsName.includes('full_answer')
    || obsName.includes('full-answer');
}

function isErrorObservation(obs) {
  return String(obs?.name || '').toLowerCase().includes('[error]');
}

function resolveOutputContent(obs) {
  if (obs?.output == null) return '';

  const out = parseIfString(obs.output);
  if (typeof out === 'string') return isFullAnswerObservation(obs) ? out.trim() : '';
  if (out == null || typeof out !== 'object') return '';

  if (Array.isArray(out)) {
    return out
      .map((item) => stringifyError(item?.content ?? item?.message?.content ?? item?.text ?? item))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  const fullAnswer =
    out['full-answer']
    ?? out.fullAnswer
    ?? out.full_answer
    ?? out.message?.['full-answer']
    ?? out.message?.fullAnswer
    ?? out.message?.full_answer;

  if (Array.isArray(fullAnswer)) {
    const joined = fullAnswer
      .map((item) => stringifyError(item?.content ?? item?.text ?? item))
      .filter(Boolean)
      .join('\n')
      .trim();
    if (joined) return joined;
  } else {
    const fromFullAnswer = stringifyError(fullAnswer?.content ?? fullAnswer?.text ?? fullAnswer);
    if (fromFullAnswer) return fromFullAnswer;
  }

  // 兼容截图场景：observation 名称为 full_answer，content 直接挂在 output.content
  if (isFullAnswerObservation(obs)) {
    return stringifyError(out.content ?? out.message?.content ?? out.text);
  }

  return stringifyError(out.content ?? out.message?.content ?? out.text ?? out.output?.content);
}

function resolveObservationError(obs) {
  if (!isErrorObservation(obs)) return '';

  const outputData = parseIfString(obs?.output_data ?? obs?.outputData ?? obs?.output);
  return resolveErrorContent(outputData);
}

function resolveErrorContent(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => resolveErrorContent(item))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof value === 'object') {
    const direct = stringifyError(
      value.content
      ?? value.message?.content
      ?? value.output?.content
      ?? value.text
    );
    if (direct) return direct;

    const fallback = stringifyError(
      value.message
      ?? value.error
      ?? value.reason
      ?? value.detail
      ?? value.description
    );
    if (fallback) return fallback;
  }

  return '';
}

function getEventName(obs) {
  return String(obs?.name || '').trim();
}

function getEventNameLower(obs) {
  return getEventName(obs).toLowerCase();
}

function nameIncludes(obs, keyword) {
  return getEventNameLower(obs).includes(String(keyword || '').toLowerCase());
}

function findLatestObservation(observations, predicate) {
  for (let i = (observations || []).length - 1; i >= 0; i -= 1) {
    if (predicate(observations[i])) return observations[i];
  }
  return null;
}

function findObservations(observations, predicate) {
  return (observations || []).filter(predicate);
}

function parseAgentFromName(obs) {
  const match = getEventName(obs).match(/^\[[^\]]+\]\s*:\s*(.+)$/);
  return String(match?.[1] || '').trim();
}

function resolveTraceValue(trace, fields) {
  const sources = [
    parseIfString(trace?.input),
    trace?.metadata,
    parseIfString(trace?.output),
  ];

  for (const source of sources) {
    if (source == null || typeof source !== 'object') continue;
    for (const field of fields) {
      const value = deepFindAny(source, field, 4);
      if (value != null && value !== '') return value;
    }
  }

  return '';
}

function stripMessageName(trace) {
  const name = String(trace?.name || '').trim();
  return name.replace(/^\[message\]\s*:\s*/i, '').trim();
}

function isAlphaNumericMachineInput(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /^[A-Za-z0-9]+$/.test(text)
    && /[A-Za-z]/.test(text)
    && /\d/.test(text);
}

function resolveAgentCodeFromObservation(obs) {
  return String(
    resolveObservationValue(obs, ['agent_code', 'agentCode', 'AgentCode', 'agent'])
    || parseAgentFromName(obs)
    || ''
  ).trim();
}

function pushUniqueAgentCode(list, seen, value) {
  const agentCode = String(value || '').trim();
  if (!agentCode || seen.has(agentCode)) return;
  seen.add(agentCode);
  list.push(agentCode);
}

function collectAgentCodesFromRouterResult(value, list = [], seen = new Set()) {
  const parsed = parseIfString(value);
  if (parsed == null || parsed === '') return list;

  if (typeof parsed === 'string' || typeof parsed === 'number') {
    String(parsed)
      .split(/\s*(?:\/|,|，|;|；|\|)\s*/)
      .forEach((item) => pushUniqueAgentCode(list, seen, item));
    return list;
  }

  if (Array.isArray(parsed)) {
    parsed.forEach((item) => collectAgentCodesFromRouterResult(item, list, seen));
    return list;
  }

  if (typeof parsed !== 'object') return list;

  const directAgent = parsed.agent_code
    ?? parsed.agentCode
    ?? parsed.AgentCode
    ?? parsed.agent
    ?? parsed.agent_name
    ?? parsed.agentName
    ?? parsed.name;
  if (directAgent != null) pushUniqueAgentCode(list, seen, directAgent);

  [
    'agents',
    'agent_list',
    'agentList',
    'selected_agents',
    'selectedAgents',
    'route_agents',
    'routeAgents',
    'results',
    'result',
    'candidates',
  ].forEach((field) => {
    if (parsed[field] != null) collectAgentCodesFromRouterResult(parsed[field], list, seen);
  });

  return list;
}

function isRouterResultObservation(obs) {
  return nameIncludes(obs, '[router_result]') || nameIncludes(obs, 'router_result');
}

function resolveRouterResultContent(obs) {
  const outputData = parseIfString(obs?.output_data ?? obs?.outputData ?? obs?.output);
  if (outputData == null) return '';
  if (typeof outputData === 'object' && !Array.isArray(outputData) && 'content' in outputData) {
    return outputData.content;
  }
  return '';
}

function resolveRouterResultAgents(sortedObs) {
  for (let i = (sortedObs || []).length - 1; i >= 0; i -= 1) {
    const obs = sortedObs[i];
    const routerResult = isRouterResultObservation(obs)
      ? (resolveRouterResultContent(obs) || resolveObservationValue(obs, ['router_result', 'routerResult']))
      : resolveObservationValue(obs, ['router_result', 'routerResult']);
    const agents = collectAgentCodesFromRouterResult(routerResult);
    if (agents.length > 0) return agents;
  }
  return [];
}

function resolveInputTextFromInputTextObservation(obs) {
  const outputData = parseIfString(obs?.output_data ?? obs?.outputData ?? obs?.output);
  return resolveErrorContent(outputData);
}

function resolveActualInputText(trace, sortedObs) {
  const asrFinal = findLatestObservation(sortedObs, (obs) => nameIncludes(obs, '[asr]: final'));
  if (asrFinal) {
    const value = resolveObservationValue(asrFinal, [
      'recognized_text',
      'recognizedText',
      'actual_input_text',
      'actualInputText',
      'text',
    ]);
    if (value) return String(value).trim();
  }

  const inputTextObs = findLatestObservation(sortedObs, (obs) => nameIncludes(obs, '[input_text]'));
  if (inputTextObs) {
    const value = resolveInputTextFromInputTextObservation(inputTextObs);
    if (value) return value;
  }

  const traceText = resolveTraceValue(trace, ['text', 'recognized_text', 'recognizedText', 'input_text', 'inputText']);
  if (traceText) return String(traceText).trim();

  return stripMessageName(trace);
}

function isTruthyContent(obs) {
  const outputData = parseIfString(obs?.output_data ?? obs?.outputData ?? obs?.output);
  const value = deepFindAny(outputData, 'content', 4);
  if (value === true) return true;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return Boolean(value);
}

function isBusinessAgent(agentCode) {
  const value = String(agentCode || '').trim().toLowerCase();
  return value !== '' && value !== 'rag' && value !== 'router';
}

function resolveHitAgent(sortedObs) {
  const routerResultAgents = resolveRouterResultAgents(sortedObs);
  if (routerResultAgents.length > 0) {
    return { agent: routerResultAgents.join(' / '), source: 'router_result', confidence: 'high' };
  }

  const fullAnswer = findLatestObservation(sortedObs, (obs) => isFullAnswerObservation(obs));
  if (fullAnswer) {
    const agentCode = resolveAgentCodeFromObservation(fullAnswer);
    if (agentCode) return { agent: agentCode, source: 'full_answer', confidence: 'high' };
  }

  const responseComplete = findLatestObservation(sortedObs, (obs) => nameIncludes(obs, '[response_complete]'));
  if (responseComplete) {
    const agentCode = resolveAgentCodeFromObservation(responseComplete);
    if (agentCode) return { agent: agentCode, source: 'response_complete', confidence: 'high' };
  }

  const runAgent = findLatestObservation(sortedObs, (obs) => nameIncludes(obs, '[run_agent]'));
  if (runAgent) {
    const agentCode = resolveAgentCodeFromObservation(runAgent);
    if (agentCode) return { agent: agentCode, source: 'run_agent', confidence: 'high' };
  }

  const generations = findObservations(sortedObs, (obs) => nameIncludes(obs, '[generation_complete]'));
  const completedGenerations = generations.filter(isTruthyContent);
  const businessGeneration = [...completedGenerations]
    .reverse()
    .find((obs) => isBusinessAgent(resolveAgentCodeFromObservation(obs)));
  if (businessGeneration) {
    return {
      agent: resolveAgentCodeFromObservation(businessGeneration),
      source: 'generation_complete',
      confidence: 'medium',
    };
  }

  const fallbackGeneration = completedGenerations[completedGenerations.length - 1];
  if (fallbackGeneration) {
    return {
      agent: resolveAgentCodeFromObservation(fallbackGeneration),
      source: 'generation_complete_only',
      confidence: 'low',
    };
  }

  return { agent: '', source: 'not_found', confidence: 'none' };
}

function resolveHitSubAgent(sortedObs) {
  const subAgentObs = findLatestObservation(sortedObs, (obs) => (
    nameIncludes(obs, '[output_tool]')
    || nameIncludes(obs, '[output_action]')
  ));
  return resolveAgentCodeFromObservation(subAgentObs);
}

function resolveAgentCandidates(sortedObs) {
  const routerResultAgents = resolveRouterResultAgents(sortedObs);
  if (routerResultAgents.length > 0) return routerResultAgents;

  const candidates = [];
  const seen = new Set();

  for (const obs of sortedObs || []) {
    if (!nameIncludes(obs, '[generation_complete]')) continue;
    const agentCode = resolveAgentCodeFromObservation(obs);
    if (!agentCode || seen.has(agentCode)) continue;
    seen.add(agentCode);
    candidates.push(agentCode);
  }

  return candidates;
}

function resolveFullAnswerText(sortedObs) {
  const fullAnswerContent = (sortedObs || [])
    .filter((obs) => isFullAnswerObservation(obs))
    .map((obs) => resolveOutputContent(obs))
    .filter(Boolean)
    .join('\n');
  if (fullAnswerContent) return fullAnswerContent;

  return (sortedObs || [])
    .filter((obs) => nameIncludes(obs, '[response_complete]'))
    .map((obs) => resolveOutputContent(obs))
    .filter(Boolean)
    .join('\n');
}

function resolveErrorInfo(sortedObs) {
  const errorObs = findObservations(sortedObs, (obs) => isErrorObservation(obs));
  const messages = [];
  const agents = [];

  for (const obs of errorObs) {
    const message = resolveObservationError(obs);
    if (message) messages.push(message);
    const agentCode = resolveAgentCodeFromObservation(obs);
    if (agentCode) agents.push(agentCode);
  }

  return {
    message: Array.from(new Set(messages)).join('\n'),
    agent: Array.from(new Set(agents)).join(' / '),
  };
}

function resolveLanguage(trace, sortedObs) {
  const asrFinal = findLatestObservation(sortedObs, (obs) => nameIncludes(obs, '[asr]: final'));
  return String(
    resolveObservationValue(asrFinal, ['language', 'language_code', 'languageCode'])
    || resolveTraceValue(trace, ['language_code', 'languageCode', 'language'])
    || ''
  ).trim();
}

function resolveVoiceprintVerified(sortedObs) {
  const asrFinal = findLatestObservation(sortedObs, (obs) => nameIncludes(obs, '[asr]: final'));
  const value = resolveObservationValue(asrFinal, ['verified']);
  return value === '' ? '' : String(value);
}

function resolveAsrDurationMs(sortedObs) {
  const asrFinal = findLatestObservation(sortedObs, (obs) => nameIncludes(obs, '[asr]: final'));
  const value = resolveObservationValue(asrFinal, ['duration_ms', 'durationMs']);
  return value === '' ? '' : value;
}

function resolveLogStatus(actualInputText, hitAgent, errorMessage) {
  if (errorMessage) return 'error';
  if (actualInputText && hitAgent) return 'complete';
  if (actualInputText && !hitAgent) return 'incomplete_no_agent';
  if (!actualInputText) return 'invalid_no_input';
  return 'unknown';
}

function buildDiagnostics(row) {
  const errors = [];
  if (!row.hit_agent) errors.push('hit_agent为空');
  if (!row.actual_input_text) errors.push('actual_input_text为空');
  if (!row.response_text) errors.push('response_text为空');
  if (row.error_message) errors.push(`error: ${row.error_message}`);
  FIRST_TOKEN_DURATIONS.forEach((k) => {
    if (row[`first_token.${k}`] == null || row[`first_token.${k}`] === '' || Number.isNaN(row[`first_token.${k}`])) {
      errors.push(`${k}无数据`);
    }
  });
  INPUT_FIELDS.forEach((field) => {
    if (row[field] == null || row[field] === '') errors.push(`${field}为空`);
  });
  return errors.join('; ');
}

function mergeOrphanErrorRows(rows) {
  const sortedRows = [...rows].sort(
    (a, b) => new Date(a.trace_time || a.timestamp || 0) - new Date(b.trace_time || b.timestamp || 0)
  );
  const lastInputRowBySession = new Map();
  const result = [];

  for (const row of sortedRows) {
    const sessionKey = row.session_id || row.sessionID || '';
    const hasMachineInput = isAlphaNumericMachineInput(row.actual_input_text);
    const hasUsableInput = row.actual_input_text && !hasMachineInput;
    const isOrphanError = row.error_message && !hasUsableInput;

    if (isOrphanError && sessionKey && lastInputRowBySession.has(sessionKey)) {
      const target = lastInputRowBySession.get(sessionKey);
      target.error_message = [target.error_message, row.error_message].filter(Boolean).join('\n');
      target.error = target.error_message;
      target.错误信息 = target.error_message;
      target.error_agent = Array.from(new Set([target.error_agent, row.error_agent].filter(Boolean))).join(' / ');
      target.has_error = '是';
      target.log_status = 'error';
      target.异常信息 = buildDiagnostics(target);
      continue;
    }

    if (!hasMachineInput) {
      result.push(row);
      if (hasUsableInput && sessionKey) {
        lastInputRowBySession.set(sessionKey, row);
      }
    }
  }

  return result;
}

function normalizeDedupeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeRows(rows) {
  const rowByKey = new Map();
  const deduped = [];

  for (const row of rows || []) {
    const requestId = normalizeDedupeText(row.request_id);
    const timeSecond = row.trace_time
      ? Math.floor(new Date(row.trace_time).getTime() / 1000)
      : '';
    const dedupeKey = requestId
      ? `request:${requestId}`
      : [
        'content',
        normalizeDedupeText(row.session_id || row.sessionID),
        normalizeDedupeText(row.actual_input_text || row.InputText),
        normalizeDedupeText(row.hit_agent || row.AgentCode),
        normalizeDedupeText(row.hit_sub_agent),
        normalizeDedupeText(row.response_text || row['output.content']),
        normalizeDedupeText(row.error_message || row.error),
        timeSecond,
      ].join('|');

    if (rowByKey.has(dedupeKey)) {
      mergeDuplicateRow(rowByKey.get(dedupeKey), row);
      continue;
    }
    rowByKey.set(dedupeKey, row);
    deduped.push(row);
  }

  return deduped;
}

function mergeTextValues(left, right, separator = '\n') {
  const values = [left, right]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return Array.from(new Set(values)).join(separator);
}

function mergeDuplicateRow(target, source) {
  if (!target || !source) return;

  target.error_message = mergeTextValues(target.error_message, source.error_message);
  target.error = target.error_message;
  target.错误信息 = target.error_message;
  target.error_agent = mergeTextValues(target.error_agent, source.error_agent, ' / ');
  target.has_error = target.error_message ? '是' : target.has_error;

  const copyIfEmptyFields = [
    'response_text',
    'output.content',
    '输出',
    'hit_agent',
    'AgentCode',
    '命中Agent',
    'hit_sub_agent',
    'agent_candidates',
    'agent_source',
    'agent_confidence',
    'actual_input_text',
    'InputText',
    '输入',
    '响应时长',
    'response_duration_ms',
    'asr_duration_ms',
    'voiceprint_verified',
  ];
  for (const field of copyIfEmptyFields) {
    if (!hasCellValue(target[field]) && hasCellValue(source[field])) {
      target[field] = source[field];
    }
  }

  target.log_status = target.error_message
    ? 'error'
    : (target.log_status || source.log_status);
  target.异常信息 = buildDiagnostics(target);
}

function hasCellValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function reorderColumnsByData(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const preferredColumns = ['输入', '输出', '命中Agent', '错误信息', '响应时长'];
  const allKeys = [];
  const seenKeys = new Set();

  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      allKeys.push(key);
    }
  }

  const keyIndex = new Map(allKeys.map((key, index) => [key, index]));
  const dataCount = new Map(allKeys.map((key) => [
    key,
    rows.reduce((count, row) => count + (hasCellValue(row?.[key]) ? 1 : 0), 0),
  ]));

  const preferred = preferredColumns.filter((key) => seenKeys.has(key));
  const rest = allKeys
    .filter((key) => !preferred.includes(key))
    .sort((a, b) => {
      const countDiff = (dataCount.get(b) || 0) - (dataCount.get(a) || 0);
      if (countDiff !== 0) return countDiff;
      return (keyIndex.get(a) || 0) - (keyIndex.get(b) || 0);
    });

  const orderedKeys = [...preferred, ...rest];
  return rows.map((row) => {
    const next = {};
    for (const key of orderedKeys) {
      next[key] = row?.[key] ?? '';
    }
    return next;
  });
}

/**
 * 生成 Langfuse 有效日志中间表。
 * Trace 只作为入口索引；Observation 负责提取实际输入、命中 Agent、响应和错误。
 *
 * @param {object[]} traces       - Traces 数组
 * @param {object[]} observations - Observations 数组
 * @returns {object[]} 每个有效 trace/request 对应一行
 */
export function buildSessionRows(traces, observations) {
  const traceById = new Map((traces || []).map((trace) => [trace.id, trace]));
  const obsByTraceId = new Map();
  for (const obs of observations) {
    const traceId = String(obs?.traceId || '').trim();
    if (!traceId) continue;
    if (!obsByTraceId.has(traceId)) obsByTraceId.set(traceId, []);
    obsByTraceId.get(traceId).push(obs);
  }

  const traceIds = new Set([
    ...(traces || []).map((trace) => String(trace?.id || '').trim()).filter(Boolean),
    ...Array.from(obsByTraceId.keys()),
  ]);

  const rows = [];
  for (const traceId of traceIds) {
    const trace = traceById.get(traceId) || { id: traceId };
    const sortedObs = [...(obsByTraceId.get(traceId) || [])].sort(
      (a, b) => new Date(a.startTime || a.createdAt || 0) - new Date(b.startTime || b.createdAt || 0)
    );

    const actualInputText = resolveActualInputText(trace, sortedObs);
    const hitAgentInfo = resolveHitAgent(sortedObs);
    const hitSubAgent = resolveHitSubAgent(sortedObs);
    const agentCandidates = resolveAgentCandidates(sortedObs);
    const responseText = resolveFullAnswerText(sortedObs);
    const errorInfo = resolveErrorInfo(sortedObs);
    const logStatus = resolveLogStatus(actualInputText, hitAgentInfo.agent, errorInfo.message);

    const ftNamedObs = findLatestObservation(sortedObs, (o) =>
      o.name === 'first_token' ||
      o.name === 'firstToken' ||
      (typeof o.name === 'string' && o.name.includes('first_token'))
    );
    const durations = FIRST_TOKEN_DURATIONS.map((k) => {
      if (ftNamedObs) {
        const v = resolveDuration(ftNamedObs, k);
        if (v != null) return Number(v);
      }
      for (const o of sortedObs) {
        const v = resolveDuration(o, k);
        if (v != null) return Number(v);
      }
      return null;
    });
    const allNull = durations.every((v) => v === null);
    const ftTotal = allNull ? '' : durations.reduce((sum, v) => sum + (v ?? 0), 0);

    const inputValues = {};
    for (const field of INPUT_FIELDS) {
      inputValues[field] = resolveInputField(trace, field);
    }

    const responseDurationMs = ftTotal;

    const row = {
      输入: actualInputText,
      输出: responseText,
      命中Agent: hitAgentInfo.agent,
      错误信息: errorInfo.message,
      响应时长: responseDurationMs,
      trace_id: traceId,
      request_id: String(resolveTraceValue(trace, ['request_id', 'requestId']) || inputValues.request_id || '').trim(),
      session_id: String(trace?.sessionId || trace?.session_id || trace?.metadata?.session_id || '').trim(),
      trace_time: trace?.timestamp || trace?.createdAt || '',
      ...inputValues,
      actual_input_text: actualInputText,
      language: resolveLanguage(trace, sortedObs),
      tts_voice: String(resolveTraceValue(trace, ['tts_voice', 'ttsVoice']) || inputValues.tts_voice || '').trim(),
      hit_agent: hitAgentInfo.agent,
      hit_sub_agent: hitSubAgent,
      agent_candidates: agentCandidates.join(' / '),
      agent_source: hitAgentInfo.source,
      agent_confidence: hitAgentInfo.confidence,
      response_text: responseText,
      response_duration_ms: responseDurationMs,
      has_error: errorInfo.message ? '是' : '否',
      error_agent: errorInfo.agent,
      error_message: errorInfo.message,
      asr_duration_ms: resolveAsrDurationMs(sortedObs),
      voiceprint_verified: resolveVoiceprintVerified(sortedObs),
      log_status: logStatus,
      sessionID: String(trace?.sessionId || trace?.session_id || '').trim(),
      traceID: traceId,
      timestamp: trace?.timestamp || trace?.createdAt || '',
      InputText: actualInputText,
      AgentCode: hitAgentInfo.agent,
      'output.content': responseText,
      error: errorInfo.message,
      异常信息: '',
    };

    // first_token 子列
    FIRST_TOKEN_DURATIONS.forEach((k, i) => {
      row[`first_token.${k}`] = durations[i] ?? '';
    });
    row['first_token.total'] = ftTotal;

    row.异常信息 = buildDiagnostics(row);

    const hasPayload =
      row.trace_id !== '' &&
      (
        row.actual_input_text !== '' ||
        row.hit_agent !== '' ||
        row.hit_sub_agent !== '' ||
        row.response_text !== '' ||
        row.error_message !== '' ||
        row.request_id !== ''
      );

    if (hasPayload) rows.push(row);
  }

  return reorderColumnsByData(dedupeRows(mergeOrphanErrorRows(rows)));
}
