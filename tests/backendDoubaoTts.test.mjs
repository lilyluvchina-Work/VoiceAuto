import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';

function createMockPool(doubaoPayload = {}) {
  const users = new Map();
  const configs = new Map();
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
      accessKeyId: 'ak-test',
      secretAccessKey: 'sk-test',
      apiKeyId: 'api-key-id-test',
      apiKeySecret: 'v3-api-key-secret',
      ...doubaoPayload,
    },
    updated_by: 'test',
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    version: 1,
  });

  return {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM user_account') && (params[0] === 'LilyLuv' || params[0] === 7)) {
        return { rows: [users.get('LilyLuv')] };
      }
      if (normalized.includes('FROM app_config') && normalized.includes('WHERE config_type = $1')) {
        const row = configs.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (normalized.startsWith('CREATE TABLE')) {
        return { rows: [] };
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
const doubaoCalls = [];
let doubaoResponseStatus = 200;
let doubaoResponseContentType = 'application/json';
let doubaoResponseBody = JSON.stringify({
  data: Buffer.from('mp3-bytes').toString('base64'),
});
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('openspeech.bytedance.com')) {
    doubaoCalls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(doubaoResponseBody, {
      status: doubaoResponseStatus,
      headers: {
        'Content-Type': doubaoResponseContentType,
        'X-Tt-Logid': 'log-123',
      },
    });
  }
  return originalFetch(url, options);
};

const server = createServer(createApp({
  pool: createMockPool(),
  sessionStore: new Map(),
}));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const login = await request(server, 'POST', '/api/auth/login', {
    loginAccount: 'LilyLuv',
    password: 'Sdmc1234',
  });
  const cookie = login.headers.get('set-cookie');

  const response = await request(server, 'POST', '/api/tts/doubao-v3', {
    text: 'Turn on the living room light.',
    voiceType: 'zh_female_shuangkuaisisi_moon_bigtts',
    lang: 'en-US',
    rate: 2.5,
    volume: 250,
  }, cookie);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.buffer.toString('utf8'), 'mp3-bytes');

  assert.equal(doubaoCalls.length, 1);
  assert.equal(doubaoCalls[0].options.headers['X-Api-App-Key'], 'api-key-id-test');
  assert.equal(doubaoCalls[0].options.headers['X-Api-Access-Key'], 'v3-api-key-secret');
  assert.equal('X-Api-Key' in doubaoCalls[0].options.headers, false);
  assert.equal(doubaoCalls[0].options.headers['X-Api-Resource-Id'], 'seed-tts-2.0');
  assert.equal(doubaoCalls[0].body.req_params.speaker, 'zh_female_vv_uranus_bigtts');
  assert.equal(doubaoCalls[0].body.req_params.speed_ratio, 2);
  assert.equal(doubaoCalls[0].body.req_params.volume_ratio, 2);

  doubaoResponseStatus = 200;
  doubaoResponseContentType = 'audio/mpeg';
  doubaoResponseBody = 'direct-mp3-bytes';
  const binaryResponse = await request(server, 'POST', '/api/tts/doubao-v3', {
    text: 'binary audio',
    voiceType: 'en_female_skye_emo_v2_mars_bigtts',
  }, cookie);
  assert.equal(binaryResponse.status, 200);
  assert.equal(binaryResponse.headers.get('content-type'), 'audio/mpeg');
  assert.equal(binaryResponse.buffer.toString('utf8'), 'direct-mp3-bytes');

  doubaoResponseStatus = 200;
  doubaoResponseContentType = 'text/plain; charset=utf-8';
  doubaoResponseBody = JSON.stringify({
    code: 55000000,
    message: 'resource ID is mismatched with speaker related resource',
  });
  const providerBusinessError = await request(server, 'POST', '/api/tts/doubao-v3', {
    text: 'business error',
    voiceType: 'en_female_skye_emo_v2_mars_bigtts',
  }, cookie);
  assert.equal(providerBusinessError.status, 502);
  assert.equal(providerBusinessError.json().message, 'resource ID is mismatched with speaker related resource');
  assert.equal(providerBusinessError.json().providerCode, 55000000);

  doubaoResponseStatus = 401;
  doubaoResponseContentType = 'application/json';
  doubaoResponseBody = JSON.stringify({
    header: {
      code: 45000010,
      message: 'Invalid X-Api-Key',
    },
  });
  const invalidKeyResponse = await request(server, 'POST', '/api/tts/doubao-v3', {
    text: 'hello',
    voiceType: 'en_female_skye_emo_v2_mars_bigtts',
  }, cookie);
  assert.equal(invalidKeyResponse.status, 502);
  assert.equal(invalidKeyResponse.json().message, 'Invalid X-Api-Key');
  assert.equal(invalidKeyResponse.json().providerStatus, 401);

  await new Promise((resolve) => server.close(resolve));
  const apiKeyServer = createServer(createApp({
    pool: createMockPool({ apiKey: 'direct-api-key-test' }),
    sessionStore: new Map(),
  }));
  await new Promise((resolve) => apiKeyServer.listen(0, '127.0.0.1', resolve));
  try {
    doubaoCalls.length = 0;
    doubaoResponseStatus = 200;
    doubaoResponseContentType = 'application/json';
    doubaoResponseBody = JSON.stringify({
      data: Buffer.from('mp3-bytes').toString('base64'),
    });
    const apiKeyLogin = await request(apiKeyServer, 'POST', '/api/auth/login', {
      loginAccount: 'LilyLuv',
      password: 'Sdmc1234',
    });
    const apiKeyCookie = apiKeyLogin.headers.get('set-cookie');
    const apiKeyResponse = await request(apiKeyServer, 'POST', '/api/tts/doubao-v3', {
      text: 'direct api key',
      voiceType: 'en_female_skye_emo_v2_mars_bigtts',
    }, apiKeyCookie);
    assert.equal(apiKeyResponse.status, 200);
    assert.equal(doubaoCalls[0].options.headers['X-Api-Key'], 'direct-api-key-test');
    assert.equal('X-Api-App-Key' in doubaoCalls[0].options.headers, false);
    assert.equal('X-Api-Access-Key' in doubaoCalls[0].options.headers, false);
  } finally {
    await new Promise((resolve) => apiKeyServer.close(resolve));
  }
} finally {
  globalThis.fetch = originalFetch;
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
}
