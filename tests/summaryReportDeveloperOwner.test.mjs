import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  buildSummaryReportPayload,
  buildSummaryReportText,
  buildSummaryReportWorkbook,
} from '../src/utils/summaryReportBuilder.js';

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
      caseTitle: '语音自助-查询余额',
      targetAgent: 'BalanceAgent',
    },
  ],
  envLabel: 'UAT',
  envKey: 'UAT',
  range: { fromDate: '2026-08-04', fromTime: '10:00:00', toDate: '2026-08-04', toTime: '10:10:00' },
  testReport: {
    runId: 'run-1',
    developerOwner: 'dev-user',
    cases: [
      { caseId: 'CASE-1', audioId: 'audio-1', targetText: '查询余额' },
    ],
  },
});

assert.equal(report.developerOwner, 'dev-user');

const markdown = buildSummaryReportText(report);
assert.match(markdown, /\|\s*开发负责人\s*\|\s*dev-user\s*\|/);

const workbook = buildSummaryReportWorkbook(report);
assert.deepEqual(workbook.SheetNames, ['汇报看板', '环境信息']);
const dashboardRows = XLSX.utils.sheet_to_json(workbook.Sheets['汇报看板'], { header: 1, defval: '' });
assert.ok(dashboardRows.flat().includes('开发负责人：dev-user'));
