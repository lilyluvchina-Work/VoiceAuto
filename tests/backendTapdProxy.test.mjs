import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';

const calls = [];
let upstreamStatus = 200;
let upstreamBody = JSON.stringify({ status: 1, data: [] });
const server = createServer(createApp({ pool: {}, fetchImpl: async (url, options) => {
  calls.push({ url: String(url), ...options });
  return new Response(upstreamBody, { status: upstreamStatus });
} }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const response = await fetch(`${base}/tapd-api/tcases?workspace_id=123&limit=50`, {
    headers: { Authorization: 'Basic test-token', Cookie: 'session=private' },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal((await response.json()).status, 1);
  assert.equal(calls[0].url, 'https://api.tapd.cn/tcases?workspace_id=123&limit=50');
  assert.equal(calls[0].headers.authorization, 'Basic test-token');
  assert.equal(calls[0].headers.cookie, undefined);
  await fetch(`${base}/tapd-api/bugs`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'title=test&workspace_id=123' });
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].body.toString(), 'title=test&workspace_id=123');
  await fetch(`${base}/tapd-api//other.example/path`);
  assert.equal(new URL(calls[2].url).origin, 'https://api.tapd.cn');
  upstreamStatus = 401;
  upstreamBody = JSON.stringify({ status: 0, info: 'Unauthorized' });
  const denied = await fetch(`${base}/tapd-api/tcases`);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).info, 'Unauthorized');
  upstreamStatus = 200;
  upstreamBody = '<html>upstream error</html>';
  const bad = await fetch(`${base}/tapd-api/tcases`);
  assert.equal(bad.status, 502);
  assert.match((await bad.json()).message, /非 JSON/);
} finally { await new Promise(resolve => server.close(resolve)); }
