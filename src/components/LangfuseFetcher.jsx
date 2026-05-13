/**
 * LangfuseFetcher - 从 Langfuse 获取日志并导出 Excel / JSON
 * 支持：暂停 / 继续 / 终止 / 悬浮预览
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { fetchTraces, fetchObservations, FetchController, ENVIRONMENTS } from '../modules/langfuse/services/langfuseService';
import { exportToExcel, exportSessionExcel, buildSessionRows, downloadJSON } from '../modules/langfuse/utils/excelExporter';
import { createTapdBug } from '../modules/tapd/services/tapdService';
import {
  SUMMARY_REPORT_EMAIL,
  sendSummaryReportEmailAuto,
  openSummaryReportMailClient,
} from '../services/emailService';
import { useTest } from '../stores/testStore';

const LANGFUSE_PAGE_STORAGE_KEY = 'voiceauto_langfuse_page_state';
const TAPD_CONFIG_KEY = 'voiceauto_tapd_config_v1';
const SUMMARY_REPORT_STORAGE_KEY = 'voiceauto_summary_report_v1';
const SUMMARY_REPORT_EVENT = 'voiceauto-summary-report-updated';

function loadTapdConfig() {
  try {
    return JSON.parse(localStorage.getItem(TAPD_CONFIG_KEY) || '{}');
  } catch {
    return {};
  }
}

function normalizeLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clipText(value, max = 120) {
  const normalized = normalizeLine(value);
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function splitErrorMessages(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];

  const pieces = text
    .split(/\r?\n+/)
    .map((item) => normalizeLine(item))
    .filter(Boolean);

  return Array.from(new Set(pieces));
}

function resolveCaseNameByHumanText(testAudios, inputText) {
  const normalizedInput = normalizeLine(inputText);
  if (!normalizedInput) return '';
  const matched = (testAudios || []).find((item) => normalizeLine(item?.text) === normalizedInput);
  return normalizeLine(matched?.caseTitle || matched?.name || matched?.tapdCaseTitle || '');
}

function resolveModuleNameByHumanText(testAudios, inputText) {
  const normalizedInput = normalizeLine(inputText);
  if (!normalizedInput) return '未分类';
  const matched = (testAudios || []).find((item) => normalizeLine(item?.text) === normalizedInput);
  return normalizeLine(
    matched?.module
    || matched?.tapdPlanDirectory
    || matched?.tapdCategoryName
    || '未分类'
  ) || '未分类';
}

function parseMs(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function buildSummaryReportPayload(sessionRows, testAudios, envKey, range) {
  const safeRows = Array.isArray(sessionRows) ? sessionRows : [];
  const executedCases = safeRows.length;
  const passedCases = safeRows.filter((row) => !normalizeLine(row?.error)).length;
  const failedCases = Math.max(0, executedCases - passedCases);
  const passRate = executedCases > 0 ? `${((passedCases / executedCases) * 100).toFixed(1)}%` : '0.0%';

  const moduleMap = new Map();
  for (const row of safeRows) {
    const moduleName = resolveModuleNameByHumanText(testAudios, row?.InputText);
    const responseMs = parseMs(row?.['first_token.total']);

    if (!moduleMap.has(moduleName)) {
      moduleMap.set(moduleName, {
        module: moduleName,
        caseCount: 0,
        responseCount: 0,
        responseTotalMs: 0,
      });
    }
    const item = moduleMap.get(moduleName);
    item.caseCount += 1;
    if (responseMs != null) {
      item.responseCount += 1;
      item.responseTotalMs += responseMs;
    }
  }

  const moduleAverages = Array.from(moduleMap.values())
    .map((item) => ({
      module: item.module,
      caseCount: item.caseCount,
      avgResponseMs: item.responseCount > 0 ? Number((item.responseTotalMs / item.responseCount).toFixed(1)) : null,
    }))
    .sort((a, b) => a.module.localeCompare(b.module, 'zh-CN'));

  const envLabel = ENVIRONMENTS[envKey]?.label || envKey;
  const testEnvironment = `${envLabel} (${envKey})`;
  const generatedAt = Date.now();
  const generatedAtText = new Date(generatedAt).toLocaleString('zh-CN');
  const rangeText = `${range.fromDate} ${range.fromTime} -> ${range.toDate} ${range.toTime}`;

  const moduleLines = moduleAverages.length > 0
    ? moduleAverages.map((item) => `- ${item.module}: ${item.avgResponseMs == null ? '-' : `${item.avgResponseMs}ms`}（${item.caseCount} 条）`).join('\n')
    : '- 无可用数据';

  const text = [
    'VoiceAuto 总结报告',
    `生成时间: ${generatedAtText}`,
    `测试环境: ${testEnvironment}`,
    `时间范围: ${rangeText}`,
    `执行用例条数: ${executedCases}`,
    `执行通过率: ${passRate}`,
    '',
    '每个模块平均响应时间:',
    moduleLines,
  ].join('\n');

  return {
    generatedAt,
    generatedAtText,
    testEnvironment,
    rangeText,
    executedCases,
    passedCases,
    failedCases,
    passRate,
    moduleAverages,
    text,
  };
}


function buildBugTitle(caseName, humanText, errorMessage) {
  const title = [
    caseName || '未命名用例',
    `Human:${clipText(humanText || '（空）', 60)}`,
    clipText(errorMessage || '未知错误', 80),
  ].join(' | ');
  return title.length > 255 ? `${title.slice(0, 252)}...` : title;
}

async function submitTapdBugsBySessionRows(sessionRows, testAudios) {
  const rowsWithErrors = (sessionRows || []).filter((row) => String(row?.error || '').trim());
  if (rowsWithErrors.length === 0) {
    return { skipped: true, reason: 'no-error', total: 0, created: 0, failed: 0 };
  }

  const cfg = loadTapdConfig();
  const apiUser = normalizeLine(cfg.apiUser);
  const apiPassword = normalizeLine(cfg.apiPassword);
  const workspaceId = normalizeLine(cfg.workspaceId);
  if (!apiUser || !apiPassword || !workspaceId) {
    return {
      skipped: true,
      reason: 'missing-config',
      total: rowsWithErrors.length,
      created: 0,
      failed: rowsWithErrors.length,
    };
  }

  const pendingBugs = [];
  for (const row of rowsWithErrors) {
    const humanText = String(row?.InputText || '').trim();
    const caseName = resolveCaseNameByHumanText(testAudios, humanText);
    const errorMessages = splitErrorMessages(row.error);
    for (const message of errorMessages) {
      const title = buildBugTitle(caseName, humanText, message);
      const description = [
        `SessionID: ${String(row?.sessionID || '').trim()}`,
        `CaseName: ${caseName || '未命名用例'}`,
        `Human: ${humanText || '（空）'}`,
        `Error: ${message}`,
        `ErrorDetails: ${String(row?.error || '').trim() || message}`,
        `Summary: ${String(row?.异常信息 || '').trim() || 'N/A'}`,
        `OutputContent: ${clipText(row?.['output.content'] || '', 500) || 'N/A'}`,
      ].join('\n');
      pendingBugs.push({ title, description, dedupeKey: `${title}##${message}` });
    }
  }

  const dedupedBugs = [];
  const seen = new Set();
  for (const item of pendingBugs) {
    if (seen.has(item.dedupeKey)) continue;
    seen.add(item.dedupeKey);
    dedupedBugs.push(item);
  }

  let created = 0;
  let failed = 0;
  for (const bug of dedupedBugs) {
    try {
      await createTapdBug(workspaceId, bug.title, bug.description, apiUser, apiPassword);
      created++;
    } catch {
      failed++;
    }
  }

  return {
    skipped: false,
    reason: '',
    total: dedupedBugs.length,
    created,
    failed,
  };
}

/* ─── 工具函数 ─── */
function toISO(date, time) {
  if (!date || !time) return '';
  return new Date(`${date}T${time}`).toISOString();
}
function fmtTime(isoStr) {
  if (!isoStr) return '-';
  try { return new Date(isoStr).toLocaleString('zh-CN', { hour12: false }); } catch { return isoStr; }
}
function splitDT(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  };
}
function makeFilename(prefix, fromDate, fromTime, toDate, toTime) {
  const fmt = (dt, t) => `${dt}_${t.replace(/:/g, '-')}`;
  return `${prefix}_${fmt(fromDate, fromTime)}_TO_${fmt(toDate, toTime)}`;
}

