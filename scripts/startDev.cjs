const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const ERROR_LOG = path.join(LOG_DIR, 'startup-error.log');
const CHECK_LOG = path.join(LOG_DIR, 'startup-check.log');
const BRIDGE_OUT_LOG = path.join(LOG_DIR, 'adb-bridge.out.log');
const BRIDGE_ERR_LOG = path.join(LOG_DIR, 'adb-bridge.err.log');
const DEV_PORT = 3000;
const BRIDGE_PORT = 17321;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function appendLog(file, title, details = {}) {
  ensureLogDir();
  const body = [
    '',
    `[${new Date().toISOString()}] ${title}`,
    JSON.stringify(details, null, 2)
  ].join('\n');
  fs.appendFileSync(file, `${body}\n`, 'utf8');
}

function appendErrorWithSolution(errorInfo, solution) {
  appendLog(ERROR_LOG, 'STARTUP_ERROR', {
    error: errorInfo,
    solution
  });
}

function requestText(port, pathname = '/', timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ ok: true, statusCode: res.statusCode, body: data });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
    req.end();
  });
}

function postJson(port, pathname, payload = {}, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ ok: true, statusCode: res.statusCode, data: data ? JSON.parse(data) : {} });
        } catch (err) {
          resolve({ ok: false, statusCode: res.statusCode, error: `invalid json: ${data.slice(0, 120)}` });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
    req.write(body);
    req.end();
  });
}

async function isVoiceAutoRunning() {
  const result = await requestText(DEV_PORT);
  if (!result.ok) return { running: false, reason: result.error || '' };
  return {
    running: /VoiceAuto|\/@vite\/client|react-refresh/i.test(result.body || ''),
    reason: result.body ? 'http response received' : 'empty response'
  };
}

async function ensureAdbBridge() {
  // Project startup depends on the ADB bridge; check it before starting Vite so failures are logged early.
  const healthBefore = await postJson(BRIDGE_PORT, '/api/adb/health', {}, 12000);
  if (healthBefore.ok) {
    appendLog(CHECK_LOG, 'ADB_BRIDGE_HEALTH', healthBefore.data || {});
    return { started: false, health: healthBefore.data };
  }

  appendErrorWithSolution(
    {
      type: 'ADB_BRIDGE_NOT_RUNNING',
      message: `ADB bridge port ${BRIDGE_PORT} is not reachable`,
      detail: healthBefore.error || ''
    },
    [
      `启动 ADB bridge: npm run adb:bridge`,
      `或直接执行: node scripts/adbBridge.cjs`,
      `启动后检查: POST http://127.0.0.1:${BRIDGE_PORT}/api/adb/health`,
      `如果 ADB 状态异常，执行: adb kill-server && adb start-server && adb devices && adb logcat -c`
    ]
  );

  ensureLogDir();
  const out = fs.openSync(BRIDGE_OUT_LOG, 'a');
  const err = fs.openSync(BRIDGE_ERR_LOG, 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'adbBridge.cjs')], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true
  });
  child.unref();

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const healthAfter = await postJson(BRIDGE_PORT, '/api/adb/health', {}, 12000);
  appendLog(CHECK_LOG, 'ADB_BRIDGE_STARTED', {
    pid: child.pid,
    health: healthAfter.ok ? healthAfter.data : healthAfter
  });
  return { started: true, pid: child.pid, health: healthAfter.ok ? healthAfter.data : null };
}

function startVite() {
  const viteBin = process.platform === 'win32'
    ? path.join(ROOT, 'node_modules', '.bin', 'vite.cmd')
    : path.join(ROOT, 'node_modules', '.bin', 'vite');

  if (!fs.existsSync(viteBin)) {
    appendErrorWithSolution(
      {
        type: 'DEPENDENCY_MISSING',
        message: 'Vite executable not found',
        path: viteBin
      },
      [
        '重新安装依赖: npm install',
        '确认 package-lock.json 与 node_modules 匹配',
        '安装完成后重新执行: npm run dev'
      ]
    );
    process.exitCode = 1;
    return;
  }

  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', viteBin], {
        cwd: ROOT,
        stdio: 'inherit',
        windowsHide: false
      })
    : spawn(viteBin, [], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: false,
        windowsHide: false
      });
  child.on('exit', (code) => {
    process.exitCode = code || 0;
  });
}

async function main() {
  appendLog(CHECK_LOG, 'STARTUP_PREFLIGHT_BEGIN', {
    node: process.version,
    cwd: ROOT,
    devPort: DEV_PORT,
    bridgePort: BRIDGE_PORT
  });

  const bridge = await ensureAdbBridge();
  const voiceAuto = await isVoiceAutoRunning();
  if (voiceAuto.running) {
    appendErrorWithSolution(
      {
        type: 'DEV_SERVER_ALREADY_RUNNING',
        message: `Port ${DEV_PORT} is already serving VoiceAuto`,
        detail: voiceAuto.reason
      },
      [
        `项目已经运行，直接打开: http://127.0.0.1:${DEV_PORT}`,
        `如需重启，先结束占用 ${DEV_PORT} 的 node 进程，再执行 npm run dev`,
        `Windows 查看端口: netstat -ano | findstr ${DEV_PORT}`,
        'Windows 结束进程: taskkill /PID <进程ID> /F'
      ]
    );
    console.log(`VoiceAuto 已在运行: http://127.0.0.1:${DEV_PORT}`);
    if (bridge?.health?.message) {
      console.log(`Speaker 监听链路: ${bridge.health.message}`);
    }
    return;
  }

  if (voiceAuto.reason && !/ECONNREFUSED|connect/i.test(voiceAuto.reason)) {
    appendErrorWithSolution(
      {
        type: 'DEV_PORT_CHECK_WARNING',
        message: `Unable to confirm port ${DEV_PORT} status`,
        detail: voiceAuto.reason
      },
      [
        `检查端口: netstat -ano | findstr ${DEV_PORT}`,
        `如果端口被非本项目占用，结束该进程或修改 vite.config.js 端口`,
        '然后重新执行: npm run dev'
      ]
    );
  }

  appendLog(CHECK_LOG, 'START_VITE', { port: DEV_PORT });
  startVite();
}

main().catch((err) => {
  appendErrorWithSolution(
    {
      type: 'STARTUP_PREFLIGHT_FAILED',
      message: err?.message || String(err),
      stack: err?.stack || ''
    },
    [
      '查看 logs/startup-error.log 的第一条 STARTUP_ERROR',
      '确认 3000 端口和 17321 端口状态',
      '执行 npm install 修复依赖',
      '执行 npm run adb:bridge 单独验证 ADB bridge'
    ]
  );
  console.error(err);
  process.exit(1);
});
