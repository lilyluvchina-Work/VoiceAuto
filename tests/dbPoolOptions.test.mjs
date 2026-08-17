import assert from 'node:assert/strict';
import { createPool } from '../server/db.js';

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  DB_POOL_SIZE: process.env.DB_POOL_SIZE,
  DB_CONNECTION_TIMEOUT_MS: process.env.DB_CONNECTION_TIMEOUT_MS,
  DB_QUERY_TIMEOUT_MS: process.env.DB_QUERY_TIMEOUT_MS,
};

process.env.DATABASE_URL = 'postgresql://voiceauto_app:secret@127.0.0.1:5432/voiceauto';
process.env.DB_POOL_SIZE = '3';
process.env.DB_CONNECTION_TIMEOUT_MS = '4321';
process.env.DB_QUERY_TIMEOUT_MS = '2345';

const pool = createPool();

try {
  assert.equal(pool.options.max, 3);
  assert.equal(pool.options.connectionTimeoutMillis, 4321);
  assert.equal(pool.options.query_timeout, 2345);
} finally {
  await pool.end().catch(() => {});
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
