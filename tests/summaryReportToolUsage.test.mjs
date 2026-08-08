import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  buildSummaryReportPayload,
  buildSummaryReportWorkbook,
} from '../src/utils/summaryReportBuilder.js';
import {
  getToolUsageRecords,
  recordToolUsage,
  summarizeToolUsageByUser,
} from '../src/utils/toolUsageStore.js';

const startTime = Date.UTC(2026, 7, 4, 2, 0, 0);
const endTime = Date.UTC(2026, 7, 4, 2, 12, 34);

const report = buildSummaryReportPayload({
  sessionRows: [
    {
      case_id: 'CASE-1',
      actual_input_text: '查询余额',
      hit_agent: 'BalanceAgent',
      log_status: 'complete',
    },
  ],
  testAudios: [
    {
      id: 'audio-1',
      caseId: 'CASE-1',
      text: '查询余额',
      targetAgent: 'BalanceAgent',
    },
  ],
  envLabel: 'UAT',
  envKey: 'UAT',
  range: { fromDate: '2026-08-04', fromTime: '10:00:00', toDate: '2026-08-04', toTime: '10:20:00' },
  testReport: {
    runId: 'run-usage',
    startTime,
    endTime,
    cases: [
      { caseId: 'CASE-1', audioId: 'audio-1', targetText: '查询余额' },
    ],
  },
});

assert.equal('toolUsage' in report, false);

const workbook = buildSummaryReportWorkbook(report);
assert.deepEqual(workbook.SheetNames, ['汇报看板', '环境信息']);

const dashboardRows = XLSX.utils.sheet_to_json(workbook.Sheets['汇报看板'], { header: 1, defval: '' });
const usageSectionIndex = dashboardRows.findIndex((row) => row[0] === '工具使用统计');
assert.equal(usageSectionIndex, -1);

const dashboardSheet = workbook.Sheets['汇报看板'];
assert.ok((dashboardSheet['!cols'] || [])[0].wch >= 18);
assert.ok((dashboardSheet['!merges'] || []).length >= 5);
assert.equal(dashboardSheet['!freeze']?.ySplit, 1);

const memoryStorage = new Map();
const storage = {
  getItem: (key) => memoryStorage.get(key) || null,
  setItem: (key, value) => memoryStorage.set(key, value),
};

recordToolUsage({
  runId: 'run-usage',
  startTime,
  endTime,
  user: {
    username: '测试负责人',
    loginAccount: 'lead',
  },
}, { storage });
recordToolUsage({
  runId: 'run-usage',
  startTime,
  endTime,
  user: {
    username: '测试负责人',
    loginAccount: 'lead',
  },
}, { storage });
recordToolUsage({
  runId: 'run-next',
  startTime: endTime,
  endTime: endTime + 26000,
  user: {
    username: '测试负责人',
    loginAccount: 'lead',
  },
}, { storage });

const records = getToolUsageRecords({ storage });
assert.equal(records.length, 2);
assert.equal(records[0].durationText, '26秒');
assert.equal(records[1].durationText, '12分34秒');

const summary = summarizeToolUsageByUser(records);
assert.equal(summary.length, 1);
assert.equal(summary[0].loginAccount, 'lead');
assert.equal(summary[0].runCount, 2);
assert.equal(summary[0].totalDurationText, '13分00秒');
