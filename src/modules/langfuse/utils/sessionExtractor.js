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
  const nameText = String(obs?.name || '').trim();
  const nameMatch = nameText.match(/^\[error\]\s*:\s*(.+)$/i);
  if (!nameMatch) return '';

  const agentFromName = String(nameMatch[1] || '').trim();

  const inputData = parseIfString(obs?.input_data ?? obs?.inputData ?? obs?.input);
  const agentFromInput = stringifyError(inputData?.agent_code ?? inputData?.agentCode);
  const agentCode = agentFromInput || agentFromName;

  const outputData = parseIfString(obs?.output_data ?? obs?.outputData ?? obs?.output);
  const errorContent = stringifyError(outputData?.content ?? outputData?.message?.content ?? outputData?.text);
  if (!errorContent) return '';

  return agentCode ? `[error]: ${agentCode} | ${errorContent}` : `[error] | ${errorContent}`;
}

/**
 * 按 sessionID 聚合 Traces 和 Observations，生成提取行
 * 列顺序：sessionID | InputText | AgentCode | output.content | first_token.* | input fields | 异常信息
 *
 * @param {object[]} traces       - Traces 数组
 * @param {object[]} observations - Observations 数组
 * @returns {object[]} 每个 sessionID 对应一行
 */
export function buildSessionRows(traces, observations) {
  // 以 traceId 为键建立 trace 索引
  const traceById = new Map(traces.map((t) => [t.id, t]));

  // 按 sessionId 分组 traces
  const tracesBySession = new Map();
  for (const t of traces) {
    if (!t.sessionId) continue;
    if (!tracesBySession.has(t.sessionId)) tracesBySession.set(t.sessionId, []);
    tracesBySession.get(t.sessionId).push(t);
  }

  // 按 sessionId 分组 observations（通过 traceId -> trace -> sessionId 关联）
  const obsBySession = new Map();
  for (const obs of observations) {
    const trace = traceById.get(obs.traceId);
    if (!trace?.sessionId) continue;
    if (!obsBySession.has(trace.sessionId)) obsBySession.set(trace.sessionId, []);
    obsBySession.get(trace.sessionId).push(obs);
  }

  const rows = [];

  for (const [sid, sessionTraces] of tracesBySession) {
    // 按时间排序 traces
    const sortedTraces = [...sessionTraces].sort(
      (a, b) => new Date(a.timestamp || a.createdAt || 0) - new Date(b.timestamp || b.createdAt || 0)
    );
    const firstTrace = sortedTraces[0];

    // 同一 session 下按时间排序 observations
    const obsArr = obsBySession.get(sid) || [];
    const sortedObs = [...obsArr].sort(
      (a, b) => new Date(a.startTime || a.createdAt || 0) - new Date(b.startTime || b.createdAt || 0)
    );

    // ── AgentCode ──
    // 优先取 [run_agent] observation 的 input.agent_code。
    const agentCode = (() => {
      const agentFields = [
        'agent_code',
        'agentCode',
        'AgentCode',
        'final_agent',
        'finalAgent',
        'primary_hit_agent',
        'primaryHitAgent',
        'hit_agent',
        'hitAgent',
      ];
      const findAgentCode = (nameKeyword) => {
        for (let i = sortedObs.length - 1; i >= 0; i--) {
          const o = sortedObs[i];
          const name = String(o.name || '').toLowerCase();
          if (!name.includes(nameKeyword)) continue;
          const value = resolveObservationValue(o, agentFields);
          if (value) return String(value);
        }
        return '';
      };
      const runAgentCode = findAgentCode('run_agent');
      if (runAgentCode) return runAgentCode;

      for (let i = sortedObs.length - 1; i >= 0; i--) {
        const o = sortedObs[i];
        const name = String(o.name || '').toLowerCase();
        if (!name.includes('agent') && !name.includes('route') && !name.includes('router')) continue;
        const value = resolveObservationValue(o, agentFields);
        if (value) return String(value);
      }
      return findAgentCode('llmchat')
        || String(resolveInputField(firstTrace, 'final_agent') || resolveInputField(firstTrace, 'hit_agent') || resolveInputField(firstTrace, 'agent_code') || resolveInputField(firstTrace, 'agentCode') || '');
    })();

    // ── output.content ── 优先取 [full_answer] observation 的 output.content。
    const fullAnswerContent = sortedObs
      .filter((o) => isFullAnswerObservation(o))
      .map((o) => resolveOutputContent(o))
      .filter(Boolean)
      .join('\n');
    const outputContent = fullAnswerContent || sortedObs
      .map((o) => resolveOutputContent(o))
      .filter(Boolean)
      .join('\n');

    // ── error ── 从 observation.error 汇总
    const errorText = sortedObs
      .map((o) => resolveObservationError(o))
      .filter(Boolean)
      .join('\n');

    // ── first_token durations ──
    const ftNamedObs = sortedObs.find((o) =>
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

    // ── InputText ──
    const asrFinalObs = sortedObs.find((o) =>
      typeof o.name === 'string' && o.name.includes('ASR') && o.name.includes('final')
    );
    const inputText = (() => {
      const inputFields = ['actual_input_text', 'actualInputText', 'recognized_text', 'recognizedText', 'input_text', 'inputText', 'query', 'question', 'text'];
      if (asrFinalObs) {
        const asrValue = resolveObservationValue(asrFinalObs, inputFields);
        if (asrValue) return asrValue;
      }
      for (const o of sortedObs) {
        const name = String(o.name || '').toLowerCase();
        if (!name.includes('asr') && !name.includes('input') && !name.includes('speech')) continue;
        const value = resolveObservationValue(o, inputFields);
        if (value) return value;
      }
      for (const field of inputFields) {
        const value = resolveInputField(firstTrace, field);
        if (value) return value;
      }
      return '';
    })();

    // 先解析 input 字段
    const inputValues = {};
    for (const field of INPUT_FIELDS) {
      inputValues[field] = resolveInputField(firstTrace, field);
    }

    const row = {
      sessionID: sid,
      traceID: firstTrace?.id || '',
      timestamp: firstTrace?.timestamp || firstTrace?.createdAt || '',
      InputText: inputText,
      AgentCode: agentCode,
      'output.content': outputContent,
      error: errorText,
      ...inputValues,
      异常信息: '',
    };

    // first_token 子列
    FIRST_TOKEN_DURATIONS.forEach((k, i) => {
      row[`first_token.${k}`] = durations[i] ?? '';
    });
    row['first_token.total'] = ftTotal;

    // 异常信息收集
    const errors = [];
    if (!agentCode) errors.push('AgentCode为空');
    if (!inputText) errors.push('InputText为空');
    if (!outputContent) errors.push('output.content为空');
    if (errorText) errors.push(`error: ${errorText}`);
    FIRST_TOKEN_DURATIONS.forEach((k, i) => {
      if (durations[i] == null || durations[i] === '' || Number.isNaN(durations[i])) errors.push(`${k}无数据`);
    });
    INPUT_FIELDS.forEach((f) => {
      if (row[f] == null || row[f] === '') errors.push(`${f}为空`);
    });
    row.异常信息 = errors.join('; ');

    // 过滤无效行
    const hasPayload =
      row.InputText !== '' ||
      row.AgentCode !== '' ||
      row['output.content'] !== '' ||
      FIRST_TOKEN_DURATIONS.some((k) => row[`first_token.${k}`] !== '') ||
      INPUT_FIELDS.some((f) => row[f] !== '');

    if (hasPayload) rows.push(row);
  }

  return rows;
}
