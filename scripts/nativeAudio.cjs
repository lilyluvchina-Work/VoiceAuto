const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createNativeAudioManager({ spawnProcess = spawn, root = path.resolve(__dirname, '..') } = {}) {
  const localPython = path.join(root, '.audio-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = process.env.VOICEAUTO_AUDIO_PYTHON || (fs.existsSync(localPython) ? localPython : 'python');
  const sessions = new Map();
  let busy = false;
  function worker(command, onEvent, onExit) {
    const child = spawnProcess(python, ['-u', path.join(__dirname, 'nativeAudio.py')], { windowsHide: true });
    let buffer = '', errors = '';
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try { onEvent(JSON.parse(line)); } catch (error) { onEvent({ event: 'error', message: error.message }); }
      }
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
    child.on('error', error => onEvent({ event: 'error', message: error.message }));
    child.stdin.on('error', () => {});
    child.on('close', code => onExit(code, errors));
    child.stdin.write(JSON.stringify(command) + '\n');
    return child;
  }
  function devices() {
    return new Promise((resolve, reject) => {
      let result;
      const child = worker({ action: 'devices' }, event => { result = event; }, () => {
        clearTimeout(timer);
        if (result?.event === 'devices') resolve(result.devices);
        else reject(new Error(result?.message || '本地音频采集依赖未安装，请运行 scripts/installNativeAudio.ps1'));
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error('本地音频设备检测超时')); }, 15000);
    });
  }
  async function start(options) {
    if (busy) throw new Error('外接音频设备正在采集，请先停止当前录音');
    if (!String(options.deviceId || '').startsWith('native:')) throw new Error('请先检测并选择本地音频输入设备');
    busy = true;
    const id = randomUUID();
    const outputPath = path.join(root, 'logs', 'speaker-audio', `speaker_${id}.wav`);
    const session = { id, outputPath, status: 'starting', level: 0, result: null, error: '' };
    sessions.set(id, session);
    return new Promise((resolve, reject) => {
      let opened = false;
      const fail = message => { session.error = message; if (!opened) reject(new Error(message)); };
      session.child = worker({ ...options, action: 'record', outputPath }, event => {
        if (event.event === 'ready') { clearTimeout(session.startTimer); opened = true; session.status = 'recording'; resolve({ sessionId: id, ...event }); }
        if (event.event === 'level') { session.level = event.rms; session.durationMs = event.durationMs; }
        if (event.event === 'result') session.result = event;
        if (event.event === 'error') fail(event.message);
      }, (code, stderr) => {
        busy = false;
        clearTimeout(session.timer);
        clearTimeout(session.startTimer);
        if (!session.result && !session.error) fail(stderr || `本地录音进程退出 (${code})，请检查 Python 采集依赖`);
        session.status = 'completed';
        setTimeout(() => sessions.delete(id), 5 * 60 * 1000).unref();
      });
      session.timer = setTimeout(() => {
        fail('本地录音超时，已释放设备'); session.child.kill();
      }, Math.min(240000, Math.max(500, Number(options.maxRecordMs) || 120000)) + 15000);
      session.startTimer = setTimeout(() => { fail('打开本地音频输入超时'); session.child.kill(); }, 12000);
    });
  }
  async function handle(body) {
    if (body.action === 'devices') return { success: true, devices: await devices() };
    if (body.action === 'start') return { success: true, ...await start(body.options || {}) };
    const session = sessions.get(body.sessionId);
    if (!session) throw new Error('本地录音会话已失效');
    if (body.action === 'cancel') { session.child.kill(); return { success: true }; }
    if (body.action === 'stop') { if (session.status !== 'completed') session.child.stdin.end('stop\n'); return { success: true }; }
    if (body.action === 'status') return { success: true, status: session.status, rms: session.level, durationMs: session.durationMs, error: session.error };
    if (body.action === 'result') {
      if (session.error) throw new Error(session.error);
      if (session.status !== 'completed') throw new Error('录音仍在进行');
      return { ...session.result, audioBase64: fs.readFileSync(session.outputPath).toString('base64'), localPath: session.outputPath };
    }
    throw new Error('Unknown native audio action');
  }
  return { handle, isBusy: () => busy };
}
module.exports = { createNativeAudioManager };
