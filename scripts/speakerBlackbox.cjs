/** Persistent, isolated black-box runs. Browser reloads do not stop a worker. */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createRunNotifier } = require('./speakerBlackboxNotify.cjs');

const UUID = /^[a-f0-9-]{36}$/;
const ASSET = /^[a-zA-Z0-9_-]{1,80}$/;
const RECORDING = /^recordings\/[a-zA-Z0-9_-]+\.wav$/;
const MAX_ASSET = 40 * 1024 * 1024;
function atomicJson(filename, data) {
  const temp = filename + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, filename);
}
function validateWav(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(44);
    if (fs.readSync(fd, header, 0, 44, 0) !== 44 || header.toString('ascii', 0, 4) !== 'RIFF'
      || header.toString('ascii', 8, 16) !== 'WAVEfmt ' || header.readUInt16LE(20) !== 1
      || header.readUInt16LE(22) !== 1 || header.readUInt16LE(34) !== 16
      || ![16000, 32000, 48000].includes(header.readUInt32LE(24)) || header.toString('ascii', 36, 40) !== 'data'
      || header.readUInt32LE(40) + 44 !== fs.statSync(file).size) throw new Error('音频须为有效单声道 16-bit PCM WAV');
  } finally { fs.closeSync(fd); }
}

function createBlackboxManager({ root = path.resolve(__dirname, '..'), spawnProcess = spawn, notifierFactory = createRunNotifier, resetTimeoutMs = 35000 } = {}) {
  const storage = path.join(root, 'logs', 'speaker-blackbox');
  const workers = new Map();
  const finalizers = new Map();
  const resets = new Map();
  let busy = false;
  let pendingNotifications = 0;
  const pythonLocal = path.join(root, '.audio-python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const stablePython = path.join(root, '.audio-python', 'runtime311', 'python.exe');
  const python = process.env.VOICEAUTO_AUDIO_PYTHON || (fs.existsSync(stablePython) ? stablePython : fs.existsSync(pythonLocal) ? pythonLocal : 'python');
  const reportModule = () => import(pathToFileURL(path.join(__dirname, 'speakerBlackboxReport.mjs')).href);
  const folder = id => {
    if (!UUID.test(id || '')) throw new Error('无效任务 ID');
    return path.join(storage, id);
  };
  const save = run => {
    atomicJson(path.join(folder(run.id), 'results.json'), run);
    atomicJson(path.join(folder(run.id), 'config.json'), { ...run.config, calibration: run.calibration, templates: run.templates, cases: run.cases });
  };
  const enrichAttempt = (run, attempt) => {
    const source = (attempt.sourceId != null && run.cases?.find(c => c.sourceId === attempt.sourceId || c.id === attempt.sourceId))
      || run.cases?.[Number(String(attempt.caseId).split('_')[0]) - 1];
    return source ? { ...attempt, sourceId: source.sourceId ?? source.id, name: source.name,
      text: source.text || source.name || attempt.text || '' } : attempt;
  };
  const load = id => {
    const run = JSON.parse(fs.readFileSync(path.join(folder(id), 'results.json'), 'utf8'));
    run.attempts = (run.attempts || []).map(attempt => enrichAttempt(run, attempt));
    if (run.pendingAttempt) run.pendingAttempt = enrichAttempt(run, run.pendingAttempt);
    if (['running', 'calibrating', 'pausing', 'paused', 'resuming', 'stopping'].includes(run.status) && !workers.has(id)) {
      if (run.pendingAttempt) run.attempts.push({ ...run.pendingAttempt, status: 'interrupted', caseCompleted: false });
      delete run.pendingAttempt;
      run.status = 'interrupted'; run.endedAt = new Date().toISOString();
      run.error = '本机桥接或工作进程异常退出，已恢复已落盘的尝试及录音';
      save(run);
    }
    return run;
  };
  const worker = (command, onEvent, onClose) => {
    const child = spawnProcess(python, ['-u', path.join(__dirname, 'speakerBlackboxAudio.py')], {
      windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let buffer = '', stderr = '', closed = false;
    const finish = (code, message) => { if (!closed) { closed = true; onClose(code, message); } };
    child.stdout.on('data', data => {
      buffer += data.toString();
      let split;
      while ((split = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, split); buffer = buffer.slice(split + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        try { onEvent(event); } catch (error) {
          onEvent({ event: 'error', message: `结果保存失败: ${error.message}` });
          child.stdin.end('stop\n');
        }
      }
    });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
    child.stdin.on('error', () => {});
    child.on('error', error => finish(-1, error.message));
    child.on('close', code => finish(code, stderr));
    child.stdin.write(JSON.stringify(command) + '\n');
    return child;
  };
  async function deviceList() {
    return new Promise((resolve, reject) => {
      let result;
      const child = worker({ action: 'devices' }, event => { result = event; }, () => {
        clearTimeout(timer);
        if (result?.event === 'devices') resolve(result.devices);
        else reject(new Error(result?.message || '本机音频依赖未安装，请运行 scripts/installNativeAudio.ps1'));
      });
      const timer = setTimeout(() => { child.kill(); reject(new Error('检测设备超时')); }, 15000);
      timer.unref?.();
    });
  }
  function start(run, calibration, notificationConfig) {
    if (busy) throw new Error('已有音箱黑盒任务占用音频设备，请先停止');
    if (!['draft', 'calibrated'].includes(run.status)) throw new Error('此任务已执行，请创建新任务；历史录音不可覆盖');
    if (!run.wakeAsset || !run.assets[run.wakeAsset]) throw new Error('缺少唤醒音频');
    if (!calibration && (!run.cases?.length || !run.templates?.length)) throw new Error('请导入测试音频并校准/导入唤醒回应样本');
    const assetPath = id => {
      if (!ASSET.test(id || '') || !run.assets[id]) throw new Error('音频尚未完整上传');
      const asset = path.join(folder(run.id), 'assets', id + '.wav');
      validateWav(asset);
      return asset;
    };
    const wakePath = assetPath(run.wakeAsset);
    const cases = (run.cases || []).map(c => ({ ...c, path: assetPath(c.id) }));
    run.status = calibration ? 'calibrating' : 'running';
    run.startedAt = new Date().toISOString(); delete run.endedAt; delete run.error;
    run.totalCases = cases.length * (run.config.repeatCount || 1);
    run.measurementMode = 'playback_guard_no_aec';
    save(run);
    busy = true;
    let resolveFinished;
    const ownFinished = new Promise(resolve => { resolveFinished = resolve; });
    const previous = finalizers.get(run.id);
    const finished = previous ? Promise.allSettled([previous, ownFinished]) : ownFinished;
    finalizers.set(run.id, finished);
    finished.then(() => { if (finalizers.get(run.id) === finished) finalizers.delete(run.id); });
    const notify = !calibration ? notifierFactory(notificationConfig, run) : null;
    let notificationChain = Promise.resolve();
    const sendNotification = event => {
      if (!notify) return;
      run.notifications = { ...run.notifications, [event]: { status: 'pending' } }; save(run);
      if (notificationConfig?.enabled) pendingNotifications++;
      notificationChain = notificationChain.then(() => notify(event, run)).then(result => {
        run.notifications = { ...run.notifications, [event]: result }; save(run);
      }).catch(() => { run.notifications = { ...run.notifications, [event]: { status: 'failed' } }; save(run); })
        .finally(() => { if (notificationConfig?.enabled) pendingNotifications--; });
    };
    let done = false, finalStatus;
    let child;
    try {
      child = worker({ action: calibration ? 'calibrate' : 'run', config: run.config, folder: folder(run.id),
      wakePath, cases, templates: run.templates, calibration: run.calibration }, event => {
      if (event.event === 'level') {
        run.level = event.rms; run.clipping = event.clipping; run.recording = event.recording;
      } else {
        if (event.event === 'ready') { run.devices = { input: event.input, output: event.output }; run.timing = event; }
        if (event.event === 'control' && ['paused', 'running'].includes(event.status) && run.status !== 'stopping') {
          run.status = event.status; run.phase = event.status === 'paused' ? '已暂停，继续时重新执行当前用例' : '继续测试';
          if (event.status === 'paused') run.recording = false;
        }
        if (event.event === 'phase') { run.phase = event.phase; run.currentCase = event.caseId || run.currentCase; run.currentAttempt = event.attempt || run.currentAttempt; }
        if (event.event === 'attempt_started') run.pendingAttempt = enrichAttempt(run, event);
        if (event.event === 'attempt') { run.attempts.push(enrichAttempt(run, event)); delete run.pendingAttempt; }
        if (event.event === 'calibration') { run.calibration = event.calibration; run.templates = event.templates; }
        if (event.event === 'error') { run.error = event.message; run.status = 'error'; }
        if (event.event === 'done') {
          done = true;
          if (!run.error) finalStatus = event.status === 'aborted' ? 'aborted' : calibration ? 'calibrated'
            : run.attempts.some(a => a.status === 'error') ? 'error' : 'completed';
          run.phase = '正在保存录音并释放设备';
        }
        save(run);
      }
    }, (code, stderr) => {
      busy = false;
      const entry = workers.get(run.id); clearTimeout(entry?.stopTimer); clearTimeout(entry?.watchdog);
      workers.delete(run.id);
      if (done && finalStatus) run.status = run.status === 'stopping' ? 'aborted' : finalStatus;
      if (!done) {
        run.status = run.status === 'stopping' ? 'aborted' : 'error';
        run.error ||= stderr || `音频进程退出 (${code})`;
      }
      if (run.pendingAttempt) {
        run.attempts.push({ ...run.pendingAttempt, status: run.status === 'aborted' ? 'aborted' : 'error', error: run.error, caseCompleted: false });
        delete run.pendingAttempt;
      }
      run.recording = false; run.endedAt = new Date().toISOString();
      save(run);
      sendNotification('ended');
      const reportDone = reportModule().then(({ renderReport }) => fs.writeFileSync(path.join(folder(run.id), 'report.html'), renderReport(run))).catch(error => { run.error = error.message; save(run); });
      Promise.allSettled([notificationChain, reportDone]).then(() => {
        resolveFinished();
      });
    });
    } catch (error) {
      busy = false;
      run.status = 'error'; run.error = error.message; run.endedAt = new Date().toISOString();
      save(run); resolveFinished();
      throw error;
    }
    // Device stalls are also caught inside the worker; this bounds a process
    // which never even opens an audio stream.
    const watchdog = setTimeout(() => {
      if (!run.timing && workers.has(run.id)) { run.error = '打开全双工音频设备超时'; child.kill(); }
    }, 20000);
    watchdog.unref?.();
    workers.set(run.id, { child, run, watchdog });
    sendNotification('started');
    return run;
  }
  async function handle(body) {
    if (body.action === 'reset') {
      const target = path.resolve(folder(body.id));
      if (resets.has(body.id)) return resets.get(body.id);
      const operation = (async () => {
        const finished = finalizers.get(body.id);
        if (workers.has(body.id)) await handle({ action: 'stop', id: body.id });
        if (finished) {
          let timer;
          try {
            await Promise.race([finished, new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('结束任务超时，数据尚未清空，请稍后重试')), resetTimeoutMs);
            })]);
          } finally { clearTimeout(timer); }
        }
        if (workers.has(body.id)) throw new Error('任务尚未停止，不能清空测试数据');
        if (fs.existsSync(target)) {
          const realStorage = fs.realpathSync(storage), realTarget = fs.realpathSync(target);
          if (path.dirname(realTarget) !== realStorage || fs.lstatSync(target).isSymbolicLink()) throw new Error('无效任务数据目录');
          await fs.promises.rm(target, { recursive: true, force: true });
        }
        return { success: true, reset: true, id: body.id };
      })();
      resets.set(body.id, operation);
      try { return await operation; } finally { resets.delete(body.id); }
    }
    if (body.action === 'devices') return { devices: await deviceList() };
    if (body.action === 'history') {
      if (!fs.existsSync(storage)) return { runs: [] };
      const runs = fs.readdirSync(storage).filter(id => UUID.test(id)).flatMap(id => {
        try { const run = workers.get(id)?.run || load(id); return [{ id, taskName: run.config.taskName, status: run.status, startedAt: run.startedAt, attempts: run.attempts.length }]; }
        catch { return []; }
      }).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
      return { runs: runs.slice(0, 100) };
    }
    if (body.action === 'create') {
      const run = { id: randomUUID(), status: 'draft', config: body.config || {}, attempts: [], assets: {}, cases: [], templates: [], createdAt: new Date().toISOString() };
      fs.mkdirSync(path.join(folder(run.id), 'assets'), { recursive: true });
      fs.mkdirSync(path.join(folder(run.id), 'recordings'), { recursive: true }); save(run);
      return run;
    }
    if (body.action === 'status' && !workers.has(body.id) && !fs.existsSync(folder(body.id))) {
      return { id: body.id, status: 'missing', reset: true };
    }
    const run = workers.get(body.id)?.run || load(body.id);
    if (body.action === 'status') return { ...run, localPath: folder(run.id) };
    if (resets.has(run.id) && body.action !== 'stop') throw new Error('正在重置测试，请等待清理完成');
    if (body.action === 'pause' || body.action === 'resume') {
      const entry = workers.get(run.id);
      const expected = body.action === 'pause' ? 'running' : 'paused';
      if (!entry || run.status !== expected) throw new Error(body.action === 'pause' ? '仅运行中的测试可以暂停' : '请等待测试完全暂停后继续');
      run.status = body.action === 'pause' ? 'pausing' : 'resuming'; save(run);
      entry.child.stdin.write(body.action + '\n');
      return { ...run };
    }
    if (body.action === 'stop') {
      const entry = workers.get(run.id);
      if (entry && run.status !== 'stopping') {
        run.status = 'stopping'; save(run); entry.child.stdin.end('stop\n');
        entry.stopTimer = setTimeout(() => entry.child.kill(), 6000); entry.stopTimer.unref?.();
      }
      return { status: run.status };
    }
    if (body.action === 'recording') {
      if (!RECORDING.test(body.file || '')) throw new Error('无效录音路径');
      const file = path.join(folder(run.id), body.file);
      const size = fs.statSync(file).size;
      const offset = Number(body.offset || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) throw new Error('无效录音偏移');
      const bytes = Buffer.alloc(Math.min(256 * 1024, size - offset));
      const fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, bytes, 0, bytes.length, offset); } finally { fs.closeSync(fd); }
      return { data: bytes.toString('base64'), size, offset, nextOffset: offset + bytes.length };
    }
    if (body.action === 'review') {
      const attempt = run.attempts.find(a => a.caseId === body.caseId && a.attempt === body.attempt);
      if (!attempt || !['', '已人工复核', '疑似干扰', '需复核'].includes(body.review)) throw new Error('无效复核标记');
      attempt.review = body.review; save(run); return run;
    }
    if (workers.has(run.id)) throw new Error('任务执行中不能修改音频或配置');
    if (body.action === 'report') {
      await finalizers.get(run.id);
      const { renderReport } = await reportModule();
      const html = renderReport(run);
      fs.writeFileSync(path.join(folder(run.id), 'report.html'), html);
      const recordings = fs.readdirSync(path.join(folder(run.id), 'recordings')).filter(name => /^[a-zA-Z0-9_-]+\.wav$/.test(name)).map(name => 'recordings/' + name);
      return { html, run, recordings };
    }
    if (!['draft', 'calibrated'].includes(run.status)) throw new Error('历史任务只读，请创建新任务');
    if (body.action === 'upload') {
      if (!ASSET.test(body.assetId || '') || typeof body.data !== 'string' || body.data.length > 350000
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) throw new Error('无效音频上传块');
      const file = path.join(folder(run.id), 'assets', body.assetId + '.wav');
      const offset = Number(body.offset);
      const bytes = Buffer.from(body.data, 'base64');
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (!Number.isSafeInteger(offset) || offset !== size || offset + bytes.length > MAX_ASSET) throw new Error('音频块偏移不匹配或文件超过 40 MiB');
      if (run.assets[body.assetId]) throw new Error('音频已完成上传');
      fs.appendFileSync(file, bytes);
      if (body.final) { validateWav(file); run.assets[body.assetId] = true; save(run); }
      return { nextOffset: offset + bytes.length };
    }
    if (body.action === 'configure') {
      if (!Array.isArray(body.cases) || body.cases.length > 1000 || body.cases.some(c => !run.assets[c.id])) throw new Error('无效用例音频');
      if (!run.assets[body.wakeAsset]) throw new Error('无效唤醒音频');
      if (body.templates && (!Array.isArray(body.templates) || body.templates.length > 20 || body.templates.some(t => !['speech', 'tone'].includes(t.kind) || !Array.isArray(t.frames) || !t.frames.length || t.frames.length > 250 || t.frames.some(f => !Array.isArray(f) || f.length !== 24 || f.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1))))) throw new Error('无效唤醒模板');
      Object.assign(run, { config: body.config, cases: body.cases, wakeAsset: body.wakeAsset,
        templates: body.templates || run.templates, calibration: body.calibration || run.calibration }); save(run); return run;
    }
    if (body.action === 'template') {
      if (!ASSET.test(body.assetId || '') || !run.assets[body.assetId] || !['speech', 'tone'].includes(body.kind)) throw new Error('无效样本');
      return new Promise((resolve, reject) => {
        let result;
        const child = worker({ action: 'template', path: path.join(folder(run.id), 'assets', body.assetId + '.wav'),
          kind: body.kind, name: String(body.name || '').slice(0, 200) }, event => { result = event; }, () => {
          clearTimeout(timer);
          if (result?.event === 'template') resolve(result);
          else reject(new Error(result?.message || '无法解析回应样本'));
        });
        const timer = setTimeout(() => { child.kill(); reject(new Error('样本解析超时')); }, 15000);
      });
    }
    if (body.action === 'start' || body.action === 'calibrate') return start(run, body.action === 'calibrate', body.notificationConfig);
    throw new Error('未知黑盒测试操作');
  }
  return { handle, isBusy: () => busy || pendingNotifications > 0 };
}
module.exports = { createBlackboxManager };
