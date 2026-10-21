const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createBlackboxManager } = require('../scripts/speakerBlackbox.cjs');

test('staged upload limits, history recovery and paths are confined to generated run directories', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackbox-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = createBlackboxManager({ root });
  const run = await manager.handle({ action: 'create', config: { taskName: 'test' } });
  assert.match(run.id, /^[0-9a-f-]{36}$/);
  await assert.rejects(manager.handle({ action: 'upload', id: run.id, assetId: '../escape', data: 'AAAA', offset: 0 }));
  await assert.rejects(manager.handle({ action: 'upload', id: run.id, assetId: 'a', data: 'A'.repeat(400000), offset: 0 }));
  const bytes = Buffer.alloc(44);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  await manager.handle({ action: 'upload', id: run.id, assetId: 'wake', data: bytes.toString('base64'), offset: 0, final: true });
  await assert.rejects(manager.handle({ action: 'recording', id: run.id, file: '../../package.json' }));
  const reloaded = createBlackboxManager({ root });
  assert.equal((await reloaded.handle({ action: 'status', id: run.id })).config.taskName, 'test');
  assert.equal((await reloaded.handle({ action: 'history' })).runs.length, 1);
});

function wav() {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(38, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(2, 40);
  return bytes;
}
test('running worker is exclusive; stop checkpoints a partial attempt and reload recovers it', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackbox-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let child;
  const spawnProcess = (_python, _args, options) => {
    assert.equal(options.env.PYTHONIOENCODING, 'utf-8');
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.write = () => {}; child.stdin.end = () => { child.stopped = true; }; child.kill = () => child.emit('close', 1);
    return child;
  };
  const manager = createBlackboxManager({ root, spawnProcess });
  const run = await manager.handle({ action: 'create', config: { taskName: 'lifecycle' } });
  await manager.handle({ action: 'upload', id: run.id, assetId: 'wake', offset: 0, data: wav().toString('base64'), final: true });
  await manager.handle({ action: 'configure', id: run.id, config: { taskName: 'lifecycle' }, wakeAsset: 'wake', cases: [{ id: 'wake' }], templates: [{ kind: 'tone', frames: [Array(24).fill(0)] }] });
  await manager.handle({ action: 'start', id: run.id });
  assert.equal(manager.isBusy(), true);
  child.stdout.emit('data', JSON.stringify({ event: 'ready', sampleRate: 16000 }) + '\n');
  child.stdout.emit('data', JSON.stringify({ event: 'attempt_started', caseId: '001_001', attempt: 1, recording: 'recordings/case_001_001_attempt_01_raw.wav' }) + '\n');
  const recovered = createBlackboxManager({ root });
  const partial = await recovered.handle({ action: 'status', id: run.id });
  assert.equal(partial.status, 'interrupted');
  assert.equal(partial.attempts[0].status, 'interrupted');
  assert.equal(partial.attempts[0].caseCompleted, false);
  await manager.handle({ action: 'stop', id: run.id });
  assert.equal(child.stopped, true);
  child.emit('close', 0);
  assert.equal(manager.isBusy(), false);
  const ended = await manager.handle({ action: 'status', id: run.id });
  assert.equal(ended.status, 'aborted');
  assert.equal(ended.attempts[0].status, 'aborted');
  const report = await manager.handle({ action: 'report', id: run.id });
  assert.ok(report.html.includes('用户中止'));
});

test('calibration is only reported ready after its worker releases the audio devices', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackbox-ready-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let child;
  const manager = createBlackboxManager({ root, spawnProcess: () => {
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.write = () => {}; child.stdin.end = () => {}; child.kill = () => child.emit('close', 1); return child;
  } });
  const run = await manager.handle({ action: 'create', config: {} });
  await manager.handle({ action: 'upload', id: run.id, assetId: 'wake', offset: 0, data: wav().toString('base64'), final: true });
  await manager.handle({ action: 'configure', id: run.id, config: {}, wakeAsset: 'wake', cases: [], templates: [] });
  await manager.handle({ action: 'calibrate', id: run.id });
  child.stdout.emit('data', JSON.stringify({ event: 'done', status: 'completed' }) + '\n');
  assert.equal((await manager.handle({ action: 'status', id: run.id })).status, 'calibrating');
  child.emit('close', 0);
  assert.equal((await manager.handle({ action: 'status', id: run.id })).status, 'calibrated');
  assert.equal(manager.isBusy(), false);
  await manager.handle({ action: 'report', id: run.id });
});

