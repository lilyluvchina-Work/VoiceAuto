export const STATUS_LABELS = {
  success: '检测到语音回复', wake_timeout: '未检测到唤醒回应', reply_timeout: '回复超时',
  music_only: '仅检测到音乐', needs_review: '需复核', paused: '已暂停', not_run: '未执行', error: '执行错误', aborted: '用户中止', interrupted: '进程异常中断',
};
export const formatMs = value => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)} ms` : '—';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const validLatency = a => a.status === 'success' && !a.overlap && typeof a.responseMs === 'number' && Number.isFinite(a.responseMs) && a.responseMs >= 0;
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = p => {
    if (!sorted.length) return null;
    const index = (sorted.length - 1) * p, low = Math.floor(index);
    return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
  };
  return { count: sorted.length, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
    median: quantile(.5), p90: quantile(.9), p95: quantile(.95), min: sorted[0] ?? null, max: sorted.at(-1) ?? null };
}
export function summarize(attempts = []) {
  const firstByCase = new Map(), counts = new Map();
  for (const attempt of attempts) {
    if (!['success', 'wake_timeout', 'reply_timeout', 'music_only', 'needs_review', 'error'].includes(attempt.status)) continue;
    if (!firstByCase.has(attempt.caseId)) firstByCase.set(attempt.caseId, attempt);
    counts.set(attempt.caseId, (counts.get(attempt.caseId) || 0) + 1);
  }
  const first = [...firstByCase.values()];
  const completed = new Set(attempts.filter(a => a.caseCompleted).map(a => a.caseId));
  const successes = new Set(attempts.filter(a => a.status === 'success' && completed.has(a.caseId)).map(a => a.caseId));
  const perCase = new Map();
  for (const attempt of attempts) if (validLatency(attempt) && !perCase.has(attempt.caseId)) perCase.set(attempt.caseId, attempt.responseMs);
  return { attempts: attempts.length, cases: new Set(attempts.map(a => a.caseId)).size,
    retries: [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0), firstDenominator: first.length,
    firstWakeCount: first.filter(a => a.wakeDetected).length, firstReplyCount: first.filter(a => a.status === 'success').length,
    completedCases: completed.size, finalSuccessCount: successes.size,
    latency: distribution([...perCase.values()]), allLatency: distribution(attempts.filter(validLatency).map(a => a.responseMs)) };
}
const ratio = (n, d) => `${n} / ${d}${d ? ` (${(n / d * 100).toFixed(2)}%)` : ' (—)'}`;
const safeRecording = path => /^recordings\/[a-zA-Z0-9_-]+\.wav$/.test(path || '') ? path : '';
export function stageLabel(attempt, key) {
  let value = attempt.stages?.[key];
  // Old reports lack explicit stages. Only infer steps proven by saved evidence.
  if (!value) {
    if (key === 'wakePlayback' && (attempt.wakeDetected || attempt.status === 'wake_timeout' || attempt.wakePlaybackEnd != null)) value = 'success';
    if (key === 'wakeResponse') value = attempt.wakeDetected ? 'success' : attempt.status === 'wake_timeout' ? 'failed' : 'not_run';
    if (key === 'testPlayback' && attempt.playbackEnd != null) value = 'success';
    if (key === 'reply') value = attempt.status === 'success' ? 'success' : attempt.status === 'reply_timeout' ? 'failed' : 'not_run';
  }
  return { skipped: '跳过', success: '成功', failed: '失败', not_run: '未执行', interrupted: '未完成', needs_review: '需复核' }[value] || '未执行';
}
export function caseResults(run) {
  const grouped = new Map();
  for (let repeat = 1; repeat <= (run.config?.repeatCount || 1); repeat++) {
    (run.cases || []).forEach((source, index) => {
      const caseId = `${String(index + 1).padStart(3, '0')}_${String(repeat).padStart(3, '0')}`;
      grouped.set(caseId, { caseId, sourceId: source.sourceId ?? source.id, text: source.text || source.name || '', attempt: 0, status: 'not_run' });
    });
  }
  for (const attempt of run.attempts || []) {
    const source = (attempt.sourceId != null && (run.cases || []).find(c => c.sourceId === attempt.sourceId || c.id === attempt.sourceId))
      || run.cases?.[Number(String(attempt.caseId).split('_')[0]) - 1];
    grouped.set(attempt.caseId, { ...attempt, text: source?.text || attempt.text || source?.name || attempt.name || '' });
  }
  return [...grouped.values()];
}
const recordingHtml = file => {
  const recording = safeRecording(file);
  return recording ? `<audio controls preload="none" src="${escape(recording)}"></audio><br><a href="${escape(recording)}" download>完整 WAV</a>` : '—';
};
export const AUDIO_LABELS = { speech: '语音回复', music: '音乐', mixed: '语音与音乐混合', unknown: '无法确定' };
export function tableSummary(run) {
  const rows = caseResults(run);
  const passed = rows.filter(a => a.status === 'success').length;
  const review = rows.filter(a => a.status === 'needs_review').length;
  const failed = rows.filter(a => ['wake_timeout', 'reply_timeout', 'music_only', 'error'].includes(a.status)).length;
  const latency = distribution(rows.filter(validLatency).map(a => a.responseMs));
  return { total: rows.length, passed, failed, review, unfinished: rows.length - passed - failed - review, latency };
}
export function renderReport(run) {
  const stats = tableSummary(run);
  const rows = caseResults(run).map(a => '<tr><td>' + escape(a.caseId) + '</td><td>' + escape(a.text) + '</td>'
    + ['wakePlayback', 'wakeResponse', 'testPlayback', 'reply'].map(key => '<td>' + stageLabel(a, key) + '</td>').join('')
    + '<td>' + escape(AUDIO_LABELS[a.audioKind] || '—') + '</td><td>' + formatMs(a.responseMs) + '</td><td>' + escape(STATUS_LABELS[a.status] || a.status)
    + '</td><td>' + escape([a.error, ...(a.flags || []), a.review].filter(Boolean).join('；')) + '</td><td>' + recordingHtml(a.recording) + '</td></tr>').join('');
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>音箱黑盒测试报告</title><style>body{font:14px system-ui,sans-serif;margin:24px;color:#172033}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd5df;padding:10px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#edf3fa}audio{width:200px}.table{overflow:auto}</style><h1>'
    + escape(run.config?.taskName || '音箱黑盒测试') + '</h1><p>汇总：用例 ' + stats.total + ' 条，成功 ' + stats.passed + ' 条，失败 ' + stats.failed + ' 条，需复核 ' + stats.review + ' 条，未完成 ' + stats.unfinished
    + ' 条。有效语音回复平均响应时间：' + formatMs(stats.latency.mean) + '（' + stats.latency.count + ' 条）。</p><div class="table"><table><thead><tr>'
    + ['用例', '测试音频内容', '唤醒结果（播放）', '应答', '测试音频播放', '回复', '声音类型', '响应时间', '结果', '备注', '完整录音'].map(label => '<th>' + label + '</th>').join('')
    + '</tr></thead><tbody>' + rows + '</tbody></table></div></html>';
}