/* ─── 空记录过滤 ─── */
function isEmptyRecord(record) {
  const isEmpty = (v) => {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') { const t = v.trim().toLowerCase(); return t === '' || t === 'empty' || t === 'null'; }
    if (typeof v === 'object' && !Array.isArray(v)) return Object.keys(v).length === 0;
    if (Array.isArray(v)) return v.length === 0;
    return false;
  };
  const fields = ['input', 'output', 'name'];
  const present = fields.filter((f) => f in record);
  if (present.length === 0) return false;
  return present.every((f) => isEmpty(record[f]));
}

/* ─── 数据整理（过滤 + session 关联） ─── */
function processData(rawTraces, rawObs) {
  const cleanTraces = rawTraces.filter((r) => !isEmptyRecord(r));
  const cleanObs = rawObs.filter((r) => !isEmptyRecord(r));
  const filteredCount = { traces: rawTraces.length - cleanTraces.length, obs: rawObs.length - cleanObs.length };

  const traceSessions = new Set(cleanTraces.map((t) => t.sessionId).filter(Boolean));
  const traceById = Object.fromEntries(cleanTraces.map((t) => [t.id, t]));
  const matchedSessions = new Set(
    cleanObs.map((o) => traceById[o.traceId]?.sessionId).filter((sid) => sid && traceSessions.has(sid))
  );
  const filteredObs =
    matchedSessions.size > 0
      ? cleanObs.filter((o) => matchedSessions.has(traceById[o.traceId]?.sessionId))
      : cleanObs;

  return { traces: cleanTraces, observations: filteredObs, sessionIds: [...matchedSessions], filteredCount };
}

