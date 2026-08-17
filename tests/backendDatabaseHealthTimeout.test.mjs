import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';

async function request(server, path) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    signal: AbortSignal.timeout(1500),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

const hangingPool = {
  async query() {
    return new Promise(() => {});
  },
};

const server = createServer(createApp({
  pool: hangingPool,
  sessionStore: new Map(),
}));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const startedAt = Date.now();
  const databaseHealth = await request(server, '/api/health/database');
  const elapsedMs = Date.now() - startedAt;

  assert.equal(databaseHealth.status, 503);
  assert.equal(databaseHealth.body.success, false);
  assert.equal(databaseHealth.body.errorCode, 'DB_CONNECTION_FAILED');
  assert.match(databaseHealth.body.detail, /timeout/i);
  assert.ok(elapsedMs < 1400, `health check took ${elapsedMs}ms`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
