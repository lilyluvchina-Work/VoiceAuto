import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';

function createMockPool() {
  const users = new Map();
  const configs = new Map();
  const audios = new Map();
  let nextAudioId = 10001;

  users.set('LilyLuv', {
    id: 7,
    username: 'LilyLuv',
    login_account: 'LilyLuv',
    password_hash: 'a432dd981702c5b41f600bc06bab088169e950be28b99e7833e17bed5d106c06',
    password_salt: 'abc123',
    password_algorithm: 'sha256_salt_v1',
    role: 'admin',
    status: 'enabled',
    last_login_time: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  configs.set('doubaoTts', {
    config_type: 'doubaoTts',
    payload: {
      apiKeyId: '1005636266',
      apiKeySecret: 'v3-access-token-test',
    },
    updated_by: 'test',
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    version: 1,
  });

  function now() {
    return new Date().toISOString();
  }

  return {
    audios,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('CREATE TABLE')) {
        return { rows: [] };
      }
      if (normalized.includes('FROM user_account') && (params[0] === 'LilyLuv' || params[0] === 7)) {
        return { rows: [users.get('LilyLuv')] };
      }
      if (normalized.includes('FROM app_config') && normalized.includes('WHERE config_type = $1')) {
        const row = configs.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (normalized.startsWith('INSERT INTO test_audio (')) {
        const row = {
          id: nextAudioId++,
          name: params[0],
          text_content: params[1],
          voice_code: params[2],
          language: params[3],
          speed: params[4],
          pitch: params[5],
          volume: params[6],
          audio_format: params[7],
          sample_rate: params[8],
          duration_ms: null,
          file_url: null,
          file_path: null,
          file_size: null,
          file_hash: null,
          status: 'generating',
          error_message: null,
          generation_params: params[9],
          created_by: params[10],
          created_at: now(),
          updated_at: now(),
          deleted_at: null,
        };
        audios.set(String(row.id), row);
        return { rows: [row] };
      }
      if (normalized.startsWith('UPDATE test_audio SET name')) {
        const row = audios.get(String(params[0]));
        Object.assign(row, {
          name: params[1],
          text_content: params[2],
          voice_code: params[3],
          language: params[4],
          speed: params[5],
          pitch: params[6],
          volume: params[7],
          audio_format: params[8],
          sample_rate: params[9],
          duration_ms: params[10],
          file_url: params[11],
          file_path: params[12],
          file_size: params[13],
          file_hash: params[14],
          status: 'success',
          error_message: null,
          generation_params: params[15],
          updated_at: now(),
        });
        return { rows: [row] };
      }
      if (normalized.startsWith('UPDATE test_audio SET status = $2')) {
        const row = audios.get(String(params[0]));
        Object.assign(row, {
          status: params[1],
          error_message: params[2],
          updated_at: now(),
        });
        return { rows: [row] };
      }
      if (normalized.startsWith("UPDATE test_audio SET status = 'generating'")) {
        const row = audios.get(String(params[0]));
        if (!row || row.status === 'generating') return { rows: [] };
        row.status = 'generating';
        row.error_message = null;
        row.updated_at = now();
        return { rows: [row] };
      }
      if (normalized.startsWith("UPDATE test_audio SET status = 'deleted'")) {
        const row = audios.get(String(params[0]));
        if (!row || row.deleted_at || row.status === 'deleted') return { rows: [] };
        row.status = 'deleted';
        row.deleted_at = now();
        row.updated_at = now();
        return { rows: [row] };
      }
      if (normalized.startsWith('INSERT INTO test_audio_generation_record')) {
        return { rows: [] };
      }
      if (normalized.includes('FROM test_audio') && normalized.includes('WHERE id = $1')) {
        const row = audios.get(String(params[0]));
        if (!row || row.deleted_at || row.status === 'deleted') return { rows: [] };
        return { rows: [row] };
      }
      if (normalized.includes('FROM test_audio') && normalized.includes('ORDER BY created_at DESC')) {
        return {
          rows: Array.from(audios.values()).filter((row) => !row.deleted_at && row.status !== 'deleted'),
        };
      }
      return { rows: [] };
    },
  };
}

async function request(server, method, path, body, cookie = '') {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    headers: response.headers,
    buffer,
    json: () => JSON.parse(buffer.toString('utf8') || '{}'),
  };
}

