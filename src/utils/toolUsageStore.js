export const TOOL_USAGE_STORAGE_KEY = 'voiceauto_tool_usage_records_v1';
export const TOOL_USAGE_UPDATED_EVENT = 'voiceauto-tool-usage-updated';

function getStorage(options = {}) {
  return options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toTimestamp(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatToolUsageDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '-';
  const totalSeconds = Math.floor(numeric / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
  if (minutes > 0) return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  return `${seconds}秒`;
}

export function formatToolUsageTime(value) {
  const timestamp = toTimestamp(value);
  if (timestamp == null) return '-';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

export function getToolUsageRecords(options = {}) {
  const storage = getStorage(options);
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(TOOL_USAGE_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.startTime && item.endTime && item.durationMs >= 0)
      .sort((a, b) => Number(b.endTime) - Number(a.endTime));
  } catch {
    return [];
  }
}

export function recordToolUsage({ runId, startTime, endTime, user } = {}, options = {}) {
  const start = toTimestamp(startTime);
  const end = toTimestamp(endTime);
  const loginAccount = normalizeText(user?.loginAccount || user?.login_account || user?.account);
  if (start == null || end == null || end < start || !loginAccount) return null;

  const record = {
    id: [
      normalizeText(runId) || 'run',
      loginAccount,
      start,
      end,
    ].join('|'),
    runId: normalizeText(runId),
    userName: normalizeText(user?.username || user?.name) || loginAccount,
    loginAccount,
    startTime: start,
    endTime: end,
    startTimeText: formatToolUsageTime(start),
    endTimeText: formatToolUsageTime(end),
    durationMs: end - start,
    durationText: formatToolUsageDuration(end - start),
    createdAt: Date.now(),
  };

  const storage = getStorage(options);
  if (!storage) return record;

  const existing = getToolUsageRecords({ storage });
  const next = [
    record,
    ...existing.filter((item) => item.id !== record.id),
  ].slice(0, 500);
  storage.setItem(TOOL_USAGE_STORAGE_KEY, JSON.stringify(next));

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(TOOL_USAGE_UPDATED_EVENT, { detail: record }));
  }

  return record;
}

export function summarizeToolUsageByUser(records = []) {
  const byAccount = new Map();
  for (const record of records || []) {
    const loginAccount = normalizeText(record?.loginAccount);
    if (!loginAccount) continue;
    if (!byAccount.has(loginAccount)) {
      byAccount.set(loginAccount, {
        userName: normalizeText(record?.userName) || loginAccount,
        loginAccount,
        runCount: 0,
        totalDurationMs: 0,
        lastStartTime: 0,
        lastEndTime: 0,
        lastStartTimeText: '-',
        lastEndTimeText: '-',
      });
    }
    const item = byAccount.get(loginAccount);
    item.runCount += 1;
    item.totalDurationMs += Number(record.durationMs) || 0;
    if ((Number(record.endTime) || 0) > item.lastEndTime) {
      item.lastStartTime = record.startTime;
      item.lastEndTime = record.endTime;
      item.lastStartTimeText = record.startTimeText || formatToolUsageTime(record.startTime);
      item.lastEndTimeText = record.endTimeText || formatToolUsageTime(record.endTime);
      item.userName = normalizeText(record.userName) || item.userName;
    }
  }

  return Array.from(byAccount.values())
    .map((item) => ({
      ...item,
      totalDurationText: formatToolUsageDuration(item.totalDurationMs),
    }))
    .sort((a, b) => Number(b.lastEndTime) - Number(a.lastEndTime));
}
