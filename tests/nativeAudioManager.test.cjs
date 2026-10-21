const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNativeAudioManager } = require('../scripts/nativeAudio.cjs');
const children = [];
function spawnProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.write = input => {
    const command = JSON.parse(input);
    child.command = command;
    queueMicrotask(() => {
      if (command.action === 'devices') {
        child.stdout.emit('data', Buffer.from(JSON.stringify({event:'devices',devices:[{deviceId:'native:test'}]})+'\n'));
        child.emit('close', 0);
      } else child.stdout.emit('data', Buffer.from('{"event":"ready"}\n'));
    });
  };
  child.kill = () => child.emit('close', 1);
  child.stdin.end = () => child.emit('close', 0);
  children.push(child); return child;
}
(async () => {
  const manager = createNativeAudioManager({ spawnProcess });
  assert.equal((await manager.handle({action:'devices'})).devices[0].deviceId, 'native:test');
  await assert.rejects(manager.handle({action:'start',options:{deviceId:'browser-id'}}), /选择/);
  const first = await manager.handle({action:'start',options:{deviceId:'native:test',outputPath:'untrusted'}});
  assert.notEqual(children.at(-1).command.outputPath, 'untrusted');
  await assert.rejects(manager.handle({action:'start',options:{deviceId:'native:test'}}), /正在采集/);
  await manager.handle({action:'cancel',sessionId:first.sessionId});
  assert.equal((await manager.handle({action:'status',sessionId:first.sessionId})).status, 'completed');
  const second = await manager.handle({action:'start',options:{deviceId:'native:test'}});
  await manager.handle({action:'cancel',sessionId:second.sessionId});
  await assert.rejects(manager.handle({action:'result',sessionId:'unknown'}), /失效/);
  console.log('Native audio device validation, exclusive capture and cancellation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
