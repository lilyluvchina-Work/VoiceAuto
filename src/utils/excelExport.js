/**
 * Excel 导出工具
 * 将 Traces 和 Observations 数据导出为 .xlsx 文件
 */
import * as XLSX from 'xlsx';

/**
 * 递归展平嵌套对象，数组序列化为 JSON 字符串
 */
function flattenObject(obj, prefix = '') {
  if (obj === null || typeof obj !== 'object') return { [prefix]: obj };
  if (Array.isArray(obj)) return { [prefix]: JSON.stringify(obj) };

  return Object.entries(obj).reduce((acc, [key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(acc, flattenObject(value, newKey));
    } else if (Array.isArray(value)) {
      acc[newKey] = JSON.stringify(value);
    } else {
      acc[newKey] = value;
    }
    return acc;
  }, {});
}

/**
 * 设置列宽自适应
 */
function autoFitColumns(ws, data) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const colWidths = headers.map((h) => {
    const maxLen = Math.max(
      h.length,
      ...data.map((row) => String(row[h] ?? '').length)
    );
    return { wch: Math.min(maxLen + 2, 60) };
  });
  ws['!cols'] = colWidths;
}

/**
 * 导出 Excel 文件并触发浏览器下载
 * Sheet 顺序：日志提取 → Traces → Observations
 *
 * @param {object[]} traces       - Traces 数据数组
 * @param {object[]} observations - Observations 数据数组
 * @param {string}   filename     - 文件名（含 .xlsx 后缀）
 */
export function exportToExcel(traces, observations, filename) {
  const wb = XLSX.utils.book_new();

  // --- 日志提取 Sheet（首位） ---
  const sessionRows = buildSessionRows(traces, observations);
  if (sessionRows.length > 0) {
    const wsSession = XLSX.utils.json_to_sheet(sessionRows);
    autoFitColumns(wsSession, sessionRows);
    XLSX.utils.book_append_sheet(wb, wsSession, '日志提取');
  }

  // --- Traces Sheet ---
  const flatTraces = traces.map((t) => flattenObject(t));
  const wsTraces = XLSX.utils.json_to_sheet(flatTraces);
  autoFitColumns(wsTraces, flatTraces);
  XLSX.utils.book_append_sheet(wb, wsTraces, 'Traces');

  // --- Observations Sheet ---
  const flatObs = observations.map((o) => flattenObject(o));
  const wsObs = XLSX.utils.json_to_sheet(flatObs);
  autoFitColumns(wsObs, flatObs);
  XLSX.utils.book_append_sheet(wb, wsObs, 'Observations');

  // 触发下载
  XLSX.writeFile(wb, filename);
}

/**
 * 单独导出日志提取 Excel（仅"日志提取"Sheet）
 * @param {object[]} traces       - Traces 数据数组
 * @param {object[]} observations - Observations 数据数组
 * @param {string}   filename     - 文件名（含 .xlsx 后缀）
 */
export function exportSessionExcel(traces, observations, filename) {
  const wb = XLSX.utils.book_new();
  const sessionRows = buildSessionRows(traces, observations);
  const ws = XLSX.utils.json_to_sheet(sessionRows.length ? sessionRows : [{}]);
  autoFitColumns(ws, sessionRows);
  XLSX.utils.book_append_sheet(wb, ws, '日志提取');
  XLSX.writeFile(wb, filename);
}

// ─── 日志提取字段定义 ───
const INPUT_FIELDS = [
  'tenantid', 'family_id', 'family_uuid', 'device_id', 'device_type',
  'request_id', 'tts_code', 'stt_code', 'tts_voice', 'live_model',
  'llm_model', 'app_id',
];
const FIRST_TOKEN_DURATIONS = ['vad_duration', 'asr_duration', 'tts_duration', 'llm_duration'];

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
  // input 字段（截图显示 duration 数据在 Input 里）
  const inp = parseIfString(obs?.input);
  if (inp != null && typeof inp === 'object' && !Array.isArray(inp)) {
    if (field in inp) return inp[field];
    if (inp.first_token != null && typeof inp.first_token === 'object' && field in inp.first_token) {
      return inp.first_token[field];
    }
  }
  const out = parseIfString(obs?.output);
  if (out != null && typeof out === 'object' && !Array.isArray(out)) {
    // output.first_token.field
    if (out.first_token != null && typeof out.first_token === 'object' && field in out.first_token) {
      return out.first_token[field];
    }
    // output.field
    if (field in out) return out[field];
  }
  const meta = obs?.metadata;
  if (meta != null && typeof meta === 'object') {
    // metadata.first_token.field
    if (meta.first_token != null && typeof meta.first_token === 'object' && field in meta.first_token) {
      return meta.first_token[field];
    }
    // metadata.field
    if (field in meta) return meta[field];
  }
  return undefined;
}

