import React, { useMemo, useState } from 'react';
import { useTest, actions } from '../stores/testStore';

const SOURCE_STYLES = {
  WAKE: 'bg-amber-500/20 text-amber-200 border-amber-500/30',
  INPUT: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/30',
  RESPONSE: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30'
};

function formatDateTime(value) {
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatTimeRange(testCase) {
  const start = formatDateTime(testCase?.playStartTime);
  const end = formatDateTime(testCase?.playEndTime);
  if (start === '-' && end === '-') return '-';
  if (end === '-') return start;
  return `${start} ~ ${end}`;
}

function summarizeLog(log) {
  if (log.source === 'WAKE') {
    if (log.stage === 'detect.result') {
      return log.success
        ? `唤醒检测成功，命中 ${log.matchedKeyword || '-'}`
        : '唤醒检测未命中';
    }
    if (log.stage === 'attempt.retry') {
      return `唤醒失败重试 ${log.wakeFailCount}/${log.failureThreshold}`;
    }
    if (log.stage === 'reboot.start') return '连续唤醒失败，开始 ADB 重启';
    if (log.stage === 'reboot.wait_before_retry.start') {
      return `重启恢复后等待 ${Math.round((log.delayMs || 0) / 1000)} 秒`;
    }
  }

  if (log.source === 'INPUT') {
    if (log.stage === 'test_audio.play.completed') {
      return log.success ? '测试音频播放完成' : '测试音频播放失败';
    }
    if (log.stage === 'asr.detect.result') {
      const similarity = Number.isFinite(Number(log.similarity))
        ? `${(Number(log.similarity) * 100).toFixed(1)}%`
        : '-';
      if (log.success) {
        return `ASR 标识闭环成功，开始=${log.startMatchedKeyword || '-'}，结束=${log.endMatchedKeyword || log.matchedKeyword || '-'}，文本=${log.actualAsrText || '-'}，相似度 ${similarity}`;
      }
      return `ASR 检测失败，失败标识=${log.failureMatchedKeyword || '-'}，状态=${log.status || '-'}`;
    }
  }

  if (log.source === 'RESPONSE') {
    if (log.stage === 'response.audio.start') return '检测到 Speaker 响应音频开始';
    if (log.stage === 'response.asr.interim') return `麦克风响应 ASR：${log.responseAsrText || '-'}`;
    if (log.stage === 'response.adb.detect.result') {
      return log.success
        ? `Speaker 播放响应文本=${log.speakerResponseText || '-'}`
        : `ADB 响应日志检测失败，状态=${log.status || '-'}，原因=${log.message || '-'}`;
    }
    if (log.stage === 'response.detect.result') {
      return log.success
        ? `麦克风检测到响应音频，转写=${log.responseAsrText || '-'}`
        : `响应检测失败，阶段=${log.responseFailStage || '-'}，原因=${log.responseFailReason || '-'}`;
    }
  }

  return log.message || log.failReason || log.stage;
}

function getLogTextFields(log) {
  const targetText = log.targetText || log.text || log.humanAudioText || '';
  const inputAsrText = log.source === 'INPUT' ? (log.actualAsrText || log.asrText || '') : '';
  const microphoneResponseText = log.source === 'RESPONSE' ? (log.responseAsrText || '') : '';
  const speakerResponseText = log.source === 'RESPONSE' ? (log.speakerResponseText || '') : '';
  return { targetText, inputAsrText, microphoneResponseText, speakerResponseText };
}

function exportJson(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `VoiceAuto测试过程记录_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function resolveCaseCursor(testCase, index) {
  const value = Number(testCase?.index);
  return Number.isFinite(value) ? value : index;
}

function compactCase(testCase, index) {
  return {
    cursor: resolveCaseCursor(testCase, index),
    playIndex: testCase.playIndex || index + 1,
    caseId: testCase.caseId || '',
    text: testCase.text || '',
    success: Boolean(testCase.success),
    timeRange: formatTimeRange(testCase),
    speakerWakeStatus: testCase.speakerWakeStatus || '',
    actualAsrText: testCase.actualAsrText || '',
    asrMatchResult: testCase.asrMatchResult || '',
    asrStatus: testCase.asrStatus || '',
    asrSimilarity: testCase.asrSimilarity,
    responseAsrStatus: testCase.responseAsrStatus || '',
    responseAsrText: testCase.responseAsrText || '',
    speakerResponseText: testCase.speakerResponseText || '',
    speakerOutputStatus: testCase.speakerOutputStatus || '',
    responseFailReason: testCase.responseFailReason || '',
    responseAudioUrl: testCase.responseAudioUrl || '',
    failStage: testCase.failStage || '',
    failReason: testCase.failReason || ''
  };
}

function ProcessLogRow({ log }) {
  const {
    targetText,
    inputAsrText,
    microphoneResponseText,
    speakerResponseText
  } = getLogTextFields(log);

  return (
    <details className="rounded-lg border border-gray-700 bg-gray-950/30">
      <summary className="cursor-pointer list-none p-3">
        <div className="flex items-start gap-3">
          <span className={`shrink-0 px-2 py-0.5 text-xs rounded-full border ${SOURCE_STYLES[log.source] || 'bg-gray-700 text-gray-200 border-gray-600'}`}>
            {log.source}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
              <p className="text-sm text-white font-medium truncate">{log.stage}</p>
              <p className="text-xs text-gray-500">{formatDateTime(log.time)}</p>
            </div>
            <p className="text-xs text-gray-300 mt-1 truncate">{summarizeLog(log)}</p>
            {(targetText || inputAsrText || microphoneResponseText || speakerResponseText) && (
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                {targetText && (
                  <div className="rounded-md border border-gray-700 bg-gray-900/70 px-2.5 py-2">
                    <p className="text-[11px] text-gray-500 mb-1">测试音频文本</p>
                    <p className="text-xs text-gray-200 break-words">{targetText}</p>
                  </div>
                )}
                {inputAsrText && (
                  <div className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-2">
                    <p className="text-[11px] text-cyan-300/70 mb-1">获取到的 ASR 文本</p>
                    <p className="text-xs text-cyan-100 break-words">{inputAsrText}</p>
                  </div>
                )}
                {microphoneResponseText && (
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2">
                    <p className="text-[11px] text-emerald-300/70 mb-1">麦克风转写响应文本</p>
                    <p className="text-xs text-emerald-100 break-words">{microphoneResponseText}</p>
                  </div>
                )}
                {speakerResponseText && (
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2">
                    <p className="text-[11px] text-emerald-300/70 mb-1">Speaker 播放响应文本</p>
                    <p className="text-xs text-emerald-100 break-words">{speakerResponseText}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </summary>
      <pre className="mx-3 mb-3 p-3 rounded bg-gray-950/70 border border-gray-700 text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto">
        {JSON.stringify(log, null, 2)}
      </pre>
    </details>
  );
}

export default function AutonomousProcessLog() {
  const { state, dispatch } = useTest();
  const logs = state.processLogs || [];
  const cases = state.report?.cases || [];
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [query, setQuery] = useState('');

  const logsByCursor = useMemo(() => {
    const map = new Map();
    const standalone = [];

    logs.forEach((log) => {
      const cursor = Number(log.cursor);
      if (Number.isFinite(cursor)) {
        if (!map.has(cursor)) map.set(cursor, []);
        map.get(cursor).push(log);
      } else {
        standalone.push(log);
      }
    });

    return { map, standalone };
  }, [logs]);

  const mergedCases = useMemo(() => (
    cases.map((testCase, index) => {
      const compact = compactCase(testCase, index);
      return {
        ...compact,
        logs: logsByCursor.map.get(compact.cursor) || []
      };
    })
  ), [cases, logsByCursor]);

  const normalizedQuery = query.trim().toLowerCase();
  const filterLog = (log) => {
    if (sourceFilter !== 'ALL' && log.source !== sourceFilter) return false;
    if (!normalizedQuery) return true;
    return JSON.stringify(log).toLowerCase().includes(normalizedQuery);
  };

  const filteredCases = mergedCases
    .map((item) => ({
      ...item,
      logs: item.logs.filter(filterLog)
    }))
    .filter((item) => {
      if (!normalizedQuery && sourceFilter === 'ALL') return true;
      const caseMatched = JSON.stringify(item).toLowerCase().includes(normalizedQuery);
      return caseMatched || item.logs.length > 0;
    });

  const filteredStandaloneLogs = logsByCursor.standalone.filter(filterLog).slice().reverse();
  const successCount = cases.filter((item) => item.success).length;
  const failCount = cases.length - successCount;

  const exportPayload = {
    report: state.report,
    processLogs: logs,
    mergedCases
  };

  return (
    <div className="bg-dark rounded-xl p-6 border border-gray-700">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <span className="text-2xl">📊</span>
            测试过程记录
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            按测试用例合并展示播放结果、唤醒检测、ADB 重启和 ASR 输入识别全过程。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => exportJson(exportPayload)}
            disabled={cases.length === 0 && logs.length === 0}
            className="px-3 py-1.5 text-sm bg-primary hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg transition-colors"
          >
            导出 JSON
          </button>
          <button
            onClick={() => dispatch(actions.clearProcessLogs())}
            disabled={logs.length === 0}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 disabled:text-gray-500 rounded-lg transition-colors"
          >
            清空过程日志
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        <div className="p-3 rounded-lg bg-gray-800/50">
          <p className="text-xs text-gray-400">用例数</p>
          <p className="text-2xl font-semibold text-white">{cases.length}</p>
        </div>
        <div className="p-3 rounded-lg bg-gray-800/50">
          <p className="text-xs text-gray-400">成功</p>
          <p className="text-2xl font-semibold text-accent">{successCount}</p>
        </div>
        <div className="p-3 rounded-lg bg-gray-800/50">
          <p className="text-xs text-gray-400">失败</p>
          <p className="text-2xl font-semibold text-red-300">{failCount}</p>
        </div>
        <div className="p-3 rounded-lg bg-gray-800/50">
          <p className="text-xs text-gray-400">唤醒日志</p>
          <p className="text-2xl font-semibold text-amber-200">
            {logs.filter((item) => item.source === 'WAKE').length}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-gray-800/50">
          <p className="text-xs text-gray-400">输入日志</p>
          <p className="text-2xl font-semibold text-cyan-200">
            {logs.filter((item) => item.source === 'INPUT').length}
          </p>
        </div>
        <div className="p-3 rounded-lg bg-gray-800/50">
          <p className="text-xs text-gray-400">响应日志</p>
          <p className="text-2xl font-semibold text-emerald-200">
            {logs.filter((item) => item.source === 'RESPONSE').length}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm"
        >
          <option value="ALL">全部链路</option>
          <option value="WAKE">唤醒链路</option>
          <option value="INPUT">输入链路</option>
          <option value="RESPONSE">响应链路</option>
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索用例、阶段、关键词、日志内容"
          className="md:col-span-2 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm"
        />
      </div>

      {filteredCases.length === 0 && filteredStandaloneLogs.length === 0 ? (
        <div className="text-center py-10 text-gray-500">
          <p className="text-4xl mb-3">📭</p>
          <p>暂无测试过程记录</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCases.map((testCase) => (
            <div key={`${testCase.cursor}_${testCase.playIndex}`} className={`rounded-xl border p-4 ${
              testCase.success ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-red-500/25 bg-red-500/5'
            }`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                  testCase.success ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200'
                }`}>
                  {testCase.success ? '✓' : '✗'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3">
                    <h3 className="text-sm font-semibold text-white truncate">
                      {testCase.playIndex}. {testCase.text || testCase.caseId || '未命名用例'}
                    </h3>
                    <span className="text-xs text-gray-500">{testCase.timeRange}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    用例ID：{testCase.caseId || '-'}
                    {testCase.speakerWakeStatus ? ` · 唤醒：${testCase.speakerWakeStatus}` : ''}
                    {testCase.asrStatus ? ` · ASR状态：${testCase.asrStatus}` : ''}
                    {testCase.asrMatchResult ? ` · ASR：${testCase.asrMatchResult}` : ''}
                    {testCase.actualAsrText ? ` · 识别：${testCase.actualAsrText}` : ''}
                    {testCase.speakerOutputStatus ? ` · 响应：${testCase.speakerOutputStatus}` : ''}
                    {testCase.responseAsrStatus ? ` · 响应ASR：${testCase.responseAsrStatus}` : ''}
                    {testCase.responseAsrText ? ` · 麦克风转写：${testCase.responseAsrText}` : ''}
                    {testCase.speakerResponseText ? ` · Speaker响应：${testCase.speakerResponseText}` : ''}
                    {testCase.failReason ? ` · 原因：${testCase.failReason}` : ''}
                  </p>
                  {testCase.responseAudioUrl && (
                    <audio
                      controls
                      src={testCase.responseAudioUrl}
                      className="mt-3 w-full max-w-xl"
                    />
                  )}
                </div>
              </div>

              <div className="mt-3 pl-0 md:pl-10">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400">自主监测过程日志（{testCase.logs.length} 条）</p>
                </div>
                {testCase.logs.length === 0 ? (
                  <p className="text-xs text-gray-500 rounded-lg border border-gray-700 bg-gray-800/30 px-3 py-2">
                    当前筛选条件下没有关联过程日志。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {testCase.logs.map((log) => (
                      <ProcessLogRow key={log.id} log={log} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {filteredStandaloneLogs.length > 0 && (
            <div className="rounded-xl border border-gray-700 bg-gray-800/20 p-4">
              <h3 className="text-sm font-semibold text-white mb-3">未绑定用例的过程日志</h3>
              <div className="space-y-2">
                {filteredStandaloneLogs.map((log) => (
                  <ProcessLogRow key={log.id} log={log} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
