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
  const headers = ['index', 'success', 'round', 'durationMs', 'text'];
  const lines = [headers.join(',')];

  payload.cases.forEach((item) => {
    lines.push([
      item.index,
      item.success,
      item.round,
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
    text += `${status} ${i + 1}. ${displayText}\n`;
  });

  text += '\n═══════════════════════════════════════════════════════\n';
  text += `                    测试完成 ${successCount === totalCases ? '✓' : ''}\n`;
  text += '═══════════════════════════════════════════════════════\n';

  return text;
}
