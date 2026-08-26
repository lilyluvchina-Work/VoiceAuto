/**
 * 测试报告生成
 */
import { formatTime } from './formatters';
import { countByStatus, getAsrStatus, getTtsStatus, getWakeStatus } from './testStatus';

function toDateText(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN');
}

function toTimestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Date.now();
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * 生成结构化报告对象
 * @param {object} reportData
 * @returns {object}
 */
export function generateReportJson(reportData) {
  const {
    startTime,
    endTime,
    wakeWord,
    wakeAfterDelay,
    wakeIntervalDelay,
    totalCases,
    successCount,
    failCount,
    totalDuration,
    multiTurnSummary,
    agentEvaluation,
    testCases
  } = reportData;

  const normalizedStart = toTimestamp(startTime);
  const normalizedEnd = toTimestamp(endTime);
  const safeTotal = Math.max(0, Number(totalCases) || 0);
  const safeDuration = Math.max(0, Number(totalDuration) || 0);
  const safeSuccess = Math.max(0, Number(successCount) || 0);
  const safeFail = Math.max(0, Number(failCount) || 0);
  const successRate = safeTotal > 0
    ? Number(((safeSuccess / safeTotal) * 100).toFixed(1))
    : 0;
  const avgDurationMs = safeTotal > 0
    ? Number((safeDuration / safeTotal).toFixed(0))
    : 0;
  const safeTestCases = Array.isArray(testCases) ? testCases : [];
  const wakeStats = countByStatus(safeTestCases, getWakeStatus);
  const asrStats = countByStatus(safeTestCases, getAsrStatus);
  const ttsStats = countByStatus(safeTestCases, getTtsStatus);

  return {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    summary: {
      startTime: normalizedStart,
      endTime: normalizedEnd,
      startTimeText: toDateText(normalizedStart),
      endTimeText: toDateText(normalizedEnd),
      totalCases: safeTotal,
      successCount: safeSuccess,
      failCount: safeFail,
      successRate,
      totalDurationMs: safeDuration,
      avgDurationMs,
      wakeSuccessCount: wakeStats.success,
      wakeFailCount: wakeStats.failed,
      asrSuccessCount: asrStats.success,
      asrFailCount: asrStats.failed,
      ttsSuccessCount: ttsStats.success,
      ttsFailCount: ttsStats.failed
    },
    config: {
      wakeWord: wakeWord || '',
      wakeAfterDelayMs: Number(wakeAfterDelay) || 0,
      wakeIntervalDelayMs: Number(wakeIntervalDelay) || 0
    },
    multiTurnSummary: multiTurnSummary || null,
    agentEvaluation: agentEvaluation || null,
    cases: safeTestCases.map((tc, i) => ({
      index: i + 1,
      text: tc?.text || '',
      success: Boolean(tc?.success),
      multiTurnCaseId: tc?.multiTurnCaseId || tc?.caseId || '',
      multiTurnTitle: tc?.multiTurnTitle || '',
      turnIndex: Number(tc?.turnIndex) || 1,
      turnTotal: Number(tc?.turnTotal) || 1,
      dialogueTurnKey: tc?.dialogueTurnKey || '',
      dialogueStatus: tc?.dialogueStatus || '',
      needWakeup: tc?.needWakeup !== false,
      shouldContinue: Boolean(tc?.shouldContinue),
      continueReason: tc?.continueDecision?.reason || '',
      wakeStatus: getWakeStatus(tc),
      asrStatus: getAsrStatus(tc),
      ttsStatus: getTtsStatus(tc),
      actualAsrText: tc?.actualAsrText || '',
      responseTtsText: tc?.responseTtsText || tc?.speakerResponseText || '',
      responseTtsAudioFile: tc?.responseTtsAudioFile || tc?.responseAudioFile || '',
      responseAudioAsrText: tc?.responseAsrText || '',
      responseTextSimilarity: Number.isFinite(Number(tc?.responseTextSimilarity)) ? Number(tc.responseTextSimilarity) : null,
      responseAudioDurationMs: Number(tc?.responseAudioDuration) || 0,
      responseAudioSegmentDurationMs: Number(tc?.responseAudioSegmentDuration) || 0,
      responseSpeakerState: tc?.responseSpeakerState || '',
      responseFinishReason: tc?.responseFinishReason || '',
      responseTtsTextLength: Number(tc?.responseTtsTextLength) || 0,
      responseEstimatedTtsDurationMs: Number(tc?.responseEstimatedTtsDurationMs) || 0,
      responseMinProtectMs: Number(tc?.responseMinProtectMs) || 0,
      responseMaxRecordMs: Number(tc?.responseMaxRecordMs) || 0,
      responseSilenceEndMs: Number(tc?.responseSilenceEndMs) || 0,
      responseFinalSilenceMs: Number(tc?.responseFinalSilenceMs) || 0,
      responseSuspectedTruncated: Boolean(tc?.responseSuspectedTruncated),
      durationMs: Number(tc?.duration) || 0,
      playStartTime: Number(tc?.playStartTime) || null,
      playEndTime: Number(tc?.playEndTime) || null,
      playStartTimeText: tc?.playStartTime ? toDateText(tc.playStartTime) : '-',
      playEndTimeText: tc?.playEndTime ? toDateText(tc.playEndTime) : '-',
      round: Number(tc?.round) || 1,
      rawIndex: Number.isFinite(Number(tc?.index)) ? Number(tc.index) : i
    }))
  };
}

