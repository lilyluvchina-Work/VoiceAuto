import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  SUMMARY_REPORT_EVENT,
  SUMMARY_REPORT_STORAGE_KEY,
  ENVIRONMENT_INFO_FIELDS,
  buildSummaryReportHtml,
  buildSummaryReportText,
  categorizeSubmissionParams,
  exportSummaryReportExcel,
  normalizeSubmissionParams,
} from '../utils/summaryReportBuilder';

function loadSummaryReport() {
  try {
    const raw = localStorage.getItem(SUMMARY_REPORT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '-';
  return `${n.toFixed(1)} ms`;
}

const inputClass = 'mt-1 w-full px-3 py-2 bg-gray-950/70 border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const compactInputClass = 'w-full px-2.5 py-1.5 bg-gray-950/70 border border-gray-700 rounded-md text-xs text-white placeholder-gray-500 focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

function ReadonlyField({ label, value, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs text-gray-400">{label}</span>
      <div className="mt-1 w-full px-3 py-2 bg-gray-950/60 border border-gray-800 rounded-md text-sm text-gray-200">
        {value || '/'}
      </div>
    </label>
  );
}

function EditableField({ label, value, onChange, multiline = false, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs text-gray-400">{label}</span>
      {multiline ? (
        <textarea
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} min-h-[72px] resize-y`}
        />
      ) : (
        <input
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      )}
    </label>
  );
}

function Section({ title, subtitle, children, action }) {
  return (
    <section className="bg-gray-900/35 rounded-lg border border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-700 bg-gray-900/50 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
          {subtitle ? <p className="text-xs text-gray-500 mt-1">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

function EmptyState({ children }) {
  return <p className="px-5 py-8 text-sm text-gray-500 text-center">{children}</p>;
}

function downloadTextFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function safeFilenamePart(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function isParamHeader(name, value) {
  const left = String(name || '').trim();
  const right = String(value || '').trim();
  return /^(参数|参数名|名称|字段|项目|key|name)$/i.test(left)
    && /^(值|参数值|内容|value)$/i.test(right);
}

function pushParamCandidate(list, name, value, extra = {}) {
  const paramName = String(name || '').trim();
  const paramValue = String(value || '').trim();
  if (!paramName || !paramValue || isParamHeader(paramName, paramValue)) {
    return;
  }
  if (/^(参数|参数名|名称|字段|项目)$/i.test(paramName) && paramValue.length <= 2) {
    return;
  }
  list.push({ ...extra, name: paramName, value: paramValue });
}

function isParamCategory(value) {
  return /^(服务环境和版本|模型配置|语音识别配置)$/i.test(String(value || '').trim());
}

function isVoiceParamGroup(value) {
  return /^(Speaker|魔童)$/i.test(String(value || '').trim());
}

function parseParameterRows(rows) {
  const result = [];
  (rows || []).forEach((rawRow) => {
    const row = (rawRow || []).map((cell) => String(cell ?? '').trim());
    const nonEmpty = row.filter(Boolean);
    if (nonEmpty.length === 0) return;

    if (nonEmpty.length === 1) {
      const match = nonEmpty[0].match(/^(.+?)\s*[:：=]\s*(.+)$/);
      if (match) pushParamCandidate(result, match[1], match[2]);
      return;
    }

    if (nonEmpty.length >= 4 && isParamCategory(nonEmpty[0]) && isVoiceParamGroup(nonEmpty[1])) {
      pushParamCandidate(result, nonEmpty[2], nonEmpty[3], { category: nonEmpty[0], group: nonEmpty[1] });
      return;
    }

    if (nonEmpty.length >= 3 && isParamCategory(nonEmpty[0])) {
      pushParamCandidate(result, nonEmpty[1], nonEmpty[2], { category: nonEmpty[0] });
      return;
    }

    if (nonEmpty.length >= 3 && isVoiceParamGroup(nonEmpty[0])) {
      pushParamCandidate(result, nonEmpty[1], nonEmpty[2], { category: '语音识别配置', group: nonEmpty[0] });
      return;
    }

    for (let index = 0; index < row.length - 1; index += 2) {
      pushParamCandidate(result, row[index], row[index + 1]);
    }
  });
  return result;
}

async function parseParameterFile(file) {
  const lowerName = String(file?.name || '').toLowerCase();
  if (lowerName.endsWith('.txt')) {
    const text = await file.text();
    const rows = text.split(/\r?\n/).map((line) => line.split(/\t|,|，|\|/));
    return parseParameterRows(rows);
  }

  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const rows = [];
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    rows.push(...XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }));
  });
  return parseParameterRows(rows);
}

function mergeSubmissionParams(currentParams, importedParams) {
  return normalizeSubmissionParams([...(currentParams || []), ...(importedParams || [])]);
}

function normalizeFieldName(value) {
  return String(value || '').toLowerCase().replace(/[\s/:：=_\-—–|,，.。()（）[\]【】]+/g, '');
}

const reportTableColumns = [
  { label: '用例ID', key: 'caseId', className: 'w-[120px] text-gray-300 whitespace-nowrap' },
  { label: '目标文本（测试音频文本）', key: 'testAudioText', className: 'w-[220px] text-gray-200 leading-relaxed whitespace-pre-wrap' },
  { label: '实际输入（日志提取的输入）', key: 'logInputText', important: true, className: 'w-[220px] text-sky-100 bg-sky-950/25 leading-relaxed whitespace-pre-wrap' },
  { label: '输出（output.content）', key: 'logOutput', important: true, className: 'w-[300px] text-sky-100 bg-sky-950/25 leading-relaxed whitespace-pre-wrap' },
  { label: '目标Agent', key: 'targetAgent', important: true, className: 'w-[130px] text-indigo-100 bg-indigo-950/25 whitespace-nowrap font-medium' },
  { label: '命中Agent', key: 'actualAgent', important: true, className: 'w-[130px] text-indigo-100 bg-indigo-950/25 whitespace-nowrap font-medium' },
  { label: '命中子Agent', key: 'actualSubAgent', className: 'w-[130px] text-gray-200 whitespace-nowrap' },
  { label: 'Agent是否命中', key: 'agentMatched', important: true, className: 'w-[110px] bg-gray-950/30 whitespace-nowrap' },
  { label: '结论', key: 'testResult', important: true, className: 'w-[90px] bg-gray-950/30 whitespace-nowrap' },
  { label: '响应时长', key: 'responseText', important: true, className: 'w-[110px] text-amber-100 bg-amber-950/25 whitespace-nowrap font-medium' },
  { label: '错误信息', key: 'logError', important: true, className: 'w-[240px] text-red-100 bg-red-950/20 leading-relaxed whitespace-pre-wrap' },
  { label: '文本相似度', key: 'inputSimilarity', className: 'w-[100px] text-gray-300 whitespace-nowrap' },
  { label: '文本匹配状态', key: 'textMatchStatus', className: 'w-[120px] text-gray-300 whitespace-nowrap' },
  { label: '匹配方式', key: 'matchMethod', className: 'w-[120px] text-gray-300 whitespace-nowrap' },
  { label: '日志状态', key: 'logStatus', className: 'w-[110px] text-gray-300 whitespace-nowrap' },
  { label: 'VadDuration', key: 'vadDuration', className: 'w-[110px] text-gray-300 whitespace-nowrap' },
  { label: 'ASRDuration', key: 'asrDuration', className: 'w-[110px] text-gray-300 whitespace-nowrap' },
  { label: 'TTSDuration', key: 'ttsDuration', className: 'w-[110px] text-gray-300 whitespace-nowrap' },
  { label: 'LLMDuration', key: 'llmDuration', className: 'w-[110px] text-gray-300 whitespace-nowrap' },
  { label: 'FirstToken', key: 'firstTokenDuration', className: 'w-[110px] text-accent font-medium whitespace-nowrap' },
];

function findEnvironmentInfoField(name) {
  const normalizedName = normalizeFieldName(name);
  return ENVIRONMENT_INFO_FIELDS.find((field) => normalizeFieldName(field.label) === normalizedName);
}

function splitImportedEnvironmentInfo(importedParams) {
  const environmentPatch = {};
  const submissionParamRows = [];

  (importedParams || []).forEach((item) => {
    if (String(item?.category || '').trim() === '服务环境和版本') {
      const field = findEnvironmentInfoField(item.name);
      if (field) {
        environmentPatch[field.key] = item.value;
        return;
      }
    }
    submissionParamRows.push(item);
  });

  return { environmentPatch, submissionParamRows };
}

function renderReportCell(item, column) {
  if (column.key === 'agentMatched') {
    return (
      <span className={item.agentMatched === '一致' ? 'text-emerald-300 font-semibold' : 'text-red-300 font-semibold'}>
        {item.agentMatched || '/'}
      </span>
    );
  }
  if (column.key === 'testResult') {
    return (
      <span className={item.testPassed ? 'text-emerald-300 font-semibold' : 'text-red-300 font-semibold'}>
        {item.testResult || '/'}
      </span>
    );
  }
  if (column.key === 'responseText') {
    return item.responseText || formatMs(item.responseMs) || '/';
  }
  const value = item[column.key];
  return value ?? '/';
}

export default function SummaryReport() {
  const [report, setReport] = useState(() => loadSummaryReport());
  const paramFileInputRef = useRef(null);

  useEffect(() => {
    const onUpdate = (event) => {
      if (event?.detail) {
        setReport(event.detail);
        return;
      }
      setReport(loadSummaryReport());
    };

    window.addEventListener(SUMMARY_REPORT_EVENT, onUpdate);
    return () => window.removeEventListener(SUMMARY_REPORT_EVENT, onUpdate);
  }, []);

  const moduleRows = useMemo(() => report?.moduleStats || report?.moduleAverages || [], [report]);
  const submissionParams = useMemo(() => normalizeSubmissionParams(report?.submissionParams || []), [report]);
  const submissionParamGroups = useMemo(() => categorizeSubmissionParams(submissionParams), [submissionParams]);
  const caseDetails = useMemo(() => report?.caseDetails || [], [report]);
  const reportRows = useMemo(() => report?.reportRows || caseDetails, [report, caseDetails]);

  const persistReport = (nextReport) => {
    setReport(nextReport);
    try {
      localStorage.setItem(SUMMARY_REPORT_STORAGE_KEY, JSON.stringify(nextReport));
    } catch {
      // ignore storage errors
    }
    window.dispatchEvent(new CustomEvent(SUMMARY_REPORT_EVENT, { detail: nextReport }));
  };

  const updateReport = (patch, regenerateText = true) => {
    const nextReport = { ...report, ...patch };
    if (regenerateText) {
      nextReport.text = buildSummaryReportText(nextReport);
    }
    persistReport(nextReport);
  };

  const updateSubmissionParamValue = (target, value) => {
    const nextParams = submissionParams.map((item) => (
      item.category === target.category && item.group === target.group && item.name === target.name
        ? { ...item, value }
        : item
    ));
    updateReport({ submissionParams: nextParams });
  };

  const regenerateReportText = () => {
    updateReport({ text: buildSummaryReportText(report) }, false);
  };

  const getExportBaseName = () => {
    const runId = safeFilenamePart(report?.runId) || 'summary';
    const date = new Date().toISOString().slice(0, 10);
    return `VoiceAuto总结报告_${runId}_${date}`;
  };

  const handleExportMarkdown = () => {
    const content = buildSummaryReportText(report);
    downloadTextFile(content, `${getExportBaseName()}.md`, 'text/markdown;charset=utf-8');
  };

  const handleExportHtml = () => {
    downloadTextFile(buildSummaryReportHtml(report), `${getExportBaseName()}.html`, 'text/html;charset=utf-8');
  };

  const handleExportExcel = () => {
    exportSummaryReportExcel(report, `${getExportBaseName()}.xlsx`);
  };

  const handleClearReport = () => {
    if (!window.confirm('确认清空当前总结报告内容吗？清空后需要重新生成报告。')) {
      return;
    }
    try {
      localStorage.removeItem(SUMMARY_REPORT_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    setReport(null);
    window.dispatchEvent(new CustomEvent(SUMMARY_REPORT_EVENT, { detail: null }));
  };

  const handleRefreshReport = () => {
    setReport(loadSummaryReport());
  };

  const handleExportEnvironmentTemplate = () => {
    const environmentRows = ENVIRONMENT_INFO_FIELDS.map((field) => [
      '服务环境和版本',
      '',
      field.label,
      report?.[field.key] || '',
    ]);
    const submissionRows = submissionParams.map((item) => [
      item.category || '',
      item.group || '',
      item.name || '',
      item.value === '/' ? '' : (item.value || ''),
    ]);
    const rows = [
      ['分类', '分组', '参数', '值'],
      ...environmentRows,
      ...submissionRows,
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 30 }, { wch: 42 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '环境信息模板');
    XLSX.writeFile(workbook, `${getExportBaseName()}_环境信息模板.xlsx`);
  };

  const handleImportParamsClick = () => {
    paramFileInputRef.current?.click();
  };

  const handleImportParams = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const importedParams = await parseParameterFile(file);
      if (!importedParams.length) {
        alert('未识别到可导入的环境信息，请检查文件是否为“参数名-参数值”格式。');
        return;
      }

      const { environmentPatch, submissionParamRows } = splitImportedEnvironmentInfo(importedParams);
      const nextParams = mergeSubmissionParams(submissionParams, submissionParamRows);
      const environmentCount = Object.keys(environmentPatch).length;
      updateReport({ submissionParams: nextParams, ...environmentPatch });
      alert(`已导入 ${submissionParamRows.length + environmentCount} 条环境信息。`);
    } catch (error) {
      console.error('导入环境信息失败:', error);
      alert(`导入环境信息失败：${error.message || '文件解析异常'}`);
    }
  };

  if (!report) {
    return (
      <div className="bg-dark rounded-xl p-6 border border-gray-700">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <span className="text-2xl">🧾</span>
            总结报告
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleRefreshReport}
              className="px-3 py-1.5 rounded-md bg-gray-700 text-gray-100 hover:bg-gray-600 text-xs transition-colors"
            >
              刷新
            </button>
            <button
              type="button"
              onClick={handleClearReport}
              className="px-3 py-1.5 rounded-md border border-red-700/70 bg-red-950/35 text-red-200 hover:bg-red-900/45 text-xs transition-colors"
            >
              清空
            </button>
          </div>
        </div>
        <div className="text-center py-12 text-gray-500">
          <p className="text-4xl mb-4">📭</p>
          <p>暂无总结报告</p>
          <p className="text-sm mt-2">请先在 Langfuse 日志页面点击“生成报告”</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-dark rounded-xl p-6 border border-gray-700 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap border-b border-gray-800 pb-5">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2 text-white">
            <span className="text-2xl">🧾</span>
            总结报告
          </h2>
          <p className="text-xs text-gray-400 mt-2">生成时间：{report.generatedAtText || '-'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="px-3 py-1.5 rounded-md border border-emerald-700/60 bg-emerald-900/20 text-emerald-300 text-xs">
            基础信息与功能统计区域为只读，其他内容可编辑并自动保存
          </div>
          <button
            type="button"
            onClick={handleRefreshReport}
            className="px-3 py-1.5 rounded-md bg-gray-700 text-gray-100 hover:bg-gray-600 text-xs transition-colors"
          >
            刷新报告
          </button>
          <button
            type="button"
            onClick={handleClearReport}
            className="px-3 py-1.5 rounded-md border border-red-700/70 bg-red-950/35 text-red-200 hover:bg-red-900/45 text-xs transition-colors"
          >
            清空报告
          </button>
        </div>
      </div>

      <Section title="基础信息" subtitle="报告的计划、时间与负责人信息（只读）">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5 text-sm">
          <div className="bg-gray-950/35 rounded-lg p-4 border border-gray-800">
            <ReadonlyField
              label="导入的测试计划"
              value={report.importedPlans?.length ? report.importedPlans.join('、') : ''}
            />
          </div>
          <div className="bg-gray-950/35 rounded-lg p-4 border border-gray-800">
            <ReadonlyField label="测试时间" value={report.testTime || ''} />
          </div>
          <div className="bg-gray-950/35 rounded-lg p-4 border border-gray-800">
            <ReadonlyField label="测试负责人" value={report.testOwner || ''} />
          </div>
        </div>
      </Section>

      <Section
        title="环境信息"
        subtitle="缺失数据使用 / 补充，可按本次测试实际情况调整"
        action={(
          <div className="flex flex-wrap gap-2">
            <input
              ref={paramFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              onChange={handleImportParams}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleExportEnvironmentTemplate}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-xs text-gray-100 transition-colors"
            >
              导出模板
            </button>
            <button
              type="button"
              onClick={handleImportParamsClick}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-md text-xs text-white transition-colors"
            >
              导入信息
            </button>
          </div>
        )}
      >
        {submissionParams.length === 0 ? (
          <EmptyState>暂无环境信息</EmptyState>
        ) : (
          <div className="space-y-px bg-gray-800">
            <div className="bg-gray-900/60">
              <div className="px-4 py-2.5 bg-gray-950/45 border-b border-gray-800 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-blue-100">服务环境和版本</h4>
                <span className="text-xs text-gray-500">{ENVIRONMENT_INFO_FIELDS.length} 项</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-gray-800">
                {ENVIRONMENT_INFO_FIELDS.map((field) => (
                  <div key={field.key} className="px-4 py-3 bg-gray-900/65">
                    <p className="text-xs text-gray-500 mb-1.5 truncate" title={field.label}>{field.label}</p>
                    <input
                      value={report[field.key] ?? ''}
                      onChange={(event) => updateReport({ [field.key]: event.target.value })}
                      className={compactInputClass}
                    />
                  </div>
                ))}
              </div>
            </div>
            {submissionParamGroups.map((group) => (
              <div key={group.category} className="bg-gray-900/60">
                <div className="px-4 py-2.5 bg-gray-950/45 border-b border-gray-800 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-blue-100">{group.category}</h4>
                  <span className="text-xs text-gray-500">{group.items.length} 项</span>
                </div>
                {group.subGroups?.length ? (
                  <div className="space-y-px bg-gray-800">
                    {group.subGroups.map((subGroup) => (
                      <div key={`${group.category}-${subGroup.group}`} className="bg-gray-900/65">
                        <div className="px-4 py-2 bg-gray-950/25 border-b border-gray-800 text-xs font-semibold text-gray-300">
                          {subGroup.group}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-px bg-gray-800">
                          {subGroup.items.map((item) => (
                            <div key={`${group.category}-${subGroup.group}-${item.name}`} className="px-4 py-3 bg-gray-900/65">
                              <p className="text-xs text-gray-500 mb-1.5 truncate" title={`${subGroup.group} ${item.name}`}>{item.name}</p>
                              <input
                                value={item.value ?? ''}
                                onChange={(event) => updateSubmissionParamValue(item, event.target.value)}
                                className={compactInputClass}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-gray-800">
                    {group.items.map((item) => (
                      <div key={`${group.category}-${item.name}`} className="px-4 py-3 bg-gray-900/65">
                        <p className="text-xs text-gray-500 mb-1.5 truncate" title={item.name}>{item.name}</p>
                        <input
                          value={item.value ?? ''}
                          onChange={(event) => updateSubmissionParamValue(item, event.target.value)}
                          className={compactInputClass}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="功能模块统计" subtitle="按模块查看 Agent 命中率、平均耗时与用例覆盖情况（只读）">
        {moduleRows.length === 0 ? (
          <EmptyState>暂无模块响应时间数据</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[1.5fr_1fr_1fr_0.8fr] gap-3 px-5 py-2.5 bg-gray-950/45 border-b border-gray-800 text-xs text-gray-500">
                <span>功能模块</span>
                <span>Agent 命中率</span>
                <span>平均耗时</span>
                <span>用例数</span>
              </div>
              <div className="divide-y divide-gray-800">
            {moduleRows.map((item) => (
              <div key={item.module} className="px-5 py-3 grid grid-cols-[1.5fr_1fr_1fr_0.8fr] gap-3 text-sm hover:bg-gray-900/45 transition-colors">
                <div className={`${compactInputClass} border-gray-800 text-gray-200`} title="功能模块">{item.module || '/'}</div>
                <div className={`${compactInputClass} border-gray-800 text-gray-200`} title="Agent命中率">{item.agentHitRate || '/'}</div>
                <div className={`${compactInputClass} border-gray-800 text-gray-200`} title="平均耗时">{item.avgResponseText || formatMs(item.avgResponseMs) || '/'}</div>
                <div className={`${compactInputClass} border-gray-800 text-gray-200`} title="用例数">{item.caseCount ?? '/'}</div>
              </div>
            ))}
              </div>
            </div>
          </div>
        )}
        <div className="px-5 py-4 border-t border-gray-700 grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-950/35">
          <div className="bg-gray-900/60 rounded-lg p-4 border border-gray-800">
            <ReadonlyField label="Agent总命中率" value={report.overallAgentHitRate || ''} />
          </div>
          <div className="bg-gray-900/60 rounded-lg p-4 border border-gray-800">
            <ReadonlyField label="整体平均耗时" value={report.overallAvgResponseText || formatMs(report.overallAvgResponseMs)} />
          </div>
        </div>
      </Section>

      <Section title="报告表格" subtitle="以本次实际测试音频为主，未测试的导入用例不参与报告生成">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-5 border-b border-gray-800 bg-gray-950/25">
          <div className="bg-gray-900/45 rounded-lg p-4 border border-gray-700">
            <EditableField label="用例总数" value={report.totalCases ?? ''} onChange={(value) => updateReport({ totalCases: value })} />
          </div>
          <div className="bg-gray-900/45 rounded-lg p-4 border border-gray-700">
            <EditableField label="用例执行数量" value={report.executedCases ?? ''} onChange={(value) => updateReport({ executedCases: value })} />
          </div>
          <div className="bg-gray-900/45 rounded-lg p-4 border border-gray-700">
            <EditableField label="用例执行率" value={report.executionRate || ''} onChange={(value) => updateReport({ executionRate: value })} />
          </div>
        </div>
        {reportRows.length === 0 ? (
          <EmptyState>暂无报告表格数据</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[2320px] w-full text-xs">
              <thead className="bg-gray-950/60 text-gray-400">
                <tr>
                  {reportTableColumns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-3 py-3 text-left font-medium whitespace-nowrap ${column.important ? 'bg-primary/15 text-blue-100' : ''}`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {reportRows.map((item) => (
                  <tr key={`${item.caseId || item.sessionID}-${item.index}`} className="align-top hover:bg-gray-900/45 transition-colors">
                    {reportTableColumns.map((column) => (
                      <td key={column.key} className={`px-3 py-3 ${column.className}`}>
                        {renderReportCell(item, column)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="报告正文"
        subtitle="Markdown 格式正文，可导出为 Markdown 或带样式 HTML"
        action={(
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={regenerateReportText}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-xs text-gray-100 transition-colors"
            >
              刷新正文格式
            </button>
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="px-3 py-1.5 bg-primary hover:bg-blue-600 rounded-md text-xs text-white transition-colors"
            >
              导出 Markdown
            </button>
            <button
              type="button"
              onClick={handleExportHtml}
              className="px-3 py-1.5 bg-accent hover:bg-emerald-600 rounded-md text-xs text-white transition-colors"
            >
              导出 HTML
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-md text-xs text-white transition-colors"
            >
              导出 Excel
            </button>
          </div>
        )}
      >
        <div className="p-5">
          <textarea
            value={report.text || ''}
            onChange={(event) => updateReport({ text: event.target.value }, false)}
            className="w-full min-h-[520px] px-4 py-3 bg-gray-950/70 border border-gray-700 rounded-lg text-sm text-gray-300 whitespace-pre-wrap leading-7 resize-y focus:border-primary focus:ring-1 focus:ring-primary font-mono"
          />
        </div>
      </Section>
    </div>
  );
}
