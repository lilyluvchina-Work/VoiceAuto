import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';

const upstream = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ path: req.url, authorization: req.headers.authorization }));
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const environment = {
  envKey: 'ENV_7', label: 'Gracy',
  baseUrl: `http://127.0.0.1:${upstream.address().port}`,
};
const pool = {
  async query(sql) {
    return { rows: sql.includes('SELECT')
      ? [{ config_type: 'langfuse', payload: { environments: [environment] } }]
      : [] };
  },
};
const server = createServer(createApp({ pool }));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function request(path, status = 200) {
  const response = await fetch(origin + path, { headers: { Authorization: 'Basic test-token' } });
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /application\/json/);
  return response.json();
}
try {
  assert.deepEqual(await request('/langfuse-api-env-7/api/public/traces?page=2&limit=100'), {
    path: '/api/public/traces?page=2&limit=100', authorization: 'Basic test-token',
  });
  environment.baseUrl += '/langfuse/';
  assert.equal((await request('/langfuse-api-env-7/api/public/observations')).path,
    '/langfuse/api/public/observations');
  environment.proxyBase = '/langfuse-api-gracy';
  await request('/langfuse-api-env-7/api/public/traces', 404);
  await request('/langfuse-api-gracy/api/public/traces');
  environment.enabled = false;
  await request('/langfuse-api-gracy/api/public/traces', 404);
  environment.enabled = true;
  environment.baseUrl = 'file:///tmp/test';
  await request('/langfuse-api-gracy/api/public/traces', 400);
  await request('/langfuse-api-unknown/api/public/traces', 404);
} finally {
  await Promise.all([server, upstream].map(s => new Promise(resolve => s.close(resolve))));
}