/**
 * 生成 CSV 报告文本
 * @param {object} reportData
 * @returns {string}
 */
export function generateReportCsv(reportData) {
  const payload = generateReportJson(reportData);
  const planId = payload.agentEvaluation?.plan?.planId || '';
  const missingMessages = (payload.agentEvaluation?.missingMessages || []).join(' | ');
  const headers = ['index', 'success', 'multiTurnCaseId', 'turnIndex', 'turnTotal', 'needWakeup', 'dialogueStatus', 'agentEvaluationPlan', 'agentEvaluationMissingMessages', 'wakeStatus', 'asrStatus', 'ttsStatus', 'round', 'playStartTimeText', 'playEndTimeText', 'durationMs', 'text', 'actualAsrText', 'responseTtsText', 'responseTtsAudioFile', 'responseAudioAsrText', 'responseTextSimilarity', 'responseAudioDurationMs', 'responseAudioSegmentDurationMs', 'responseSpeakerState', 'responseFinishReason', 'responseTtsTextLength', 'responseEstimatedTtsDurationMs', 'responseMinProtectMs', 'responseMaxRecordMs', 'responseSilenceEndMs', 'responseFinalSilenceMs', 'responseSuspectedTruncated'];
  const lines = [headers.join(',')];

  payload.cases.forEach((item) => {
    lines.push([
      item.index,
      item.success,
      csvEscape(item.multiTurnCaseId),
      item.turnIndex,
      item.turnTotal,
      item.needWakeup,
      csvEscape(item.dialogueStatus),
      csvEscape(planId),
      csvEscape(missingMessages),
      item.wakeStatus,
      item.asrStatus,
      item.ttsStatus,
      item.round,
      csvEscape(item.playStartTimeText),
      csvEscape(item.playEndTimeText),
      item.durationMs,
      csvEscape(item.text),
      csvEscape(item.actualAsrText),
      csvEscape(item.responseTtsText),
      csvEscape(item.responseTtsAudioFile),
      csvEscape(item.responseAudioAsrText),
      item.responseTextSimilarity ?? '',
      item.responseAudioDurationMs,
      item.responseAudioSegmentDurationMs,
      csvEscape(item.responseSpeakerState),
      csvEscape(item.responseFinishReason),
      item.responseTtsTextLength,
      item.responseEstimatedTtsDurationMs,
      item.responseMinProtectMs,
      item.responseMaxRecordMs,
      item.responseSilenceEndMs,
      item.responseFinalSilenceMs,
      item.responseSuspectedTruncated
    ].join(','));
  });

  return lines.join('\n');
}

/**
 * 生成测试报告文本
 * @param {object} reportData
 * @returns {string}
 */
