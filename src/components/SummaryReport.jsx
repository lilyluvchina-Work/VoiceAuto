import React, { useEffect, useMemo, useState } from 'react';
import {
  SUMMARY_REPORT_EVENT,
  SUMMARY_REPORT_STORAGE_KEY,
  buildSummaryReportText,
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

export default function SummaryReport() {
  const [report, setReport] = useState(() => loadSummaryReport());

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
  const submissionParams = useMemo(() => report?.submissionParams || [], [report]);
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

  const updateArrayItem = (key, index, patch) => {
    const sourceRows = key === 'moduleStats' ? moduleRows : report?.[key];
    const rows = Array.isArray(sourceRows) ? [...sourceRows] : [];
    rows[index] = { ...(rows[index] || {}), ...patch };
    const patchPayload = { [key]: rows };
    if (key === 'moduleStats') {
      patchPayload.moduleAverages = rows;
    }
    updateReport(patchPayload);
  };

  const updateImportedPlans = (value) => {
    const plans = value
      .split(/[、,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    updateReport({ importedPlans: plans });
  };

  if (!report) {
    return (
      <div className="bg-dark rounded-xl p-6 border border-gray-700">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <span className="text-2xl">🧾</span>
          总结报告
        </h2>
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
        <div className="px-3 py-1.5 rounded-md border border-emerald-700/60 bg-emerald-900/20 text-emerald-300 text-xs">
          页面内容可直接编辑，修改后自动保存
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-gray-900/45 rounded-lg p-4 border border-gray-700">
          <EditableField label="测试环境" value={report.testEnvironment || ''} onChange={(value) => updateReport({ testEnvironment: value })} />
        </div>
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

      <Section title="基础信息" subtitle="报告的计划、时间与负责人信息">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5 text-sm">
          <div className="bg-gray-950/35 rounded-lg p-4 border border-gray-800">
            <EditableField
              label="导入的测试计划"
              value={report.importedPlans?.length ? report.importedPlans.join('、') : ''}
              onChange={updateImportedPlans}
              multiline
            />
          </div>
          <div className="bg-gray-950/35 rounded-lg p-4 border border-gray-800">
            <EditableField label="测试时间" value={report.testTime || ''} onChange={(value) => updateReport({ testTime: value })} multiline />
          </div>
          <div className="bg-gray-950/35 rounded-lg p-4 border border-gray-800">
            <EditableField label="测试负责人" value={report.testOwner || ''} onChange={(value) => updateReport({ testOwner: value })} />
          </div>
        </div>
      </Section>

      <Section title="提测参数" subtitle="缺失数据使用 / 补充，可按本次提测实际情况调整">
        {submissionParams.length === 0 ? (
          <EmptyState>暂无提测参数</EmptyState>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-gray-800">
            {submissionParams.map((item) => (
              <div key={item.name} className="px-4 py-3 bg-gray-900/65">
                <p className="text-xs text-gray-500 mb-1.5 truncate" title={item.name}>{item.name}</p>
                <input
                  value={item.value ?? ''}
                  onChange={(event) => updateArrayItem('submissionParams', submissionParams.indexOf(item), { value: event.target.value })}
                  className={compactInputClass}
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="功能模块统计" subtitle="按模块查看 Agent 命中率、平均耗时与用例覆盖情况">
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
                <input
                  value={item.module ?? ''}
                  onChange={(event) => updateArrayItem('moduleStats', moduleRows.indexOf(item), { module: event.target.value })}
                  className={compactInputClass}
                  title="功能模块"
                />
                <input
                  value={item.agentHitRate ?? ''}
                  onChange={(event) => updateArrayItem('moduleStats', moduleRows.indexOf(item), { agentHitRate: event.target.value })}
                  className={compactInputClass}
                  title="Agent命中率"
                />
                <input
                  value={item.avgResponseText || formatMs(item.avgResponseMs)}
                  onChange={(event) => updateArrayItem('moduleStats', moduleRows.indexOf(item), { avgResponseText: event.target.value })}
                  className={compactInputClass}
                  title="平均耗时"
                />
                <input
                  value={item.caseCount ?? ''}
                  onChange={(event) => updateArrayItem('moduleStats', moduleRows.indexOf(item), { caseCount: event.target.value })}
                  className={compactInputClass}
                  title="用例数"
                />
              </div>
            ))}
              </div>
            </div>
          </div>
        )}
        <div className="px-5 py-4 border-t border-gray-700 grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-950/35">
          <div className="bg-gray-900/60 rounded-lg p-4 border border-gray-800">
            <EditableField label="Agent总命中率" value={report.overallAgentHitRate || ''} onChange={(value) => updateReport({ overallAgentHitRate: value })} />
          </div>
          <div className="bg-gray-900/60 rounded-lg p-4 border border-gray-800">
            <EditableField label="整体平均耗时" value={report.overallAvgResponseText || formatMs(report.overallAvgResponseMs)} onChange={(value) => updateReport({ overallAvgResponseText: value })} />
          </div>
        </div>
      </Section>

      <Section title="报告表格" subtitle="以测试计划目标文本为主，优先按 run_id + case_id 对齐 Langfuse 日志">
        {reportRows.length === 0 ? (
          <EmptyState>暂无报告表格数据</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[2100px] w-full text-xs">
              <thead className="bg-gray-950/60 text-gray-400">
                <tr>
                  {[
                    '用例ID',
                    '目标文本（测试音频文本）',
                    '目标Agent',
                    '实际输入（日志提取的输入）',
                    '命中Agent',
                    'Agent是否命中',
                    '文本相似度',
                    '文本匹配状态',
                    '匹配方式',
                    '结论',
                    '输出（output.content）',
                    'VadDuration',
                    'ASRDuration',
                    'TTSDuration',
                    'LLMDuration',
                    'FirstToken',
                    '错误信息',
                  ].map((header) => (
                    <th key={header} className="px-3 py-3 text-left font-medium whitespace-nowrap">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {reportRows.map((item) => (
                  <tr key={`${item.caseId || item.sessionID}-${item.index}`} className="align-top hover:bg-gray-900/45 transition-colors">
                    <td className="px-3 py-3 w-[120px] text-gray-300 whitespace-nowrap">
                      {item.caseId || '/'}
                    </td>
                    <td className="px-3 py-3 w-[220px] text-gray-200 leading-relaxed whitespace-pre-wrap">
                      {item.testAudioText || '/'}
                    </td>
                    <td className="px-3 py-3 w-[130px] text-gray-200 whitespace-nowrap">
                      {item.targetAgent || '/'}
                    </td>
                    <td className="px-3 py-3 w-[220px] text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {item.logInputText || '/'}
                    </td>
                    <td className="px-3 py-3 w-[130px] text-gray-200 whitespace-nowrap">
                      {item.actualAgent || '/'}
                    </td>
                    <td className="px-3 py-3 w-[110px] whitespace-nowrap">
                      <span className={item.agentMatched === '一致' ? 'text-emerald-300' : 'text-red-300'}>
                        {item.agentMatched || '/'}
                      </span>
                    </td>
                    <td className="px-3 py-3 w-[100px] text-gray-300 whitespace-nowrap">
                      {item.inputSimilarity || '/'}
                    </td>
                    <td className="px-3 py-3 w-[120px] text-gray-300 whitespace-nowrap">
                      {item.textMatchStatus || '/'}
                    </td>
                    <td className="px-3 py-3 w-[120px] text-gray-300 whitespace-nowrap">
                      {item.matchMethod || '/'}
                    </td>
                    <td className="px-3 py-3 w-[90px] whitespace-nowrap">
                      <span className={item.testPassed ? 'text-emerald-300 font-medium' : 'text-red-300 font-medium'}>
                        {item.testResult || '/'}
                      </span>
                    </td>
                    <td className="px-3 py-3 w-[300px] text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {item.logOutput || '/'}
                    </td>
                    <td className="px-3 py-3 w-[110px] text-gray-300 whitespace-nowrap">
                      {item.vadDuration ?? '/'}
                    </td>
                    <td className="px-3 py-3 w-[110px] text-gray-300 whitespace-nowrap">
                      {item.asrDuration ?? '/'}
                    </td>
                    <td className="px-3 py-3 w-[110px] text-gray-300 whitespace-nowrap">
                      {item.ttsDuration ?? '/'}
                    </td>
                    <td className="px-3 py-3 w-[110px] text-gray-300 whitespace-nowrap">
                      {item.llmDuration ?? '/'}
                    </td>
                    <td className="px-3 py-3 w-[110px] text-accent font-medium whitespace-nowrap">
                      {item.firstTokenDuration ?? '/'}
                    </td>
                    <td className="px-3 py-3 w-[240px] text-gray-300 leading-relaxed whitespace-pre-wrap">
                      {item.logError || '/'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="报告正文" subtitle="正文会随上方结构化字段自动更新，也可以手动微调">
        <div className="p-5">
        <textarea
          value={report.text || ''}
          onChange={(event) => updateReport({ text: event.target.value }, false)}
          className="w-full min-h-[320px] px-4 py-3 bg-gray-950/70 border border-gray-700 rounded-lg text-sm text-gray-300 whitespace-pre-wrap leading-7 resize-y focus:border-primary focus:ring-1 focus:ring-primary"
        />
        </div>
      </Section>
    </div>
  );
}
