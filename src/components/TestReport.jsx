/**
 * 测试报告组件
 */
import React, { useState } from 'react';
import { useTest } from '../stores/testStore';
import {
  formatTime,
  generateReportText,
  generateReportJson,
  generateReportCsv,
  copyToClipboard
} from '../utils/audioUtils.jsx';
import { evaluateAgentReport } from '../utils/agentEvaluation';
import { summarizeMultiTurnCases } from '../utils/multiTurnDialogue';

export default function TestReport() {
  const { state } = useTest();
  const { wakeWord, report } = state;
  const selectedEvaluationMetrics = state.testOptions?.agentEvaluation?.selectedMetrics || [];
  const multiTurnSummary = React.useMemo(
    () => summarizeMultiTurnCases(report.cases),
    [report.cases]
  );
  const agentEvaluation = React.useMemo(
    () => evaluateAgentReport(report.cases, selectedEvaluationMetrics),
    [report.cases, selectedEvaluationMetrics]
  );

  const [showReport, setShowReport] = useState(false);

  const formatCaseTime = (value) => {
    const date = new Date(Number(value));
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  const formatCaseTimeRange = (testCase) => {
    const startText = formatCaseTime(testCase?.playStartTime);
    const endText = formatCaseTime(testCase?.playEndTime);
    if (startText === '-' && endText === '-') return '-';
    if (endText === '-') return startText;
    return `${startText} ~ ${endText}`;
  };

  const getReportData = () => ({
    startTime: report.startTime || Date.now(),
    endTime: report.endTime || Date.now(),
    wakeWord: wakeWord.text,
    wakeAfterDelay: wakeWord.wakeAfterDelay,
    wakeIntervalDelay: wakeWord.wakeIntervalDelay,
    totalCases: report.cases.length,
    successCount: report.successCount,
    failCount: report.failCount,
    totalDuration: report.endTime - report.startTime || 0,
    multiTurnSummary,
    agentEvaluation,
    testCases: report.cases
  });

  // 生成报告文本
  const getReportText = () => {
    if (report.cases.length === 0) return '';

    return generateReportText(getReportData());
  };

  const handleDownloadJson = () => {
    const content = JSON.stringify(generateReportJson(getReportData()), null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VoiceAuto测试报告_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const content = generateReportCsv(getReportData());
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VoiceAuto测试报告_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 复制报告
  const handleCopy = async () => {
    const text = getReportText();
    const success = await copyToClipboard(text);
    if (success) {
      alert('报告已复制到剪贴板');
    } else {
      alert('复制失败，请手动复制');
    }
  };

  // 下载报告
  const handleDownload = () => {
    const text = getReportText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VoiceAuto测试报告_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const successRate = report.cases.length > 0
    ? ((report.successCount / report.cases.length) * 100).toFixed(1)
    : 0;

  const avgTimePerCase = report.cases.length > 0 && report.endTime && report.startTime
    ? ((report.endTime - report.startTime) / report.cases.length / 1000).toFixed(1)
    : 0;

  if (report.cases.length === 0) {
    return (
      <div className="bg-dark rounded-xl p-6 border border-gray-700">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
          <span className="text-2xl">📊</span>
          测试报告
        </h2>
        <div className="text-center py-12 text-gray-500">
          <p className="text-4xl mb-4">📋</p>
          <p>暂无测试报告</p>
          <p className="text-sm mt-2">完成测试后将自动生成报告</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-dark rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <span className="text-2xl">📊</span>
          测试报告
          {report.endTime && (
            <span className="ml-2 px-2 py-0.5 bg-accent/20 text-accent text-sm rounded-full">
              测试完成 ✓
            </span>
          )}
        </h2>

        <button
          onClick={() => setShowReport(!showReport)}
          className="text-sm text-primary hover:text-blue-400 transition-colors"
        >
          {showReport ? '收起详细报告' : '展开详细报告'}
        </button>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-gray-800/50 rounded-lg text-center">
          <p className="text-3xl font-bold text-primary">{report.cases.length}</p>
          <p className="text-xs text-gray-400 mt-1">总用例数</p>
        </div>

        <div className="p-4 bg-gray-800/50 rounded-lg text-center">
          <p className="text-3xl font-bold text-accent">{report.successCount}</p>
          <p className="text-xs text-gray-400 mt-1">成功播放</p>
        </div>

        <div className="p-4 bg-gray-800/50 rounded-lg text-center">
          <p className="text-3xl font-bold text-red-400">{report.failCount}</p>
          <p className="text-xs text-gray-400 mt-1">失败播放</p>
        </div>

        <div className="p-4 bg-gray-800/50 rounded-lg text-center">
          <p className={`text-3xl font-bold ${
            successRate >= 80 ? 'text-accent' :
            successRate >= 60 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {successRate}%
          </p>
          <p className="text-xs text-gray-400 mt-1">成功率</p>
        </div>
      </div>

      {/* 时间统计 */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-gray-800/50 rounded-lg">
          <p className="text-xs text-gray-400 mb-1">总耗时</p>
          <p className="text-xl font-semibold text-white font-mono">
            {report.endTime && report.startTime
              ? formatTime((report.endTime - report.startTime) / 1000)
              : '-'}
          </p>
        </div>

        <div className="p-4 bg-gray-800/50 rounded-lg">
          <p className="text-xs text-gray-400 mb-1">平均每条</p>
          <p className="text-xl font-semibold text-white font-mono">
            {avgTimePerCase}s
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-6 lg:grid-cols-2">
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <h3 className="font-medium text-gray-200 mb-3">多轮对话</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">对话数</p>
              <p className="mt-1 text-lg font-semibold text-white">{multiTurnSummary.dialogueCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">总轮次</p>
              <p className="mt-1 text-lg font-semibold text-white">{multiTurnSummary.turnCount}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">完成率</p>
              <p className="mt-1 text-lg font-semibold text-accent">{multiTurnSummary.completionRate}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">平均轮次</p>
              <p className="mt-1 text-lg font-semibold text-white">{multiTurnSummary.averageTurns}</p>
            </div>
          </div>
        </div>

        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <h3 className="font-medium text-gray-200 mb-2">智能体评测</h3>
          <p className="text-sm font-semibold text-emerald-300">{agentEvaluation.plan.planName}</p>
          <p className="mt-1 text-xs text-gray-400">{agentEvaluation.plan.reason}</p>
          <div className="mt-3 space-y-2">
            {agentEvaluation.metrics.map((metric) => (
              <div key={metric.metricId} className="flex items-start justify-between gap-3 rounded bg-black/20 px-3 py-2 text-xs">
                <div>
                  <p className="font-medium text-gray-200">{metric.label}</p>
                  <p className={metric.status === 'missing_instrumentation' ? 'text-amber-200' : 'text-gray-400'}>
                    {metric.message}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-gray-100">{metric.score || '/'}</span>
              </div>
            ))}
          </div>
          {agentEvaluation.missingMessages.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
              {agentEvaluation.missingMessages.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 测试详情 */}
      {showReport && (
        <div className="border-t border-gray-700 pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-gray-300">测试详情</h3>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600
                         rounded-lg transition-colors"
              >
                📋 复制报告
              </button>
              <button
                onClick={handleDownload}
                className="px-3 py-1.5 text-sm bg-primary hover:bg-blue-600
                         rounded-lg transition-colors"
              >
                ⏬ 下载报告
              </button>
              <button
                onClick={handleDownloadJson}
                className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500
                         rounded-lg transition-colors"
              >
                JSON
              </button>
              <button
                onClick={handleDownloadCsv}
                className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500
                         rounded-lg transition-colors"
              >
                CSV
              </button>
            </div>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-4 max-h-80 overflow-y-auto">
            <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
              {getReportText()}
            </pre>
          </div>
        </div>
      )}

      {/* 简要列表 */}
      <div className="border-t border-gray-700 pt-6 mt-6">
        <h3 className="font-medium text-gray-300 mb-4">测试用例</h3>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {report.cases.map((tc, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-3 rounded-lg ${
                tc.success ? 'bg-accent/5' : 'bg-red-500/5'
              }`}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                tc.success ? 'bg-accent/20 text-accent' : 'bg-red-500/20 text-red-400'
              }`}>
                {tc.success ? '✓' : '✗'}
              </span>
              <span className="text-sm text-gray-400 w-8">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">{tc.text}</p>
                <p className="text-xs text-gray-500 mt-0.5">时间点：{formatCaseTimeRange(tc)}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  多轮：{tc.multiTurnTitle || tc.multiTurnCaseId || '单轮'} · 第 {tc.turnIndex || 1}/{tc.turnTotal || 1} 轮 · {tc.needWakeup === false ? '无需重复唤醒' : '需要唤醒'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
