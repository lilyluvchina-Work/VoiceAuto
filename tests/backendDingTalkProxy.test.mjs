import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';

const forwarded = [];
const app = createApp({
  pool: { async query() { return { rows: [] }; } },
  fetchImpl: async (url, options = {}) => {
    forwarded.push({
      url,
      method: options.method,
      contentType: options.headers?.['Content-Type'],
      body: JSON.parse(String(options.body)),
    });
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
});

const server = createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

async function request(method, path, body) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

try {
  const response = await request('POST', '/dingtalk-robot?access_token=abc&timestamp=123&sign=sig', {
    msgtype: 'markdown',
    markdown: { title: 'VoiceAuto', text: 'test' },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { errcode: 0, errmsg: 'ok' });
  assert.equal(forwarded.length, 1);
  assert.equal(
    forwarded[0].url,
    'https://oapi.dingtalk.com/robot/send?access_token=abc&timestamp=123&sign=sig'
  );
  assert.equal(forwarded[0].method, 'POST');
  assert.equal(forwarded[0].contentType, 'application/json');
  assert.equal(forwarded[0].body.msgtype, 'markdown');

  const getResponse = await request('GET', '/dingtalk-robot?access_token=abc');
  assert.equal(getResponse.status, 405);
  assert.equal(forwarded.length, 1);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
