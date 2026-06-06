/**
 * 测试过程记录
 * 将测试用例结果与自主监测日志聚合为一条可追踪链路。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTest } from '../stores/testStore';
import { copyToClipboard } from '../utils/audioUtils.jsx';
import { countByStatus, getAsrStatus, getTtsStatus, getWakeStatus } from '../utils/testStatus';

const STEP_DEFS = [
  {
    key: 'WAKE_AUDIO',
    title: '播放唤醒音频',
    stages: ['wake_audio.play.start', 'wake_audio.play.started', 'wake_audio.play.completed', 'wake_audio.play.error'],
  },
  {
    key: 'WAKE_DETECT',
    title: '监听唤醒结果',
    stages: [
      'detect.start.before_audio',
      'detect.result',
      'attempt.success',
      'attempt.failed.no_match',
      'detect.error',
      'reboot.start',
      'reboot.failed',
      'reboot.recovered',
      'reboot.wait_before_retry.start',
      'reboot.wait_before_retry.end',
    ],
  },
  {
    key: 'TEST_AUDIO',
    title: '播放测试音频',
    stages: ['test_audio.play.start', 'test_audio.play.started', 'test_audio.play.completed', 'test_audio.play.error'],
  },
  {
    key: 'ASR_DETECT',
    title: '监听 ASR 输入',
    stages: ['asr.detect.start.before_audio', 'asr.detect.result', 'asr.detect.error'],
  },
  {
    key: 'RESPONSE_AUDIO',
    title: 'Speaker 播报音频收录',
    stages: [
      'response.detect.start.after_test_audio',
      'response.detect.window.start',
      'response.audio.recording.start',
      'response.audio.start',
      'response.detect.result',
      'response.detect.error',
      'response.detect.skipped',
    ],
  },
  {
    key: 'RESPONSE_TTS',
    title: '提取 Speaker 回复文本',
    stages: ['response.adb.detect.result', 'response.adb.detect.error', 'response.asr.interim'],
  },
];

const STATUS_META = {
  success: {
    label: '成功',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  failed: {
    label: '失败',
    badge: 'bg-red-500/15 text-red-300 border-red-500/30',
    dot: 'bg-red-400',
  },
  running: {
    label: '进行中',
    badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    dot: 'bg-blue-400',
  },
  skipped: {
    label: '跳过',
    badge: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
    dot: 'bg-gray-500',
  },
  unknown: {
    label: '未判定',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-400',
  },
};

const FAILURE_STAGE_TEXT = {
  WAKE_AUDIO_PLAY: '唤醒音频播放失败',
  ADB_WAKE: 'ADB 唤醒监听失败',
  TEST_AUDIO_PLAY: '测试音频播放失败',
  ADB_ASR: 'ADB ASR 监听失败',
  RESPONSE_AUDIO_RECORD: 'Speaker 播放录音监听失败',
  SPEAKER_OUTPUT: 'Speaker 回复播放监听失败',
};

function toTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function toShortTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function toDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '-';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function toRatio(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toFixed(4);
}

function toPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${(num * 100).toFixed(1)}%`;
}

function getLogTimeMs(log) {
  const value = Date.parse(log?.time || '');
  return Number.isFinite(value) ? value : 0;
}

function isFailureLog(log) {
  const stage = String(log?.stage || '');
  return log?.success === false
    || stage.includes('error')
    || stage.includes('failed')
    || stage.includes('skip.audio_error');
}

function isSuccessLog(log) {
  const stage = String(log?.stage || '');
  return log?.success === true
    || stage.endsWith('.completed')
    || stage === 'attempt.success'
    || stage === 'reboot.recovered';
}

function groupLogsByCursor(logs) {
  return (logs || []).reduce((acc, log) => {
    const cursor = Number(log?.cursor);
    const key = Number.isFinite(cursor) ? cursor : '__run__';
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});
}

function matchStageLogs(logs, stages) {
  const set = new Set(stages);
  return (logs || [])
    .filter((log) => set.has(log?.stage))
    .sort((a, b) => getLogTimeMs(a) - getLogTimeMs(b));
}

function summarizeStep(step, logs, testCase) {
  if (!logs.length) return null;

  const failed = logs.some(isFailureLog);
  const succeeded = logs.some(isSuccessLog);
  const last = logs[logs.length - 1] || {};
  const first = logs[0] || {};
  let status = failed ? 'failed' : (succeeded ? 'success' : 'running');

  if (last.stage?.includes('skipped')) {
    status = 'skipped';
  }

  const textParts = [];
  if (last.message) textParts.push(last.message);
  if (last.matchedKeyword) textParts.push(`命中关键词：${last.matchedKeyword}`);
  if (last.actualAsrText) textParts.push(`ASR：${last.actualAsrText}`);
  if (last.speakerResponseText) textParts.push(`回复：${last.speakerResponseText}`);
  if (last.responseAsrText && !last.speakerResponseText) textParts.push(`录音识别：${last.responseAsrText}`);
  if (last.failReason) textParts.push(last.failReason);

  if (!textParts.length) {
    if (step.key === 'TEST_AUDIO') textParts.push(`测试音频：${testCase?.targetText || testCase?.text || '-'}`);
    if (step.key === 'WAKE_AUDIO') textParts.push(`唤醒音频状态：${testCase?.wakeAudioPlayStatus || '已记录'}`);
  }

  return {
    key: step.key,
    title: step.title,
    status,
    startTime: first.time,
    endTime: last.time,
    durationMs: getLogTimeMs(last) - getLogTimeMs(first),
    message: textParts.filter(Boolean).join('；'),
    logs,
  };
}

function createCaseRecord(testCase, logs) {
  const timeline = STEP_DEFS
    .map((step) => summarizeStep(step, matchStageLogs(logs, step.stages), testCase))
    .filter(Boolean);

  timeline.push({
    key: 'FINAL_RESULT',
    title: '最终结论',
    status: testCase?.success ? 'success' : 'failed',
    startTime: testCase?.playEndTime || testCase?.playStartTime,
    endTime: testCase?.playEndTime || testCase?.playStartTime,
    durationMs: 0,
    message: testCase?.success
      ? '唤醒、输入与响应链路通过'
      : (testCase?.failReason || FAILURE_STAGE_TEXT[testCase?.failStage] || '本轮测试未通过'),
    logs: [],
  });

  return {
    id: testCase?.caseId || testCase?.audioId || `case_${testCase?.index ?? 'unknown'}`,
    index: Number.isFinite(Number(testCase?.index)) ? Number(testCase.index) : null,
    caseName: testCase?.caseId || testCase?.tapdCaseId || `用例 ${Number(testCase?.playIndex || 0) || '-'}`,
    testCase,
    logs,
    timeline,
  };
}

function getOverallStatus(testCase) {
  return testCase?.success ? 'success' : 'failed';
}

function buildRecords(cases, logs) {
  const grouped = groupLogsByCursor(logs);
  const records = (cases || []).map((testCase, index) => {
    const cursor = Number.isFinite(Number(testCase?.index)) ? Number(testCase.index) : index;
    return createCaseRecord({ ...testCase, index: cursor }, grouped[cursor] || []);
  });

  const usedCursors = new Set(records.map((record) => record.index));
  Object.entries(grouped).forEach(([key, value]) => {
    if (key === '__run__') return;
    const cursor = Number(key);
    if (!usedCursors.has(cursor)) {
      records.push(createCaseRecord({
        index: cursor,
        playIndex: cursor + 1,
        caseId: value.find((log) => log.caseId)?.caseId || `过程日志 ${cursor + 1}`,
        text: value.find((log) => log.targetText)?.targetText || '',
        targetText: value.find((log) => log.targetText)?.targetText || '',
        success: false,
        failReason: '测试仍在执行或尚未生成用例结果',
      }, value));
    }
  });

  return records.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${meta.badge}`}>
      {meta.label}
    </span>
  );
}

function SummaryItem({ label, value, status }) {
  return (
    <div className="rounded-lg bg-gray-800/50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-gray-100">{value || '-'}</p>
        {status && <StatusBadge status={status} />}
      </div>
    </div>
  );
}

function Field({ label, value, important = false }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 whitespace-pre-wrap text-sm ${important ? 'text-sky-100' : 'text-gray-200'}`}>
        {value || '-'}
      </p>
    </div>
  );
}

function AudioField({ label, url, filename, durationMs }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      {url ? (
        <div className="mt-2 space-y-2">
          <audio controls src={url} className="w-full max-w-full" />
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
            <span>{filename || 'Speaker 播报录音'}</span>
            <span>{toDuration(durationMs)}</span>
            <a
              href={url}
              download={filename || 'speaker_tts.webm'}
              className="text-primary hover:text-blue-300"
            >
              下载录音
            </a>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-sm text-gray-200">-</p>
      )}
    </div>
  );
}

function StepTimeline({ steps }) {
  return (
    <div className="space-y-0">
      {steps.map((step, index) => {
        const meta = STATUS_META[step.status] || STATUS_META.unknown;
        return (
          <div key={`${step.key}_${index}`} className="grid grid-cols-[112px_24px_1fr] gap-3">
            <div className="pb-5 text-right text-xs text-gray-500">
              <p>{toShortTime(step.startTime)}</p>
              <p>{toDuration(step.durationMs)}</p>
            </div>
            <div className="relative flex justify-center">
              <span className={`mt-1 h-3 w-3 rounded-full ${meta.dot}`} />
              {index < steps.length - 1 && <span className="absolute top-5 bottom-0 w-px bg-gray-700" />}
            </div>
            <div className="pb-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-white">{step.title}</p>
                <StatusBadge status={step.status} />
                {step.logs?.length > 0 && (
                  <span className="text-xs text-gray-500">{step.logs.length} 条日志</span>
                )}
              </div>
              {step.message && (
                <p className="mt-1 text-sm leading-relaxed text-gray-300">{step.message}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RawLogDetails({ testCase, logs }) {
  return (
    <details className="rounded-lg border border-gray-700 bg-gray-900/60">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-200">
        查看原始数据与过程日志
      </summary>
      <div className="border-t border-gray-700 p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-400">用例结果</p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-gray-300">
              {JSON.stringify(testCase || {}, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-400">自主监测日志</p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-gray-300">
              {JSON.stringify(logs || [], null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </details>
  );
}

function RecordCard({ record, defaultExpanded }) {
  const { testCase, logs, timeline } = record;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const finalStatus = getOverallStatus(testCase);
  const wakeStatus = getWakeStatus(testCase);
  const audioStatus = testCase?.testAudioPlayStatus === 'completed' ? 'success' : (testCase?.testAudioPlayStatus === 'error' ? 'failed' : 'unknown');
  const inputStatus = getAsrStatus(testCase);
  const responseStatus = getTtsStatus(testCase);
  const responseTtsText = testCase?.responseTtsText || testCase?.speakerResponseText || testCase?.responseAsrText || '';
  const responseTtsAudioUrl = testCase?.responseTtsAudioUrl || testCase?.responseAudioUrl || '';
  const responseTtsAudioFile = testCase?.responseTtsAudioFile || testCase?.responseAudioFile || '';

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <article className="rounded-xl border border-gray-700 bg-dark p-5">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
        className="w-full cursor-pointer text-left"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-white">
              #{testCase?.playIndex || (Number(testCase?.index) + 1) || '-'} {record.caseName}
            </h3>
            <StatusBadge status={finalStatus} />
            <span className="rounded-full border border-gray-600 px-2 py-0.5 text-xs text-gray-300">
              {expanded ? '收起详情' : '查看详情'}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            执行时间：{toTime(testCase?.playStartTime)} ~ {toTime(testCase?.playEndTime)}
          </p>
        </div>
        <div className="text-right text-xs text-gray-500">
          <p>过程日志：{logs.length} 条</p>
          <p>耗时：{toDuration(Number(testCase?.testAudioActualDuration) || (Number(testCase?.playEndTime) - Number(testCase?.playStartTime)))}</p>
        </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryItem label="唤醒状态" value={testCase?.wakeMatchedKeyword || testCase?.speakerWakeStatus} status={wakeStatus} />
          <SummaryItem label="测试音频" value={testCase?.testAudioPlayStatus} status={audioStatus} />
          <SummaryItem label="ASR 状态" value={testCase?.asrStatus || testCase?.asrMatchResult} status={inputStatus} />
          <SummaryItem label="TTS 状态" value={testCase?.responseTtsStatus || testCase?.speakerOutputStatus} status={responseStatus} />
        </div>
      </div>

      {expanded && (
        <>
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,1.1fr)]">
            <section className="rounded-lg bg-gray-800/40 p-4">
              <h4 className="mb-4 text-sm font-semibold text-gray-200">用例信息</h4>
              <div className="grid gap-4">
                <Field label="测试音频文本" value={testCase?.targetText || testCase?.text} important />
                <Field label="ADB 获取到的 ASR 文本" value={testCase?.actualAsrText} important />
                <Field label="Speaker 播放的 TTS 文本" value={responseTtsText} important />
                <AudioField
                  label="Speaker 播报录音"
                  url={responseTtsAudioUrl}
                  filename={responseTtsAudioFile}
                  durationMs={testCase?.responseAudioSegmentDuration || testCase?.responseAudioDuration}
                />
                <Field label="录音 ASR 文本" value={testCase?.responseAsrText} important />
                <Field label="录音 ASR / TTS 文本相似度" value={toPercent(testCase?.responseTextSimilarity)} />
                <Field
                  label="TTS 播报音频收录"
                  value={[
                    `状态：${testCase?.responseSpeakerState || '-'}`,
                    `结束原因：${testCase?.responseFinishReason || '-'}`,
                    `TTS文本长度：${testCase?.responseTtsTextLength || '-'}`,
                    `预计播报：${toDuration(testCase?.responseEstimatedTtsDurationMs)}`,
                    `VAD时长：${toDuration(testCase?.responseAudioDuration)}`,
                    `截取时长：${toDuration(testCase?.responseAudioSegmentDuration || testCase?.responseAudioDuration)}`,
                    `最短保护：${toDuration(testCase?.responseMinProtectMs)}`,
                    `最大录制：${toDuration(testCase?.responseMaxRecordMs)}`,
                    `静音结束阈值：${toDuration(testCase?.responseSilenceEndMs)}`,
                    `结束前连续静音：${toDuration(testCase?.responseFinalSilenceMs)}`,
                    `疑似截断：${testCase?.responseSuspectedTruncated ? '是' : '否'}`,
                    `采样率：${testCase?.responseSampleRate || '-'}Hz`,
                    `峰值：${toRatio(testCase?.responsePeakRms)}`,
                    `噪声底：${toRatio(testCase?.responseNoiseFloor)}`,
                    `动态阈值：${toRatio(testCase?.responseDynamicThreshold)}`,
                  ].join('\n')}
                />
                <Field label="目标 Agent" value={testCase?.targetAgent} />
                <Field label="失败原因" value={testCase?.failReason || testCase?.wakeFailReason || testCase?.responseFailReason} />
              </div>
            </section>

            <section className="rounded-lg bg-gray-800/40 p-4">
              <h4 className="mb-4 text-sm font-semibold text-gray-200">自主监测时间线</h4>
              <StepTimeline steps={timeline} />
            </section>
          </div>

          <div className="mt-4">
            <RawLogDetails testCase={testCase} logs={logs} />
          </div>
        </>
      )}
    </article>
  );
}

export default function TestProcessRecord() {
  const { state } = useTest();
  const { report, processLogs } = state;
  const [expandedAll, setExpandedAll] = useState(false);

  const records = useMemo(
    () => buildRecords(report.cases, processLogs),
    [report.cases, processLogs]
  );

  const runLogs = useMemo(
    () => (processLogs || []).filter((log) => !Number.isFinite(Number(log?.cursor))),
    [processLogs]
  );

  const successRate = report.cases.length
    ? ((report.successCount / report.cases.length) * 100).toFixed(1)
    : '0.0';
  const wakeStats = useMemo(() => countByStatus(report.cases, getWakeStatus), [report.cases]);
  const asrStats = useMemo(() => countByStatus(report.cases, getAsrStatus), [report.cases]);
  const ttsStats = useMemo(() => countByStatus(report.cases, getTtsStatus), [report.cases]);

  const handleCopyJson = async () => {
    const payload = {
      report,
      processLogs,
      records: records.map(({ testCase, logs, timeline }) => ({ testCase, logs, timeline })),
    };
    const ok = await copyToClipboard(JSON.stringify(payload, null, 2));
    alert(ok ? '测试过程记录已复制' : '复制失败，请手动复制');
  };

  if (!report.cases.length && !processLogs.length) {
    return (
      <div className="rounded-xl border border-gray-700 bg-dark p-6">
        <h2 className="text-xl font-semibold text-white">测试过程记录</h2>
        <div className="py-12 text-center text-gray-500">
          <p className="text-lg">暂无测试过程记录</p>
          <p className="mt-2 text-sm">开始测试后，这里会显示用例结果与自主监测链路。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-700 bg-dark p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">测试过程记录</h2>
            <p className="mt-1 text-sm text-gray-400">
              将测试用例、唤醒监听、ASR 输入监听和 Speaker 回复监听合并展示。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setExpandedAll((value) => !value)}
              className="rounded-lg bg-gray-700 px-3 py-2 text-sm text-gray-100 transition-colors hover:bg-gray-600"
            >
              {expandedAll ? '收起全部详情' : '展开全部详情'}
            </button>
            <button
              onClick={handleCopyJson}
              className="rounded-lg bg-primary px-3 py-2 text-sm text-white transition-colors hover:bg-blue-600"
            >
              复制 JSON
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryItem label="总用例数" value={report.cases.length} />
          <SummaryItem label="通过用例" value={report.successCount} status="success" />
          <SummaryItem label="失败用例" value={report.failCount} status={report.failCount ? 'failed' : 'success'} />
          <SummaryItem label="通过率" value={`${successRate}%`} />
          <SummaryItem label="过程日志" value={processLogs.length} />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <SummaryItem label="唤醒统计" value={`成功 ${wakeStats.success} / 失败 ${wakeStats.failed}`} status={wakeStats.failed ? 'failed' : 'success'} />
          <SummaryItem label="ASR 统计" value={`成功 ${asrStats.success} / 失败 ${asrStats.failed}`} status={asrStats.failed ? 'failed' : 'success'} />
          <SummaryItem label="TTS 统计" value={`成功 ${ttsStats.success} / 失败 ${ttsStats.failed}`} status={ttsStats.failed ? 'failed' : 'success'} />
        </div>

        {runLogs.length > 0 && (
          <details className="mt-4 rounded-lg border border-gray-700 bg-gray-900/50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-200">
              运行级日志（{runLogs.length} 条）
            </summary>
            <pre className="max-h-64 overflow-auto border-t border-gray-700 p-4 text-xs leading-relaxed text-gray-300">
              {JSON.stringify(runLogs, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {expandedAll && (
        <div className="space-y-4">
          {records.map((record, index) => (
            <RecordCard key={`${record.id}_${record.index ?? index}`} record={record} defaultExpanded={expandedAll} />
          ))}
        </div>
      )}
    </div>
  );
}
