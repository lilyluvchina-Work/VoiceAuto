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
      error_message: 'AssertionError: balance mismatch',
      error: 'AssertionError: balance mismatch',
      log_status: 'error',
      traceID: 'trace-1',
      trace_id: 'trace-1',
      logUrl: 'https://monitor.example.com/project/demo/traces/trace-1',
    },
    {
      case_id: 'CASE-2',
      actual_input_text: '查询账单',
      hit_agent: 'OtherAgent',
      log_status: 'complete',
      logUrl: 'https://monitor.example.com/project/demo/traces/trace-2',
    },
  ],
  testAudios: [
    { id: 'audio-1', caseId: 'CASE-1', text: '查询余额', caseTitle: '语音自助-查询余额-普通话识别', targetAgent: 'BillAgent' },
    { id: 'audio-2', caseId: 'CASE-2', text: '查询账单', caseTitle: '语音自助-查询账单', targetAgent: 'BillAgent' },
  ],
  envLabel: 'UAT',
  envKey: 'UAT',
  range: { fromDate: '2026-08-03', fromTime: '10:00:00', toDate: '2026-08-03', toTime: '10:10:00' },
  testReport: {
    runId: 'run-1',
    cases: [
      { caseId: 'CASE-1', audioId: 'audio-1', targetText: '查询余额' },
      { caseId: 'CASE-2', audioId: 'audio-2', targetText: '查询账单' },
    ],
  },
});

assert.equal(report.reportRows[0].logUrl, 'https://monitor.example.com/project/demo/traces/trace-1');
assert.equal(report.reportRows[1].logUrl, 'https://monitor.example.com/project/demo/traces/trace-2');

const markdown = buildSummaryReportText(report);
assert.match(markdown, /\|\s*日志链接\s*\|/);
assert.match(markdown, /https:\/\/monitor\.example\.com\/project\/demo\/traces\/trace-1/);
assert.match(markdown, /https:\/\/monitor\.example\.com\/project\/demo\/traces\/trace-2/);

const workbook = buildSummaryReportWorkbook(report);
assert.deepEqual(workbook.SheetNames, ['汇报看板', '环境信息']);
assert.equal(workbook.Sheets['测试明细'], undefined);
const dashboardRows = XLSX.utils.sheet_to_json(workbook.Sheets['汇报看板'], { header: 1, defval: '' });
assert.deepEqual(
  dashboardRows.find((row) => row[0] === '序号' && row[1] === '用例ID').slice(0, 7),
  ['序号', '用例ID', '用例名称', '结论', '错误信息', '异常信息', '日志链接']
);
assert.ok(dashboardRows.some((row) => row.includes('https://monitor.example.com/project/demo/traces/trace-1')));
assert.ok(dashboardRows.some((row) => row.includes('https://monitor.example.com/project/demo/traces/trace-2')));

const reportTableSectionIndex = dashboardRows.findIndex((row) => row[0] === '报告表格');
assert.notEqual(reportTableSectionIndex, -1);
assert.deepEqual(
  dashboardRows[reportTableSectionIndex + 1].slice(0, 6),
  ['序号', '用例ID', '目标文本（测试音频文本）', '实际输入（日志提取的输入）', '输出（output.content）', '目标Agent']
);
assert.equal(dashboardRows[reportTableSectionIndex + 1][16], '日志链接');
assert.equal(dashboardRows[reportTableSectionIndex + 2][1], 'CASE-1');
assert.equal(dashboardRows[reportTableSectionIndex + 2][16], 'https://monitor.example.com/project/demo/traces/trace-1');
assert.equal(dashboardRows[reportTableSectionIndex + 3][1], 'CASE-2');
assert.equal(dashboardRows[reportTableSectionIndex + 3][16], 'https://monitor.example.com/project/demo/traces/trace-2');
