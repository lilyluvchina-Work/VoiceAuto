/**
 * 测试报告生成
 */
import { formatTime } from './formatters';

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
      avgDurationMs
    },
    config: {
      wakeWord: wakeWord || '',
      wakeAfterDelayMs: Number(wakeAfterDelay) || 0,
      wakeIntervalDelayMs: Number(wakeIntervalDelay) || 0
    },
    cases: (Array.isArray(testCases) ? testCases : []).map((tc, i) => ({
      index: i + 1,
      text: tc?.text || '',
      success: Boolean(tc?.success),
      durationMs: Number(tc?.duration) || 0,
      playStartTime: Number(tc?.playStartTime) || null,
      playEndTime: Number(tc?.playEndTime) || null,
      playStartTimeText: tc?.playStartTime ? toDateText(tc.playStartTime) : '-',
      playEndTimeText: tc?.playEndTime ? toDateText(tc.playEndTime) : '-',
      wakeAudioPlayStatus: tc?.wakeAudioPlayStatus || '',
      speakerWakeStatus: tc?.speakerWakeStatus || '',
      wakeEventTime: Number(tc?.wakeEventTime) || null,
      wakeEventTimeText: tc?.wakeEventTime ? toDateText(tc.wakeEventTime) : '-',
      wakeFailCount: Number(tc?.wakeFailCount) || 0,
      adbRebootTriggered: Boolean(tc?.adbRebootTriggered),
      humanAudioText: tc?.humanAudioText || tc?.text || '',
      testAudioPlayStatus: tc?.testAudioPlayStatus || '',
      testAudioActualDuration: Number(tc?.testAudioActualDuration) || 0,
      testAudioExpectedDuration: Number(tc?.testAudioExpectedDuration) || 0,
      actualAsrText: tc?.actualAsrText || '',
      asrMatchResult: tc?.asrMatchResult || '',
      asrSimilarity: Number.isFinite(Number(tc?.asrSimilarity)) ? Number(tc.asrSimilarity) : null,
      asrFailReason: tc?.asrFailReason || '',
      inputChainPassed: tc?.inputChainPassed == null ? null : Boolean(tc.inputChainPassed),
      responseDetectStartTime: Number(tc?.responseDetectStartTime) || null,
      responseDetectEndTime: Number(tc?.responseDetectEndTime) || null,
      responseAudioDetected: Boolean(tc?.responseAudioDetected),
      responseAudioFile: tc?.responseAudioFile || '',
      responseAudioStartTime: Number(tc?.responseAudioStartTime) || null,
      responseAudioEndTime: Number(tc?.responseAudioEndTime) || null,
      responseAudioDuration: Number(tc?.responseAudioDuration) || 0,
      responseAsrStatus: tc?.responseAsrStatus || '',
      responseAsrText: tc?.responseAsrText || '',
      speakerResponseText: tc?.speakerResponseText || '',
      responseTtsStatus: tc?.responseTtsStatus || '',
      responseVadStarted: Boolean(tc?.responseVadStarted),
      responseVadEnded: Boolean(tc?.responseVadEnded),
      speakerOutputStatus: tc?.speakerOutputStatus || '',
      responseFailStage: tc?.responseFailStage || '',
      responseFailReason: tc?.responseFailReason || '',
      responseChainPassed: tc?.responseChainPassed == null ? null : Boolean(tc.responseChainPassed),
      failStage: tc?.failStage || '',
      failReason: tc?.failReason || '',
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
  const headers = [
    'index',
    'success',
    'round',
    'wakeAudioPlayStatus',
    'speakerWakeStatus',
    'wakeEventTimeText',
    'wakeFailCount',
    'adbRebootTriggered',
    'testAudioPlayStatus',
    'actualAsrText',
    'asrMatchResult',
    'asrSimilarity',
    'asrFailReason',
    'inputChainPassed',
    'speakerOutputStatus',
    'responseAsrStatus',
    'responseAsrText',
    'speakerResponseText',
    'responseTtsStatus',
    'responseVadStarted',
    'responseVadEnded',
    'responseAudioDuration',
    'responseFailStage',
    'responseFailReason',
    'responseChainPassed',
    'failStage',
    'failReason',
    'playStartTimeText',
    'playEndTimeText',
    'durationMs',
    'text'
  ];
  const lines = [headers.join(',')];

  payload.cases.forEach((item) => {
    lines.push([
      item.index,
      item.success,
      item.round,
      csvEscape(item.wakeAudioPlayStatus),
      csvEscape(item.speakerWakeStatus),
      csvEscape(item.wakeEventTimeText),
      item.wakeFailCount,
      item.adbRebootTriggered,
      csvEscape(item.testAudioPlayStatus),
      csvEscape(item.actualAsrText),
      csvEscape(item.asrMatchResult),
      item.asrSimilarity == null ? '' : item.asrSimilarity,
      csvEscape(item.asrFailReason),
      item.inputChainPassed == null ? '' : item.inputChainPassed,
      csvEscape(item.speakerOutputStatus),
      csvEscape(item.responseAsrStatus),
      csvEscape(item.responseAsrText),
      csvEscape(item.speakerResponseText),
      csvEscape(item.responseTtsStatus),
      item.responseVadStarted,
      item.responseVadEnded,
      item.responseAudioDuration,
      csvEscape(item.responseFailStage),
      csvEscape(item.responseFailReason),
      item.responseChainPassed == null ? '' : item.responseChainPassed,
      csvEscape(item.failStage),
      csvEscape(item.failReason),
      csvEscape(item.playStartTimeText),
      csvEscape(item.playEndTimeText),
      item.durationMs,
      csvEscape(item.text)
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
    testCases
  } = reportData;

  const successRate = totalCases > 0
    ? ((successCount / totalCases) * 100).toFixed(1)
    : 0;

  const avgTime = totalCases > 0
    ? (totalDuration / totalCases).toFixed(1)
    : 0;

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

  text += '⏱️ 时间统计 ───────────────────────────────────────\n';
  text += `总耗时: ${formatTime(totalDuration / 1000)}\n`;
  text += `平均每条: ${avgTime}秒\n\n`;

  text += '📝 测试详情 ───────────────────────────────────────\n';
  testCases.forEach((tc, i) => {
    const status = tc.success ? '✓' : '✗';
    const displayText = tc.text.length > 40
      ? tc.text.substring(0, 40) + '...'
      : tc.text;
    const startText = tc.playStartTime ? formatDate(tc.playStartTime) : '-';
    const endText = tc.playEndTime ? formatDate(tc.playEndTime) : '-';
    const wakeStatus = tc.speakerWakeStatus ? ` 唤醒:${tc.speakerWakeStatus}` : '';
    const asrStatus = tc.asrMatchResult ? ` ASR:${tc.asrMatchResult}` : '';
    const asrText = tc.actualAsrText ? ` 识别:${tc.actualAsrText}` : '';
    const responseStatus = tc.speakerOutputStatus ? ` 响应:${tc.speakerOutputStatus}` : '';
    const responseText = tc.speakerResponseText ? ` Speaker响应:${tc.speakerResponseText}` : '';
    const failReason = tc.failReason ? ` 原因:${tc.failReason}` : '';
    text += `${status} ${i + 1}. [${startText} ~ ${endText}]${wakeStatus}${asrStatus}${asrText}${responseStatus}${responseText}${failReason} ${displayText}\n`;
  });

  text += '\n═══════════════════════════════════════════════════════\n';
  text += `                    测试完成 ${successCount === totalCases ? '✓' : ''}\n`;
  text += '═══════════════════════════════════════════════════════\n';

  return text;
}