test('bridge owns ordered lifecycle notifications and never persists robot secrets', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackbox-notify-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let child, command;
  const delivered = [];
  const manager = createBlackboxManager({ root, notifierFactory: config => {
    assert.equal(config.secret, 'private-secret');
    return async (event, run) => { delivered.push([event, run.status]); return { status: 'sent' }; };
  }, spawnProcess: () => {
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.write = data => { command = data; }; child.stdin.end = () => {}; child.kill = () => child.emit('close', 1); return child;
  } });
  const run = await manager.handle({ action: 'create', config: { taskName: '中文任务' } });
  await manager.handle({ action: 'upload', id: run.id, assetId: 'wake', offset: 0, data: wav().toString('base64'), final: true });
  await manager.handle({ action: 'configure', id: run.id, config: {}, wakeAsset: 'wake',
    cases: [{ id: 'wake', sourceId: 'weather', name: '天气', text: '今天天气怎么样？' }], templates: [{ kind: 'tone', frames: [Array(24).fill(0)] }] });
  await manager.handle({ action: 'start', id: run.id, notificationConfig: { enabled: true, secret: 'private-secret' } });
  await new Promise(resolve => setImmediate(resolve));
  child.stdout.emit('data', JSON.stringify({ event: 'attempt', caseId: '001_001', sourceId: 'weather', name: '乱码', status: 'success' }) + '\n');
  child.stdout.emit('data', JSON.stringify({ event: 'done', status: 'completed' }) + '\n');
  child.emit('close', 0);
  await new Promise(resolve => setImmediate(resolve));
  const result = await manager.handle({ action: 'status', id: run.id });
  assert.deepEqual(delivered, [['started', 'running'], ['ended', 'completed']]);
  assert.equal(result.attempts[0].text, '今天天气怎么样？');
  assert.equal(result.attempts[0].name, '天气');
  assert.equal(result.notifications.ended.status, 'sent');
  assert.doesNotMatch(command, /private-secret/);
  for (const name of ['results.json', 'config.json']) assert.doesNotMatch(fs.readFileSync(path.join(root, 'logs/speaker-blackbox', run.id, name), 'utf8'), /private-secret/);
  await manager.handle({ action: 'report', id: run.id });
});

test('pause waits for worker acknowledgement and resume retains run/recording without end notification', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackbox-pause-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let child;
  const commands = [], delivered = [];
  const manager = createBlackboxManager({ root, notifierFactory: () => async event => { delivered.push(event); return { status: 'sent' }; }, spawnProcess: () => {
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.write = data => commands.push(data); child.stdin.end = () => {}; child.kill = () => child.emit('close', 1); return child;
  } });
  const run = await manager.handle({ action: 'create', config: {} });
  await manager.handle({ action: 'upload', id: run.id, assetId: 'wake', offset: 0, data: wav().toString('base64'), final: true });
  await manager.handle({ action: 'configure', id: run.id, config: {}, wakeAsset: 'wake', cases: [{ id: 'wake' }], templates: [{ kind: 'tone', frames: [Array(24).fill(0)] }] });
  await manager.handle({ action: 'start', id: run.id });
  assert.equal((await manager.handle({ action: 'pause', id: run.id })).status, 'pausing');
  await assert.rejects(manager.handle({ action: 'resume', id: run.id }));
  child.stdout.emit('data', JSON.stringify({ event: 'control', status: 'paused' }) + '\n');
  assert.equal((await manager.handle({ action: 'status', id: run.id })).status, 'paused');
  assert.equal(manager.isBusy(), true);
  assert.equal((await manager.handle({ action: 'resume', id: run.id })).status, 'resuming');
  child.stdout.emit('data', JSON.stringify({ event: 'control', status: 'running' }) + '\n');
  assert.equal((await manager.handle({ action: 'status', id: run.id })).status, 'running');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(delivered, ['started']);
  assert.ok(commands.includes('pause\n')); assert.ok(commands.includes('resume\n'));
  await manager.handle({ action: 'stop', id: run.id }); child.emit('close', 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(delivered, ['started', 'ended']);
  await manager.handle({ action: 'report', id: run.id });
});