/**
 * 按 sessionID 聚合 Traces 和 Observations，生成提取行
 * 列顺序：sessionID | name | output_tool | output.content | first_token.* | input fields
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
    // 优先取 name 包含 'run_agent' 的 observation 的 input.agent_code（时间最晚）
    // 兜底取 name 包含 'llmchat' 的 observation 的 input.agent_code（时间最晚）
    const agentCode = (() => {
      const findAgentCode = (nameKeyword) => {
        for (let i = sortedObs.length - 1; i >= 0; i--) {
          const o = sortedObs[i];
          if (typeof o.name !== 'string' || !o.name.includes(nameKeyword)) continue;
          const inp = parseIfString(o.input);
          if (inp != null && typeof inp === 'object' && inp.agent_code) return String(inp.agent_code);
        }
        return '';
      };
      return findAgentCode('run_agent') || findAgentCode('llmchat');
    })();

    // ── output.content ── 按时间顺序拼接，同时处理字符串和对象类型 output
    const outputContent = sortedObs
      .map((o) => {
        if (o.output == null) return null;
        const out = parseIfString(o.output);
        if (typeof out === 'string') return out || null;
        if (typeof out === 'object' && out !== null) {
          const c = out.content ?? out.message?.content ?? out.text;
          return c != null ? String(c) : null;
        }
        return null;
      })
      .filter(Boolean)
      .join('\n');

    // ── first_token durations ──
    // 对每个 duration 字段独立搜索，优先从 name=first_token 的 obs 取，
    // 找不到再遍历所有 obs，兼容字段分散在不同 observation 的情况
    const ftNamedObs = sortedObs.find((o) =>
      o.name === 'first_token' ||
      o.name === 'firstToken' ||
      (typeof o.name === 'string' && o.name.includes('first_token'))
    );
    const durations = FIRST_TOKEN_DURATIONS.map((k) => {
      // 1. 优先从命名 observation 中取
      if (ftNamedObs) {
        const v = resolveDuration(ftNamedObs, k);
        if (v != null) return Number(v);
      }
      // 2. 遍历所有 observations 寻找该字段
      for (const o of sortedObs) {
        const v = resolveDuration(o, k);
        if (v != null) return Number(v);
      }
      return null;
    });
    const allNull = durations.every((v) => v === null);
    const ftTotal = allNull ? '' : durations.reduce((sum, v) => sum + (v ?? 0), 0);

    // ── InputText ──
    // 从 name 包含 'ASR' 且包含 'final' 的 observation 的 input.text 取值
    const asrFinalObs = sortedObs.find((o) =>
      typeof o.name === 'string' && o.name.includes('ASR') && o.name.includes('final')
    );
    const inputText = (() => {
      if (!asrFinalObs) return '';
      const inp = parseIfString(asrFinalObs.input);
      if (inp != null && typeof inp === 'object') return inp.text ?? inp.recognized_text ?? '';
      return '';
    })();

    // 先解析 input 字段，后续用于 row 和异常信息统计
    const inputValues = {};
    for (const field of INPUT_FIELDS) {
      inputValues[field] = resolveInputField(firstTrace, field);
    }

    const row = {
      sessionID: sid,
      InputText: inputText,
      AgentCode: agentCode,
      'output.content': outputContent,
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
    FIRST_TOKEN_DURATIONS.forEach((k, i) => {
      if (durations[i] == null || durations[i] === '' || Number.isNaN(durations[i])) errors.push(`${k}无数据`);
    });
    INPUT_FIELDS.forEach((f) => {
      if (row[f] == null || row[f] === '') errors.push(`${f}为空`);
    });
    row.异常信息 = errors.join('; ');

    // 过滤无效行：output_tool / output.content / 任意 duration / 任意 input 字段均为空时丢弃
    const hasPayload =
      row.AgentCode !== '' ||
      row['output.content'] !== '' ||
      FIRST_TOKEN_DURATIONS.some((k) => row[`first_token.${k}`] !== '') ||
      INPUT_FIELDS.some((f) => row[f] !== '');

    if (hasPayload) rows.push(row);
  }

  return rows;
}

/**
 * 导出原始 JSON 文件
 * @param {any}    data     - 要序列化的数据
 * @param {string} filename - 文件名（含 .json 后缀）
 */
export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
