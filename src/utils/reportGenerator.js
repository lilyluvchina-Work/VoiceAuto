/**
 * 测试报告生成
 */
import { formatTime } from './formatters';

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

  const formatDate = (date) => {
    const d = new Date(date);
    return d.toLocaleString('zh-CN');
  };

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
