import React, { useEffect, useMemo, useState } from 'react';
import {
  SUMMARY_REPORT_EMAIL,
  sendSummaryReportEmailAuto,
  openSummaryReportMailClient,
} from '../services/emailService';

const SUMMARY_REPORT_STORAGE_KEY = 'voiceauto_summary_report_v1';
const SUMMARY_REPORT_EVENT = 'voiceauto-summary-report-updated';

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

export default function SummaryReport() {
  const [report, setReport] = useState(() => loadSummaryReport());
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState('');

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

  const moduleRows = useMemo(() => report?.moduleAverages || [], [report]);

  const handleSendEmail = async () => {
    if (!report) return;
    setSending(true);
    setSendStatus('');

    try {
      await sendSummaryReportEmailAuto(report, SUMMARY_REPORT_EMAIL);
      setSendStatus(`已自动发送到 ${SUMMARY_REPORT_EMAIL}`);
    } catch {
      openSummaryReportMailClient(report, SUMMARY_REPORT_EMAIL);
      setSendStatus(`自动发送失败，已唤起邮件客户端发送到 ${SUMMARY_REPORT_EMAIL}`);
    } finally {
      setSending(false);
    }
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
          <p className="text-sm mt-2">请先在 Langfuse 日志页面点击“生成总结报告并发送邮件”</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-dark rounded-xl p-6 border border-gray-700 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <span className="text-2xl">🧾</span>
            总结报告
          </h2>
          <p className="text-xs text-gray-400 mt-1">生成时间：{report.generatedAtText || '-'}</p>
        </div>
        <button
          onClick={handleSendEmail}
          disabled={sending}
          className="px-4 py-2 bg-primary hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
        >
          {sending ? '发送中...' : '发送到 lily_lv@sdmctech.com'}
        </button>
      </div>

      {sendStatus && (
        <div className="px-3 py-2 text-xs rounded-lg border border-gray-700 bg-gray-800/60 text-gray-300">
          {sendStatus}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-400">测试环境</p>
          <p className="text-lg font-semibold text-white mt-1">{report.testEnvironment || '-'}</p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-400">执行用例条数</p>
          <p className="text-2xl font-bold text-primary mt-1">{report.executedCases || 0}</p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-400">执行通过率</p>
          <p className="text-2xl font-bold text-accent mt-1">{report.passRate || '0.0%'} </p>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <p className="text-xs text-gray-400">通过/失败</p>
          <p className="text-lg font-semibold text-white mt-1">{report.passedCases || 0}/{report.failedCases || 0}</p>
        </div>
      </div>

      <div className="bg-gray-800/40 rounded-lg border border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 text-sm font-medium text-gray-300">每个模块平均响应时间</div>
        {moduleRows.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">暂无模块响应时间数据</p>
        ) : (
          <div className="divide-y divide-gray-700">
            {moduleRows.map((item) => (
              <div key={item.module} className="px-4 py-3 grid grid-cols-3 gap-3 text-sm">
                <span className="text-white truncate" title={item.module}>{item.module}</span>
                <span className="text-gray-300">平均响应：{formatMs(item.avgResponseMs)}</span>
                <span className="text-gray-400">用例数：{item.caseCount}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-gray-900/60 rounded-lg p-4 border border-gray-700">
        <p className="text-sm text-gray-300 mb-2">报告正文</p>
        <pre className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">{report.text || '-'}</pre>
      </div>
    </div>
  );
}