/* ─── 进度条 ─── */
function ProgressBar({ value, max, label }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span>{value} / {max > 0 ? max : '?'}（{pct}%）</span>
      </div>
      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${max > 0 ? pct : 50}%` }} />
      </div>
    </div>
  );
}

/* ─── 日期时间选择器 ─── */
function DateTimePicker({ label, variant, date, time, onDateChange, onTimeChange, disabled }) {
  const isEnd = variant === 'end';
  const border = isEnd ? 'border-red-500/40 focus-within:border-red-400' : 'border-green-500/40 focus-within:border-green-400';
  const bg = isEnd ? 'bg-red-950/20' : 'bg-green-950/20';
  const badge = isEnd ? 'bg-red-900/40 text-red-300 border-red-700/50' : 'bg-green-900/40 text-green-300 border-green-700/50';
  const dot = isEnd ? 'bg-red-400' : 'bg-green-400';
  const iconBadge = isEnd
    ? 'bg-red-500/15 text-red-200 border border-red-400/40 shadow-[0_0_0_1px_rgba(248,113,113,0.25)]'
    : 'bg-green-500/15 text-green-200 border border-green-400/40 shadow-[0_0_0_1px_rgba(74,222,128,0.25)]';
  return (
    <div className={`rounded-xl border ${border} ${bg} p-4 space-y-3 transition-colors`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dot} flex-shrink-0`} />
        <span className="text-xs font-semibold text-gray-200 tracking-wide">{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${iconBadge}`}>📅</span>
            <span>日期</span>
          </label>
          <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} disabled={disabled}
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${iconBadge}`}>🕐</span>
            <span>时间（时:分:秒）</span>
          </label>
          <input type="time" step="1" value={time} onChange={(e) => onTimeChange(e.target.value)} disabled={disabled}
            className="w-full px-3 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed" />
        </div>
      </div>
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${badge}`}>
        <span className="text-xs font-mono tracking-tight">{date && time ? `${date}  ${time}` : '— 未选择 —'}</span>
      </div>
    </div>
  );
}

/* ─── 悬浮预览弹层 ─── */
function CellTooltip({ content, target }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const tooltipW = 360;
    // position:fixed 相对视口定位，直接用 getBoundingClientRect() 的坐标，不加 scrollX/Y
    let x = rect.left;
    let y = rect.bottom + 6;
    if (x + tooltipW > window.innerWidth) x = window.innerWidth - tooltipW - 12;
    if (y + 300 > window.innerHeight) y = rect.top - 6 - 300;
    setPos({ x, y });
  }, [target]);

  if (!content) return null;

  let rendered = content;
  try {
    const parsed = JSON.parse(content);
    rendered = JSON.stringify(parsed, null, 2);
  } catch { /* 普通字符串，直接显示 */ }

  return (
    <div
      className="fixed z-[9999] bg-gray-900 border border-gray-600 rounded-xl shadow-2xl p-3 text-xs text-gray-200 font-mono leading-relaxed"
      style={{ left: pos.x, top: pos.y, maxWidth: 360, maxHeight: 300, overflowY: 'auto', pointerEvents: 'none' }}
    >
      <pre className="whitespace-pre-wrap break-all">{rendered}</pre>
    </div>
  );
}

/* ─── 数据预览表格 ─── */
function DataTable({ title, data, color = 'primary' }) {
  const [page, setPage] = useState(1);
  const PAGE = 20;

  const scrollRef = useRef(null);
  const dragging = useRef(false);
  const originX = useRef(0);
  const originScroll = useRef(0);

  // 悬浮预览状态
  const [tooltip, setTooltip] = useState({ content: '', target: null });
  const hideTimer = useRef(null);

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    dragging.current = true;
    originX.current = e.clientX;
    originScroll.current = scrollRef.current.scrollLeft;
    scrollRef.current.style.cursor = 'grabbing';
  };
  const onMouseMove = (e) => {
    if (!dragging.current || !scrollRef.current) return;
    scrollRef.current.scrollLeft = originScroll.current - (e.clientX - originX.current);
  };
  const onDragEnd = () => {
    dragging.current = false;
    if (scrollRef.current) scrollRef.current.style.cursor = 'grab';
  };

  const showTooltip = (e, content) => {
    if (!content || String(content).length < 2) return;
    clearTimeout(hideTimer.current);
    setTooltip({ content: String(content), target: e.currentTarget });
  };
  const hideTooltip = () => {
    hideTimer.current = setTimeout(() => setTooltip({ content: '', target: null }), 120);
  };

  // 组件卸载时清理定时器，避免内存泄漏
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  if (!data.length) return <div className="text-gray-500 text-xs text-center py-6">暂无数据</div>;

  const keys = Object.keys(data[0]);
  const totalPages = Math.ceil(data.length / PAGE);
  const rows = data.slice((page - 1) * PAGE, page * PAGE);
  const titleColorByType = {
    primary: 'text-primary',
    accent: 'text-accent',
    secondary: 'text-secondary',
  };
  const titleColor = titleColorByType[color] || 'text-primary';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className={`text-sm font-semibold ${titleColor}`}>
          {title}
          <span className="ml-2 text-gray-400 font-normal text-xs">{data.length} 条 · {keys.length} 列</span>
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 flex items-center gap-1 select-none">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            拖动横向滚动 · 悬浮查看完整内容
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
                className="px-2.5 py-1 rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600">‹</button>
              <span className="px-1">第 {page} / {totalPages} 页</span>
              <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded bg-gray-700 disabled:opacity-40 hover:bg-gray-600">›</button>
            </div>
          )}
        </div>
      </div>

      {/* 悬浮弹层（portal 式固定定位） */}
      <CellTooltip content={tooltip.content} target={tooltip.target} />

      <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-gray-700 cursor-grab"
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onDragEnd} onMouseLeave={onDragEnd}
        style={{ maxHeight: 480, overflowY: 'auto' }}>
        <table className="text-xs text-gray-300" style={{ minWidth: 'max-content', borderCollapse: 'collapse' }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-gray-800">
              <th className="px-3 py-2.5 text-left whitespace-nowrap font-medium text-gray-500 sticky left-0 bg-gray-800 z-30 border-r border-gray-700">#</th>
              {keys.map((k) => (
                <th key={k} className="px-3 py-2.5 text-left whitespace-nowrap font-medium text-gray-400">{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-800 hover:bg-gray-800/60 transition-colors">
                <td className="px-3 py-2 text-gray-600 sticky left-0 bg-gray-900 border-r border-gray-800 z-10">
                  {(page - 1) * PAGE + i + 1}
                </td>
                {keys.map((k) => {
                  const v = row[k];
                  const raw = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                  return (
                    <td key={k} className="px-3 py-2 whitespace-nowrap relative" style={{ maxWidth: 260 }}
                      onMouseEnter={(e) => showTooltip(e, raw)}
                      onMouseLeave={hideTooltip}>
                      <span className="block truncate" style={{ maxWidth: 240 }}>{raw}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── 控制按钮组 ─── */
function FetchControls({ status, onPause, onResume, onAbort }) {
  if (status !== 'fetching' && status !== 'paused') return null;
  const isPaused = status === 'paused';
  return (
    <div className="flex items-center gap-2">
      {isPaused ? (
        <button onClick={onResume}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
          继续
        </button>
      ) : (
        <button onClick={onPause}
          className="flex items-center gap-1.5 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-medium rounded-lg transition-colors">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
          暂停
        </button>
      )}
      <button onClick={onAbort}
        className="flex items-center gap-1.5 px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 6h12v12H6z"/>
        </svg>
        终止并保存
      </button>
    </div>
  );
}

/* ─── 环境标签颜色映射 ─── */
const ENV_STYLES = {
  UAT:  { badge: 'bg-purple-900/50 border-purple-600 text-purple-300', dot: 'bg-purple-400', active: 'ring-purple-500' },
  TEST: { badge: 'bg-yellow-900/50 border-yellow-600 text-yellow-300', dot: 'bg-yellow-400', active: 'ring-yellow-500' },
  PROD: { badge: 'bg-red-900/50  border-red-600  text-red-300',    dot: 'bg-red-400',    active: 'ring-red-500'    },
};

const TIME_PRESETS = [
  { label: '15 分钟', mins: 15 },
  { label: '1 小时', mins: 60 },
  { label: '6 小时', mins: 360 },
  { label: '24 小时', mins: 1440 },
  { label: '3 天', mins: 4320 },
  { label: '7 天', mins: 10080 },
];

const JSON_DOWNLOADS = [
  { type: 'traces', label: '下载 Traces.json' },
  { type: 'observations', label: '下载 Observations.json' },
];

const JSON_EXPORT_META = {
  traces: 'Traces',
  observations: 'Observations',
};

function buildAutoFetchRange(firstTestAudioTime, lastTestAudioTime) {
  const fromTs = Number(firstTestAudioTime);
  const toTsRaw = Number(lastTestAudioTime);
  const toTs = toTsRaw > fromTs ? toTsRaw : fromTs + 1000;
  return {
    from: splitDT(new Date(fromTs)),
    to: splitDT(new Date(toTs)),
  };
}

/* ─── 主组件 ─── */
export default function LangfuseFetcher() {
  const { state } = useTest();
  const initFrom = splitDT(new Date(Date.now() - 60 * 60 * 1000));
  const initTo = splitDT(new Date());
  const shouldAutoFetchLangfuseLogs = Boolean(state.testOptions?.autoFetchLangfuseLogs ?? true);

  const [envKey, setEnvKey] = useState('UAT');

  const [fromDate, setFromDate] = useState(initFrom.date);
  const [fromTime, setFromTime] = useState(initFrom.time);
  const [toDate, setToDate] = useState(initTo.date);
  const [toTime, setToTime] = useState(initTo.time);

  // status: idle | fetching | paused | done | aborted | error
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [traceProgress, setTraceProgress] = useState({ fetched: 0, total: 0 });
  const [obsProgress, setObsProgress] = useState({ fetched: 0, total: 0 });

  const [traces, setTraces] = useState([]);
  const [observations, setObservations] = useState([]);
  const [sessionIds, setSessionIds] = useState([]);
  const [filteredCount, setFilteredCount] = useState({ traces: 0, obs: 0 });

  // 中间态数据（终止时使用）
  const partialTraces = useRef([]);
  const partialObs = useRef([]);
  // 控制器
  const controller = useRef(null);
  const autoFilledRunEndRef = useRef(null);

  const applyProcessedResult = (result) => {
    setTraces(result.traces);
    setObservations(result.observations);
    setSessionIds(result.sessionIds);
    setFilteredCount(result.filteredCount);
  };

  const sessionRows = useMemo(() => buildSessionRows(traces, observations), [traces, observations]);

  const resetFetchedResultState = () => {
    setTraces([]);
    setObservations([]);
    setSessionIds([]);
    setFilteredCount({ traces: 0, obs: 0 });
    setTraceProgress({ fetched: 0, total: 0 });
    setObsProgress({ fetched: 0, total: 0 });
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LANGFUSE_PAGE_STORAGE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw);

      setEnvKey(cached.envKey || 'UAT');
      setFromDate(cached.fromDate || initFrom.date);
      setFromTime(cached.fromTime || initFrom.time);
      setToDate(cached.toDate || initTo.date);
      setToTime(cached.toTime || initTo.time);
      setError(cached.error || '');
      setTraceProgress(cached.traceProgress || { fetched: 0, total: 0 });
      setObsProgress(cached.obsProgress || { fetched: 0, total: 0 });
      setTraces(Array.isArray(cached.traces) ? cached.traces : []);
      setObservations(Array.isArray(cached.observations) ? cached.observations : []);
      setSessionIds(Array.isArray(cached.sessionIds) ? cached.sessionIds : []);
      setFilteredCount(cached.filteredCount || { traces: 0, obs: 0 });
      autoFilledRunEndRef.current = cached.autoFilledRunEndRef || null;

      const cachedStatus = cached.status || 'idle';
      setStatus(cachedStatus === 'fetching' || cachedStatus === 'paused' ? 'idle' : cachedStatus);
    } catch {
      // ignore invalid cache
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        LANGFUSE_PAGE_STORAGE_KEY,
        JSON.stringify({
          envKey,
          fromDate,
          fromTime,
          toDate,
          toTime,
          status,
          error,
          traceProgress,
          obsProgress,
          traces,
          observations,
          sessionIds,
          filteredCount,
          autoFilledRunEndRef: autoFilledRunEndRef.current,
          savedAt: Date.now(),
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [
    envKey,
    fromDate,
    fromTime,
    toDate,
    toTime,
    status,
    error,
    traceProgress,
    obsProgress,
    traces,
    observations,
    sessionIds,
    filteredCount,
  ]);

  const applyPreset = (mins) => {
    const end = new Date(); const start = new Date(end.getTime() - mins * 60 * 1000);
    const s = splitDT(start); const e = splitDT(end);
    setFromDate(s.date); setFromTime(s.time); setToDate(e.date); setToTime(e.time);
  };

  /* 暂停 */
  const handlePause = () => {
    controller.current?.pause();
    setStatus('paused');
  };

  /* 继续 */
  const handleResume = () => {
    controller.current?.resume();
    setStatus('fetching');
  };

  /* 终止并保存当前数据 */
  const handleAbort = () => {
    controller.current?.abort();
    // partialTraces/partialObs 持有 fetchAllPages 内部 results 数组的引用，
    // abort 后循环已退出，数据已稳定，可安全读取
    const result = processData([...partialTraces.current], [...partialObs.current]);
    applyProcessedResult(result);
    setStatus('aborted');
  };

  /* 清空所有日志数据，恢复初始状态 */
  const handleClear = () => {
    setStatus('idle');
    setError('');
    resetFetchedResultState();
    partialTraces.current = [];
    partialObs.current = [];
  };

  /* 获取日志 */
  const handleFetch = useCallback(async (overrideRange = null, options = {}) => {
    const { autoExportSession = false } = options;
    const range = overrideRange || { fromDate, fromTime, toDate, toTime };
    if (!range.fromDate || !range.fromTime || !range.toDate || !range.toTime) {
      setError('请完整填写开始和结束时间');
      return;
    }
    const fromISO = toISO(range.fromDate, range.fromTime);
    const toISO_ = toISO(range.toDate, range.toTime);
    if (new Date(fromISO) >= new Date(toISO_)) { setError('开始时间必须早于结束时间'); return; }

    // 开始新一轮拉取时仅重置进度，不清空已展示结果，避免页面瞬间空白
    partialTraces.current = [];
    partialObs.current = [];
    controller.current = new FetchController();

    setStatus('fetching');
    setError('');
    setTraceProgress({ fetched: 0, total: 0 });
    setObsProgress({ fetched: 0, total: 0 });

    try {
      const [rawTraces, rawObs] = await Promise.all([
        fetchTraces(envKey, fromISO, toISO_, (items, total) => {
          // items 是 fetchAllPages 内部 results 的引用，实时追踪已获取数据
          setTraceProgress({ fetched: items.length, total });
          partialTraces.current = items;
        }, controller.current),
        fetchObservations(envKey, fromISO, toISO_, (items, total) => {
          setObsProgress({ fetched: items.length, total });
          partialObs.current = items;
        }, controller.current),
      ]);

      if (controller.current.aborted) return; // 终止路径已在 handleAbort 处理

      const result = processData(rawTraces, rawObs);
      applyProcessedResult(result);
      setStatus('done');

      const fetchedSessionRows = buildSessionRows(result.traces, result.observations);
      const bugSubmitResult = await submitTapdBugsBySessionRows(fetchedSessionRows, state.testAudios);
      if (!bugSubmitResult.skipped && bugSubmitResult.total > 0) {
        setError(`TAPD Bug 提交完成：共 ${bugSubmitResult.total} 条，成功 ${bugSubmitResult.created} 条，失败 ${bugSubmitResult.failed} 条`);
      }
      if (bugSubmitResult.skipped && bugSubmitResult.reason === 'missing-config' && bugSubmitResult.total > 0) {
        setError('检测到错误信息，但未提交 TAPD Bug：请先在 TAPD 导入向导中完成 API 配置并选择项目。');
      }

      if (autoExportSession) {
        exportSessionExcel(
          result.traces,
          result.observations,
          makeFilename('SessionExtract', range.fromDate, range.fromTime, range.toDate, range.toTime) + '.xlsx'
        );
      }
    } catch (err) {
      if (controller.current?.aborted) return;
      setError(err.message || '获取失败，请检查网络或时间范围');
      setStatus('error');
    }
  }, [envKey, fromDate, fromTime, toDate, toTime, state.testAudios]);

  useEffect(() => {
    const { firstTestAudioTime, lastTestAudioTime, endTime } = state.report || {};
    const isCompleted = state.playback?.status === 'completed';
    if (!shouldAutoFetchLangfuseLogs) return;
    if (!isCompleted || !firstTestAudioTime || !lastTestAudioTime || !endTime) return;
    if (autoFilledRunEndRef.current === endTime) return;

    const autoRange = buildAutoFetchRange(firstTestAudioTime, lastTestAudioTime);
    const fromParts = autoRange.from;
    const toParts = autoRange.to;

    setFromDate(fromParts.date);
    setFromTime(fromParts.time);
    setToDate(toParts.date);
    setToTime(toParts.time);

    autoFilledRunEndRef.current = endTime;

    handleFetch(
      {
        fromDate: fromParts.date,
        fromTime: fromParts.time,
        toDate: toParts.date,
        toTime: toParts.time,
      }
    );
  }, [
    handleFetch,
    shouldAutoFetchLangfuseLogs,
    state.playback?.status,
    state.report?.firstTestAudioTime,
    state.report?.lastTestAudioTime,
    state.report?.endTime,
  ]);

  const handleExcel = () => {
    exportToExcel(traces, observations, makeFilename('LangfuseLogs', fromDate, fromTime, toDate, toTime) + '.xlsx');
  };
  const handleSessionExcel = () => {
    exportSessionExcel(traces, observations, makeFilename('SessionExtract', fromDate, fromTime, toDate, toTime) + '.xlsx');
  };
  const handleDownloadJSON = (type) => {
    const prefix = JSON_EXPORT_META[type] || 'Export';
    downloadJSON(
      type === 'traces' ? traces : observations,
      makeFilename(prefix, fromDate, fromTime, toDate, toTime) + '.json'
    );
  };

  const handleGenerateSummaryAndSendEmail = async () => {
    if (sessionRows.length === 0) {
      setError('暂无可生成总结报告的数据，请先获取 Langfuse 日志。');
      return;
    }

    const reportPayload = buildSummaryReportPayload(
      sessionRows,
      state.testAudios,
      envKey,
      { fromDate, fromTime, toDate, toTime }
    );

    try {
      localStorage.setItem(SUMMARY_REPORT_STORAGE_KEY, JSON.stringify(reportPayload));
    } catch {
      // ignore storage errors
    }

    window.dispatchEvent(new CustomEvent(SUMMARY_REPORT_EVENT, { detail: reportPayload }));
    try {
      await sendSummaryReportEmailAuto(reportPayload, SUMMARY_REPORT_EMAIL);
      setError(`总结报告已自动发送到 ${SUMMARY_REPORT_EMAIL}`);
    } catch {
      openSummaryReportMailClient(reportPayload, SUMMARY_REPORT_EMAIL);
      setError(`自动发送失败，已回退为唤起邮件客户端发送到 ${SUMMARY_REPORT_EMAIL}`);
    }
  };

  const isFetching = status === 'fetching';
  const isPaused = status === 'paused';
  const isDone = status === 'done' || status === 'aborted';
  const isActive = isFetching || isPaused;
  const totalFiltered = filteredCount.traces + filteredCount.obs;
  const hasFetchedData = traces.length > 0 || observations.length > 0 || sessionIds.length > 0 || totalFiltered > 0;
  const shouldShowResults = isDone || hasFetchedData;

  const spanLabel = (() => {
    const s = toISO(fromDate, fromTime); const e = toISO(toDate, toTime);
    if (!s || !e) return '';
    const diff = (new Date(e) - new Date(s)) / 1000;
    if (diff < 0) return '⚠️ 时间有误';
    if (diff < 3600) return `${Math.round(diff / 60)} 分钟`;
    if (diff < 86400) return `${(diff / 3600).toFixed(1)} 小时`;
    return `${(diff / 86400).toFixed(1)} 天`;
  })();

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🗂️</span>
          <div>
            <h2 className="text-xl font-semibold text-white">Langfuse 日志获取</h2>
            <p className="text-xs text-gray-400 mt-0.5">拉取 Traces 与 Observations，导出 Excel / JSON</p>
          </div>
        </div>

        {/* 环境切换器 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 mr-1">环境</span>
          {Object.keys(ENVIRONMENTS).map((key) => {
            const s = ENV_STYLES[key];
            const isActive = envKey === key;
            return (
              <button
                key={key}
                disabled={isActive}
                onClick={() => { setEnvKey(key); handleClear(); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all
                  ${s.badge}
                  ${isActive ? `ring-2 ${s.active} opacity-100` : 'opacity-60 hover:opacity-90'}
                  disabled:cursor-default`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${isActive ? 'animate-pulse' : ''}`} />
                {ENVIRONMENTS[key].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 时间范围 */}
      <div className="bg-dark rounded-xl p-6 border border-gray-700 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2"><span>🗓️</span> 时间范围</h3>
          {spanLabel && <span className="text-xs text-gray-500">跨度：{spanLabel}</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DateTimePicker label="开始时间" variant="start" date={fromDate} time={fromTime}
            onDateChange={setFromDate} onTimeChange={setFromTime} disabled={isActive} />
          <DateTimePicker label="结束时间" variant="end" date={toDate} time={toTime}
            onDateChange={setToDate} onTimeChange={setToTime} disabled={isActive} />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-2">快捷选择</p>
          <div className="flex flex-wrap gap-2">
            {TIME_PRESETS.map(({label, mins}) => (
              <button key={label} disabled={isActive} onClick={() => applyPreset(mins)}
                className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600 hover:border-gray-500 transition-colors disabled:opacity-40">
                最近 {label}
              </button>
            ))}
          </div>
        </div>

        {/* 操作按钮行 */}
        <div className="flex items-center gap-3 flex-wrap">
          {!isActive && (
            <button onClick={() => handleFetch()}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              获取日志
            </button>
          )}
          {isActive && (
            <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
              {isPaused ? (
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-900/40 border border-yellow-700 rounded-lg text-yellow-300 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                  已暂停
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900/40 border border-blue-700 rounded-lg text-blue-300 text-xs">
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32 10"/>
                  </svg>
                  获取中...
                </span>
              )}
            </div>
          )}
          <FetchControls status={status} onPause={handlePause} onResume={handleResume} onAbort={handleAbort} />
          <button
            onClick={handleClear}
            disabled={isActive}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-red-900/50 border border-gray-700 hover:border-red-700 text-gray-300 hover:text-red-300 text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            清空日志信息
          </button>
        </div>
      </div>

      {/* 错误 */}
      {status === 'error' && (
        <div className="flex items-start gap-3 p-4 bg-red-900/30 border border-red-700 rounded-xl text-red-300 text-sm">
          <span className="mt-0.5">⚠️</span>
          <div><p className="font-medium">获取失败</p><p className="text-xs text-red-400 mt-1">{error}</p></div>
        </div>
      )}
      {error && status !== 'error' && (
        <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg text-yellow-300 text-xs">{error}</div>
      )}

      {/* 终止提示 */}
      {status === 'aborted' && (
        <div className="flex items-center gap-3 p-4 bg-orange-900/30 border border-orange-700 rounded-xl text-orange-300 text-sm">
          <span>⏹️</span>
          <p>已终止，以下数据为截止终止时已获取的内容</p>
        </div>
      )}

      {/* 进度面板 */}
      {isActive && (
        <div className="bg-dark rounded-xl p-6 border border-gray-700 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300">📡 获取进度</h3>
          <ProgressBar label="Traces" value={traceProgress.fetched} max={traceProgress.total} />
          <ProgressBar label="Observations" value={obsProgress.fetched} max={obsProgress.total} />
        </div>
      )}

      {/* 结果区域 */}
      {shouldShowResults && (
        <div className="space-y-6">
          {/* 统计卡片 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Traces', value: traces.length, color: 'text-primary' },
              { label: 'Observations', value: observations.length, color: 'text-accent' },
              { label: '匹配 Session', value: sessionIds.length, color: 'text-secondary' },
              { label: '已过滤空记录', value: totalFiltered, color: 'text-gray-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-dark rounded-xl p-5 border border-gray-700">
                <p className="text-xs text-gray-400">{label}</p>
                <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {totalFiltered > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-800/60 border border-gray-700 rounded-lg text-xs text-gray-400">
              <span>🧹</span>
              <span>已过滤 {filteredCount.traces} 条空 Trace、{filteredCount.obs} 条空 Observation（input / output / name 均为空）</span>
            </div>
          )}

          {sessionIds.length > 0 && (
            <div className="bg-dark rounded-xl p-5 border border-gray-700">
              <p className="text-xs text-gray-400 mb-2">已关联 Session IDs</p>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {sessionIds.map((sid) => (
                  <span key={sid} className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded-md font-mono">{sid}</span>
                ))}
              </div>
            </div>
          )}

          {/* 下载 */}
          <div className="bg-dark rounded-xl p-5 border border-gray-700">
            <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2"><span>⬇️</span> 下载数据</h3>
            <div className="flex flex-wrap gap-3">
              <button onClick={handleGenerateSummaryAndSendEmail}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8m-18 8h18a2 2 0 002-2V8a2 2 0 00-2-2H3a2 2 0 00-2 2v6a2 2 0 002 2z" />
                </svg>
                生成总结报告并发送邮件
              </button>
              <button onClick={handleSessionExcel}
                className="flex items-center gap-2 px-5 py-2.5 bg-secondary hover:bg-purple-400 text-white text-sm font-medium rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                下载日志提取 Excel
              </button>
              <button onClick={handleExcel}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-emerald-400 text-white text-sm font-medium rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                下载 Excel（Traces + Observations）
              </button>
              {JSON_DOWNLOADS.map(({ type, label }) => (
                <button key={type} onClick={() => handleDownloadJSON(type)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 预览 */}
          <div className="bg-dark rounded-xl p-6 border border-gray-700 space-y-8">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <span>👁️</span> 数据预览
              <span className="text-xs text-gray-500 font-normal ml-1">每页 20 条 · 拖动横向滚动 · 悬浮单元格查看完整内容</span>
            </h3>
            <DataTable title="日志提取" data={sessionRows} color="secondary" />
            <div className="border-t border-gray-800 pt-6">
              <DataTable title="Traces" data={traces} color="primary" />
            </div>
            <div className="border-t border-gray-800 pt-6">
              <DataTable title="Observations" data={observations} color="accent" />
            </div>
          </div>

          <div className="flex items-center justify-between pb-2">
            <span className="text-xs text-gray-600">
              数据时间范围：{fmtTime(toISO(fromDate, fromTime))} → {fmtTime(toISO(toDate, toTime))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
