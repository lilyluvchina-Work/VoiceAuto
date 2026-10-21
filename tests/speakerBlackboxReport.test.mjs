import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, renderReport, formatMs, caseResults, stageLabel } from '../src/modules/speakerBlackbox/report.js';

test('case report groups retries, keeps Chinese content and separates each stage', () => {
  const run = { cases: [{ sourceId: 'weather', text: '今天天气怎么样？' }], attempts: [
    { caseId: '001_001', sourceId: 'weather', attempt: 1, status: 'wake_timeout', wakeDetected: false },
    { caseId: '001_001', sourceId: 'weather', attempt: 2, status: 'reply_timeout', wakeDetected: true,
      stages: { wakePlayback: 'success', wakeResponse: 'success', testPlayback: 'success', reply: 'failed' },
      recording: 'recordings/case_001_001_full.wav' },
  ] };
  assert.equal(caseResults(run).length, 1);
  assert.equal(caseResults(run)[0].text, '今天天气怎么样？');
  assert.equal(stageLabel(run.attempts[1], 'testPlayback'), '成功');
  assert.equal(stageLabel(run.attempts[0], 'testPlayback'), '未执行');
  assert.equal(stageLabel({ stages: { testPlayback: 'interrupted' } }, 'testPlayback'), '未完成');
  const html = renderReport(run);
  for (const text of ['测试音频内容', '唤醒结果', '应答', '测试音频播放', '今天天气怎么样？', 'case_001_001_full.wav']) assert.ok(html.includes(text), text);
});

test('report contains one result table and its summary, without configuration or duplicate attempt tables', () => {
  const html = renderReport({ config: { taskName: '精简报告', inputDeviceId: 'private-device-config' }, attempts: [
    { caseId: 'a', attempt: 1, status: 'success', wakeDetected: true, responseMs: 4000, caseCompleted: true },
    { caseId: 'b', attempt: 1, status: 'music_only', audioKind: 'music', caseCompleted: true },
  ] });
  assert.equal((html.match(/<table>/g) || []).length, 1);
  assert.doesNotMatch(html, /private-device-config|配置与校准|逐次尝试|P90/);
  for (const text of ['汇总', '音乐', '4000.00 ms']) assert.ok(html.includes(text), text);
});

test('denominators exclude aborted first attempts and incomplete cases; latency uses first eligible success', () => {
  const attempts = [
    { caseId: 'a', attempt: 1, status: 'wake_timeout', wakeDetected: false, caseCompleted: false },
    { caseId: 'a', attempt: 2, status: 'success', wakeDetected: true, responseMs: 200, caseCompleted: true },
    { caseId: 'b', attempt: 1, status: 'success', wakeDetected: true, responseMs: -50, overlap: true, caseCompleted: true },
    { caseId: 'c', attempt: 1, status: 'aborted', wakeDetected: true, caseCompleted: false },
    { caseId: 'd', attempt: 1, status: 'success', wakeDetected: true, responseMs: 100, caseCompleted: true },
  ];
  const stats = summarize(attempts);
  assert.equal(stats.firstDenominator, 3);
  assert.equal(stats.firstWakeCount, 2);
  assert.equal(stats.firstReplyCount, 2);
  assert.equal(stats.completedCases, 3);
  assert.equal(stats.finalSuccessCount, 3);
  assert.equal(stats.latency.count, 2);
  assert.equal(stats.latency.mean, 150);
  assert.equal(stats.latency.p95, 195);
});

test('music/review remain in first-run denominator; pause replay is not a timeout retry', () => {
  const stats = summarize([
    { caseId: 'a', attempt: 1, status: 'music_only', wakeDetected: true, caseCompleted: true },
    { caseId: 'b', attempt: 1, status: 'needs_review', wakeDetected: true, caseCompleted: true },
    { caseId: 'c', attempt: 1, status: 'paused' },
    { caseId: 'c', attempt: 2, status: 'success', wakeDetected: true, caseCompleted: true, responseMs: 4000 },
  ]);
  assert.equal(stats.firstDenominator, 3);
  assert.equal(stats.firstReplyCount, 1);
  assert.equal(stats.retries, 0);
});

test('offline report escapes untrusted text, uses relative recordings and preserves missing/negative times', () => {
  const html = renderReport({ id: 'run', config: { taskName: '<script>alert(1)</script>' }, attempts: [
    { caseId: 'a', name: '<img src=x onerror=alert(1)>', attempt: 1, status: 'success', responseMs: -20,
      overlap: true, recording: 'recordings/case_001_attempt_01_raw.wav', caseCompleted: true },
  ] });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('recordings/case_001_attempt_01_raw.wav'));
  assert.ok(html.includes('-20.00 ms'));
  assert.equal(formatMs(null), '—');
  assert.equal(formatMs(0), '0.00 ms');
});
