import assert from 'node:assert/strict';
import {
  buildTapdBugPayloads,
  extractCoreErrorMessage,
} from '../src/utils/tapdBugFormatter.js';

assert.equal(
  extractCoreErrorMessage([
    'INFO start case',
    'Traceback (most recent call last):',
    '  File "runner.py", line 12, in <module>',
    'AssertionError: expected BalanceAgent but got BillAgent',
    'INFO cleanup',
  ].join('\n')),
  [
    'Traceback (most recent call last):',
    '  File "runner.py", line 12, in <module>',
    'AssertionError: expected BalanceAgent but got BillAgent',
  ].join('\n')
);

assert.equal(
  extractCoreErrorMessage('INFO normal log only'),
  '未解析到明确错误信息，请查看日志链接。'
);

const payloads = buildTapdBugPayloads(
  [
    {
      case_id: 'CASE-1',
      InputText: '查询余额',
      error: 'INFO\nFAILED AssertionError: balance mismatch\nextra debug',
      logUrl: 'https://monitor.example.com/project/demo/traces/trace-1',
      trace_time: '2026-08-03T10:01:02.000Z',
    },
  ],
  [
    {
      caseId: 'CASE-1',
      caseTitle: '语音自助-查询余额-普通话识别',
    },
  ],
  { taskName: '余额回归任务', envLabel: 'UAT', envKey: 'UAT' }
);

assert.equal(payloads.length, 1);
assert.equal(payloads[0].title, '【自动化测试】语音自助-查询余额-普通话识别执行异常');
assert.equal(
  payloads[0].description,
  [
    '【问题来源】 自动化测试',
    '【执行结果】 执行异常',
    '【错误信息】 + FAILED AssertionError: balance mismatch extra debug',
    '【测试环境】 UAT (UAT)',
    '【日志链接】 https://monitor.example.com/project/demo/traces/trace-1',
    '【执行时间】 2026-08-03T10:01:02.000Z',
    '【补充说明】 该 Bug 由自动化测试平台自动创建，请优先查看错误信息和日志链接定位原因。',
  ].join('\n')
);
assert.doesNotMatch(payloads[0].description, /【用例名称】|【测试任务】/);
assert.doesNotMatch(payloads[0].description, /v1\.1\.1|版本号/);
