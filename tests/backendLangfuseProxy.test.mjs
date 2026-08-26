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
      authorization: options.headers?.authorization,
      contentType: options.headers?.['content-type'],
    });
    return new Response(JSON.stringify({
      data: [{ id: 'trace-1' }],
      meta: { totalItems: 1, totalPages: 1 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
});

const server = createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

async function request(path) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    headers: {
      Authorization: 'Basic langfuse-token',
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: text ? JSON.parse(text) : null,
  };
}

try {
  const traces = await request('/langfuse-api-uat-local/api/public/traces?page=1&limit=100');
  assert.equal(traces.status, 200);
  assert.match(traces.contentType, /application\/json/);
  assert.equal(traces.body.data[0].id, 'trace-1');
  assert.equal(forwarded.length, 1);
  assert.equal(
    forwarded[0].url,
    'https://monitor-live-test-cedar.sdmc.tv/api/public/traces?page=1&limit=100'
  );
  assert.equal(forwarded[0].method, 'GET');
  assert.equal(forwarded[0].authorization, 'Basic langfuse-token');
  assert.equal(forwarded[0].contentType, 'application/json');

  await request('/langfuse-api-prod-local/api/public/observations?limit=100');
  assert.equal(
    forwarded[1].url,
    'https://monitor-live-test-cedar.sdmc.tv/api/public/observations?limit=100'
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