test('reset ends the task, waits for end notification, then removes only that task data', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackbox-reset-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let child, releaseEnd;
  const sent = [];
  const manager = createBlackboxManager({ root, notifierFactory: () => async event => {
    sent.push(event);
    if (event === 'ended') await new Promise(resolve => { releaseEnd = resolve; });
    return { status: 'sent' };
  }, spawnProcess: () => {
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.write = () => {}; child.stdin.end = data => { child.stopCommand = data; }; child.kill = () => child.emit('close', 1); return child;
  } });
  const other = await manager.handle({ action: 'create', config: { taskName: 'other' } });
  const run = await manager.handle({ action: 'create', config: { taskName: 'reset me' } });
  const directory = path.join(root, 'logs/speaker-blackbox', run.id);
  fs.writeFileSync(path.join(directory, 'recordings/case_001_001_full.wav'), wav());
  await manager.handle({ action: 'upload', id: run.id, assetId: 'wake', offset: 0, data: wav().toString('base64'), final: true });
  await manager.handle({ action: 'configure', id: run.id, config: {}, wakeAsset: 'wake', cases: [{ id: 'wake' }], templates: [{ kind: 'tone', frames: [Array(24).fill(0)] }] });
  await manager.handle({ action: 'start', id: run.id });
  const resetting = manager.handle({ action: 'reset', id: run.id });
  // Attach rejection now, so the expected pre-implementation failure is reported by the test.
  resetting.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(child.stopCommand, 'stop\n');
  assert.equal(fs.existsSync(directory), true);
  child.emit('close', 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, ['started', 'ended']);
  assert.equal(fs.existsSync(directory), true);
  releaseEnd();
  assert.equal((await resetting).reset, true);
  assert.equal(fs.existsSync(directory), false);
  assert.equal(manager.isBusy(), false);
  assert.deepEqual((await manager.handle({ action: 'history' })).runs.map(item => item.id), [other.id]);
  assert.equal((await manager.handle({ action: 'reset', id: run.id })).reset, true);
  await assert.rejects(manager.handle({ action: 'reset', id: '../escape' }));
});

test('reset clears a draft including recordings without touching other tasks', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackbox-reset-draft-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = createBlackboxManager({ root });
  const run = await manager.handle({ action: 'create', config: {} });
  const directory = path.join(root, 'logs/speaker-blackbox', run.id);
  fs.writeFileSync(path.join(directory, 'recordings/calibration_raw.wav'), wav());
  assert.equal((await manager.handle({ action: 'reset', id: run.id })).reset, true);
  assert.equal(fs.existsSync(directory), false);
  assert.equal((await manager.handle({ action: 'status', id: run.id })).status, 'missing');
});

test('reset still waits for the active worker after calibration immediately starts a test with the same ID', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackbox-reset-calibrated-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const children = [];
  const manager = createBlackboxManager({ root, spawnProcess: () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.write = () => {}; child.stdin.end = () => {}; child.kill = () => child.emit('close', 1); children.push(child); return child;
  } });
  const run = await manager.handle({ action: 'create', config: {} });
  await manager.handle({ action: 'upload', id: run.id, assetId: 'wake', offset: 0, data: wav().toString('base64'), final: true });
  await manager.handle({ action: 'configure', id: run.id, config: {}, wakeAsset: 'wake', cases: [{ id: 'wake' }], templates: [{ kind: 'tone', frames: [Array(24).fill(0)] }] });
  await manager.handle({ action: 'calibrate', id: run.id });
  children[0].stdout.emit('data', JSON.stringify({ event: 'done', status: 'completed' }) + '\n');
  children[0].emit('close', 0);
  await manager.handle({ action: 'start', id: run.id });
  await new Promise(resolve => setImmediate(resolve));
  const resetting = manager.handle({ action: 'reset', id: run.id }); resetting.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  children[1].emit('close', 0);
  assert.equal((await resetting).reset, true);
});

test('failed process spawn does not leave a finalizer that prevents reset', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackbox-reset-spawn-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = createBlackboxManager({ root, resetTimeoutMs: 20, spawnProcess: () => { throw new Error('spawn failed'); } });
  const run = await manager.handle({ action: 'create', config: {} });
  await manager.handle({ action: 'upload', id: run.id, assetId: 'wake', offset: 0, data: wav().toString('base64'), final: true });
  await manager.handle({ action: 'configure', id: run.id, config: {}, wakeAsset: 'wake', cases: [], templates: [] });
  await assert.rejects(manager.handle({ action: 'calibrate', id: run.id }), /spawn failed/);
  assert.equal((await manager.handle({ action: 'reset', id: run.id })).reset, true);
  assert.equal(manager.isBusy(), false);
});
