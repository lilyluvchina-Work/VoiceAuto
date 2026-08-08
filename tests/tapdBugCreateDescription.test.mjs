import assert from 'node:assert/strict';
import { createTapdBug } from '../src/modules/tapd/services/tapdService.js';

let postedBody = '';

globalThis.window = {
  location: {
    origin: 'http://localhost:3000',
  },
};

globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');

globalThis.fetch = async (url, options = {}) => {
  assert.equal(url, 'http://localhost:3000/tapd-api/bugs');
  assert.equal(options.method, 'POST');
  postedBody = options.body;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 1,
      data: {
        Bug: {
          id: 'BUG-1',
          title: '【自动化测试】打开三楼执行异常',
        },
      },
    }),
  };
};

await createTapdBug(
  '61252348',
  '【自动化测试】打开三楼执行异常',
  [
    '【问题来源】 自动化测试',
    '【执行结果】 执行异常',
    '【错误信息】 + Exception <Group>',
    '【日志链接】 https://monitor.example.com/trace/abc',
    '【执行时间】 2026-08-04T01:46:15.422Z',
    '【补充说明】 该 Bug 由自动化测试平台自动创建，请优先查看错误信息和日志链接定位原因。',
  ].join('\n'),
  'api-user',
  'api-password',
  { currentOwner: 'dev-user', versionReport: 'v1.1.1' }
);

const params = new URLSearchParams(postedBody);
assert.equal(params.get('current_owner'), 'dev-user');
assert.equal(params.get('version_report'), 'v1.1.1');
assert.equal(params.get('priority_label'), '高');
assert.equal(params.get('priority'), 'high');
assert.equal(params.get('severity'), 'normal');
assert.equal(
  params.get('description'),
  [
    '【问题来源】 自动化测试',
    '【执行结果】 执行异常',
    '【错误信息】 + Exception &lt;Group&gt;',
    '【日志链接】 <a href="https://monitor.example.com/trace/abc" target="_blank" rel="noopener noreferrer">https://monitor.example.com/trace/abc</a>',
    '【执行时间】 2026-08-04T01:46:15.422Z',
    '【补充说明】 该 Bug 由自动化测试平台自动创建，请优先查看错误信息和日志链接定位原因。',
  ].join('<br />')
);