const originalFetch = globalThis.fetch;
const originalStorageDir = process.env.TEST_AUDIO_STORAGE_DIR;
const storageDir = await mkdtemp(join(tmpdir(), 'voiceauto-test-audios-'));
process.env.TEST_AUDIO_STORAGE_DIR = storageDir;

let providerBody = JSON.stringify({
  data: Buffer.from('first-mp3-bytes').toString('base64'),
});
let providerStatus = 200;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('openspeech.bytedance.com')) {
    return new Response(providerBody, {
      status: providerStatus,
      headers: {
        'Content-Type': 'application/json',
        'X-Tt-Logid': 'log-123',
      },
    });
  }
  return originalFetch(url, options);
};

const pool = createMockPool();
const server = createServer(createApp({
  pool,
  sessionStore: new Map(),
}));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const login = await request(server, 'POST', '/api/auth/login', {
    loginAccount: 'LilyLuv',
    password: 'Sdmc1234',
  });
  const cookie = login.headers.get('set-cookie');

  const created = await request(server, 'POST', '/api/test-audios', {
    name: '欢迎语测试',
    textContent: '您好，请问有什么可以帮您？',
    voiceCode: 'zh_female_wanwanxiaohe_moon_bigtts',
    language: 'zh-CN',
    speed: 1,
    pitch: 1,
    volume: 1,
    audioFormat: 'mp3',
  }, cookie);
  assert.equal(created.status, 201);
  assert.equal(created.json().audio.status, 'success');
  assert.equal(created.json().audio.fileSize, 'first-mp3-bytes'.length);
  assert.match(created.json().audio.fileUrl, /\/api\/test-audios\/10001\/play/);

  const list = await request(server, 'GET', '/api/test-audios', null, cookie);
  assert.equal(list.status, 200);
  assert.equal(list.json().audios.length, 1);

  const play = await request(server, 'GET', '/api/test-audios/10001/play', null, cookie);
  assert.equal(play.status, 200);
  assert.equal(play.headers.get('content-type'), 'audio/mpeg');
  assert.equal(play.buffer.toString('utf8'), 'first-mp3-bytes');

  providerStatus = 500;
  providerBody = JSON.stringify({ message: 'temporary provider failure' });
  const failedRegenerate = await request(server, 'POST', '/api/test-audios/10001/regenerate', {
    mode: 'use_original_params',
  }, cookie);
  assert.equal(failedRegenerate.status, 502);
  assert.equal(pool.audios.get('10001').status, 'success');
  assert.match(pool.audios.get('10001').error_message, /temporary provider failure/);

  const stillPlayable = await request(server, 'GET', '/api/test-audios/10001/play', null, cookie);
  assert.equal(stillPlayable.status, 200);
  assert.equal(stillPlayable.buffer.toString('utf8'), 'first-mp3-bytes');

  const deleted = await request(server, 'DELETE', '/api/test-audios/10001', null, cookie);
  assert.equal(deleted.status, 200);
  const emptyList = await request(server, 'GET', '/api/test-audios', null, cookie);
  assert.equal(emptyList.json().audios.length, 0);
} finally {
  globalThis.fetch = originalFetch;
  if (originalStorageDir === undefined) {
    delete process.env.TEST_AUDIO_STORAGE_DIR;
  } else {
    process.env.TEST_AUDIO_STORAGE_DIR = originalStorageDir;
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(storageDir, { recursive: true, force: true });
}