export function generateReportText(reportData) {
  const {
    startTime,
    endTime,
    wakeWord,
    wakeAfterDelay,
    wakeIntervalDelay,
    totalCases,
    successCount,
    failCount,
    totalDuration,
    multiTurnSummary,
    agentEvaluation,
    testCases
  } = reportData;

  const successRate = totalCases > 0
    ? ((successCount / totalCases) * 100).toFixed(1)
    : 0;

  const avgTime = totalCases > 0
    ? (totalDuration / totalCases).toFixed(1)
    : 0;
  const safeTestCases = Array.isArray(testCases) ? testCases : [];
  const wakeStats = countByStatus(safeTestCases, getWakeStatus);
  const asrStats = countByStatus(safeTestCases, getAsrStatus);
  const ttsStats = countByStatus(safeTestCases, getTtsStatus);

  const formatDate = (date) => toDateText(date);

  let text = '';
  text += '═══════════════════════════════════════════════════════\n';
  text += '          Cedar 语音自动化测试报告\n';
  text += '═══════════════════════════════════════════════════════\n\n';

  text += '📋 测试信息 ───────────────────────────────────────\n';
  text += `测试时间: ${formatDate(startTime)} ~ ${formatDate(endTime)}\n`;
  text += `唤醒词: ${wakeWord}\n`;
  text += `唤醒后延迟: ${wakeAfterDelay}ms\n`;
  text += `唤醒间延迟: ${wakeIntervalDelay}ms\n\n`;

  text += '📊 测试统计 ───────────────────────────────────────\n';
  text += `总用例数: ${totalCases}\n`;
  text += `成功播放: ${successCount}\n`;
  text += `失败播放: ${failCount}\n`;
  text += `成功率: ${successRate}%\n\n`;
  text += `唤醒成功: ${wakeStats.success}，唤醒失败: ${wakeStats.failed}\n`;
  text += `ASR成功: ${asrStats.success}，ASR失败: ${asrStats.failed}\n`;
  text += `TTS成功: ${ttsStats.success}，TTS失败: ${ttsStats.failed}\n\n`;

  if (multiTurnSummary) {
    text += '🔁 多轮对话 ───────────────────────────────────────\n';
    text += `对话数: ${multiTurnSummary.dialogueCount}\n`;
    text += `总轮次: ${multiTurnSummary.turnCount}\n`;
    text += `完成率: ${multiTurnSummary.completionRate}\n`;
    text += `平均轮次: ${multiTurnSummary.averageTurns}\n\n`;
  }

  if (agentEvaluation) {
    text += '🧠 智能体评测 ─────────────────────────────────────\n';
    text += `推荐方案: ${agentEvaluation.plan?.planName || '-'}\n`;
    text += `推荐原因: ${agentEvaluation.plan?.reason || '-'}\n`;
    (agentEvaluation.metrics || []).forEach((metric) => {
      text += `${metric.label}: ${metric.score || '/'}（${metric.status}）${metric.message ? ` - ${metric.message}` : ''}\n`;
    });
    (agentEvaluation.missingMessages || []).forEach((message) => {
      text += `缺失提示: ${message}\n`;
    });
    text += '\n';
  }

  text += '⏱️ 时间统计 ───────────────────────────────────────\n';
  text += `总耗时: ${formatTime(totalDuration / 1000)}\n`;
  text += `平均每条: ${avgTime}秒\n\n`;

  text += '📝 测试详情 ───────────────────────────────────────\n';
  safeTestCases.forEach((tc, i) => {
    const status = tc.success ? '✓' : '✗';
    const displayText = tc.text.length > 40
      ? tc.text.substring(0, 40) + '...'
      : tc.text;
    const startText = tc.playStartTime ? formatDate(tc.playStartTime) : '-';
    const endText = tc.playEndTime ? formatDate(tc.playEndTime) : '-';
    text += `${status} ${i + 1}. [${startText} ~ ${endText}] ${displayText}\n`;
    text += `   多轮: ${tc.multiTurnCaseId || tc.caseId || '-'} | 第 ${tc.turnIndex || 1}/${tc.turnTotal || 1} 轮 | ${tc.needWakeup === false ? '无需重复唤醒' : '需要唤醒'} | 状态: ${tc.dialogueStatus || '-'}\n`;
    text += `   唤醒: ${getWakeStatus(tc)} | ASR: ${getAsrStatus(tc)} | TTS: ${getTtsStatus(tc)} | TTS文本: ${tc.responseTtsText || tc.speakerResponseText || '-'} | TTS音频: ${tc.responseTtsAudioFile || tc.responseAudioFile || '-'} | 录音ASR: ${tc.responseAsrText || '-'} | 相似度: ${Number.isFinite(Number(tc.responseTextSimilarity)) ? `${(Number(tc.responseTextSimilarity) * 100).toFixed(1)}%` : '-'}\n`;
    text += `   录制诊断: 状态=${tc.responseSpeakerState || '-'} | 结束原因=${tc.responseFinishReason || '-'} | 预计=${tc.responseEstimatedTtsDurationMs || 0}ms | 实际=${tc.responseAudioDuration || 0}ms | 保护=${tc.responseMinProtectMs || 0}ms | 连续静音=${tc.responseFinalSilenceMs || 0}ms | 疑似截断=${tc.responseSuspectedTruncated ? '是' : '否'}\n`;
  });

  text += '\n═══════════════════════════════════════════════════════\n';
  text += `                    测试完成 ${successCount === totalCases ? '✓' : ''}\n`;
  text += '═══════════════════════════════════════════════════════\n';

  return text;
}
