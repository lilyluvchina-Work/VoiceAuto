import assert from 'node:assert/strict';
import {
  resolveBugFoundVersion,
  resolveDeveloperOwner,
  submitTapdBugsBySessionRows,
} from '../src/utils/tapdBugSubmission.js';

assert.equal(
  resolveDeveloperOwner({
    summaryReport: { developerOwner: ' dev-user ' },
    runtimeReport: { developerOwner: 'fallback-user' },
  }),
  'dev-user'
);

assert.equal(
  resolveDeveloperOwner({
    summaryReport: {},
    runtimeReport: { current_owner: 'fallback-user' },
  }),
  'fallback-user'
);

assert.equal(
  resolveBugFoundVersion({
    summaryReport: { bugFoundVersion: ' v1.1.1 ' },
    runtimeReport: { version_report: 'v1.0.0' },
  }),
  'v1.1.1'
);

assert.equal(
  resolveBugFoundVersion({
    summaryReport: {},
    runtimeReport: { versionReport: 'v1.0.0' },
  }),
  'v1.0.0'
);

const created = [];
const result = await submitTapdBugsBySessionRows(
  [
    {
      case_id: 'CASE-1',
      error: 'Exception: failed',
      error_message: 'Exception: failed',
      log_status: 'error',
      logUrl: 'https://monitor.example.com/trace/abc',
      startTime: '2026-08-04T01:46:15.422Z',
    },
  ],
  [
    {
      caseId: 'CASE-1',
      caseTitle: '语音自助-查询余额-普通话识别',
      text: '查询余额',
    },
  ],
  {
    developerOwner: 'dev-user',
    bugFoundVersion: 'v1.1.1',
    envLabel: 'TEST',
    envKey: 'TEST',
    tapdConfig: {
      apiUser: 'api-user',
      apiPassword: 'api-password',
      workspaceId: '61252348',
    },
    createBug: async (...args) => {
      created.push(args);
      return { bugId: 'BUG-1' };
    },
  }
);

assert.equal(result.skipped, false);
assert.equal(result.created, 1);
assert.equal(created.length, 1);
assert.equal(created[0][0], '61252348');
assert.match(created[0][2], /【测试环境】 TEST \(TEST\)/);
assert.equal(created[0][5].currentOwner, 'dev-user');
assert.equal(created[0][5].versionReport, 'v1.1.1');
