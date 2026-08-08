import assert from 'node:assert/strict';
import { buildSessionRows } from '../src/modules/langfuse/utils/sessionExtractor.js';
import { buildSummaryReportPayload } from '../src/utils/summaryReportBuilder.js';

const traces = [
  {
    id: 'trace-router',
    sessionId: 'session-router',
    timestamp: '2026-08-04T10:00:00.000Z',
    input: { case_id: 'CASE-ROUTER', text: '查询余额' },
  },
  {
    id: 'trace-shortcut',
    sessionId: 'session-shortcut',
    timestamp: '2026-08-04T10:01:00.000Z',
    input: { case_id: 'CASE-SHORTCUT', text: '打开空调' },
  },
];

const observations = [
  {
    id: 'obs-router',
    traceId: 'trace-router',
    name: '[router_result]: music, smarthome',
    startTime: '2026-08-04T10:00:01.000Z',
    output: {
      content: ['music', 'smarthome'],
    },
  },
  {
    id: 'obs-router-full-answer',
    traceId: 'trace-router',
    name: 'full_answer',
    startTime: '2026-08-04T10:00:02.000Z',
    output: {
      agent_code: 'LegacyAgent',
      content: '余额是 100 元',
    },
  },
  {
    id: 'obs-shortcut-full-answer',
    traceId: 'trace-shortcut',
    name: 'full_answer',
    startTime: '2026-08-04T10:01:01.000Z',
    output: {
      agent_code: 'ShortcutAgent',
      content: '已打开空调',
    },
  },
];

const sessionRows = buildSessionRows(traces, observations);
const routerRow = sessionRows.find((row) => row.trace_id === 'trace-router');
const shortcutRow = sessionRows.find((row) => row.trace_id === 'trace-shortcut');

assert.equal(routerRow.hit_agent, 'music / smarthome');
assert.equal(routerRow.AgentCode, 'music / smarthome');
assert.equal(routerRow.agent_source, 'router_result');
assert.equal(routerRow.agent_candidates, 'music / smarthome');

assert.equal(shortcutRow.hit_agent, 'ShortcutAgent');
assert.equal(shortcutRow.agent_source, 'full_answer');

const report = buildSummaryReportPayload({
  sessionRows,
  testAudios: [
    { id: 'audio-router', caseId: 'CASE-ROUTER', text: '查询余额', targetAgent: 'music' },
    { id: 'audio-shortcut', caseId: 'CASE-SHORTCUT', text: '打开空调', targetAgent: 'ShortcutAgent' },
  ],
  envLabel: 'UAT',
  envKey: 'UAT',
  range: { fromDate: '2026-08-04', fromTime: '10:00:00', toDate: '2026-08-04', toTime: '10:10:00' },
  testReport: {
    runId: 'run-router-result',
    cases: [
      { caseId: 'CASE-ROUTER', audioId: 'audio-router', targetText: '查询余额' },
      { caseId: 'CASE-SHORTCUT', audioId: 'audio-shortcut', targetText: '打开空调' },
    ],
  },
});

assert.equal(report.reportRows[0].actualAgent, 'music / smarthome');
assert.equal(report.reportRows[0].agentMatched, '不一致');
assert.equal(report.reportRows[1].actualAgent, 'ShortcutAgent');
assert.equal(report.reportRows[1].agentMatched, '一致');
