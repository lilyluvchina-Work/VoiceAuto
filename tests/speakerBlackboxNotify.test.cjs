const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunNotifier } = require('../scripts/speakerBlackboxNotify.cjs');

test('start/end notifications contain no counts; sign at send time; duplicates are suppressed', async () => {
  const sent = [];
  const notify = createRunNotifier({ enabled: true, accessToken: 'test-token', secret: 'test-secret' },
    { id: 'run', config: { taskName: '中文任务', deviceType: 'xiaomi' }, status: 'running' },
    { fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ errcode: 0 }) }; } });
  await notify('started'); await notify('started');
  await notify('ended', { status: 'completed' }); await notify('ended');
  assert.equal(sent.length, 2);
  assert.match(sent[0].body.markdown.text, /开始/);
  assert.match(sent[1].body.markdown.text, /结束/);
  assert.match(sent[0].url, /sign=/);
  assert.doesNotMatch(JSON.stringify(sent), /用例数|成功数|失败数|test-secret/);
});

test('disabled robot skips; invalid host cannot receive credentials; error text never leaks token', async () => {
  let calls = 0;
  const options = { fetchImpl: async () => { calls++; throw new Error('token-secret'); } };
  assert.equal((await createRunNotifier({ enabled: false }, {}, options)('started')).status, 'skipped');
  assert.equal((await createRunNotifier({ enabled: true, webhook: 'https://evil.example/robot/send?access_token=secret' }, {}, options)('started')).status, 'failed');
  assert.equal(calls, 0);
  const result = await createRunNotifier({ enabled: true, accessToken: 'token-secret' }, {}, options)('ended');
  assert.equal(result.status, 'failed');
  assert.doesNotMatch(result.message, /token-secret/);
});
