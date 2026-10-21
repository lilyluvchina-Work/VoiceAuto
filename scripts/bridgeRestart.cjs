/** Successor launcher. Only the bridge passes these fixed process parameters. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');

async function waitForExit(pid, { alive = value => {
  try { process.kill(value, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 100 } = {}) {
  for (let n = 0; n < attempts; n++) { if (!alive(pid)) return; await sleep(100); }
  throw new Error('旧桥接未能退出，未启动重复进程');
}
async function launch(options) {
  if (!Number.isSafeInteger(options.parentPid) || options.parentPid < 1 || !fs.existsSync(options.scriptPath)) throw new Error('无效重启参数');
  if (process.send) await new Promise((resolve, reject) => process.send({ ready: true }, error => error ? reject(error) : resolve()));
  if (process.connected) process.disconnect();
  await waitForExit(options.parentPid);
  const output = fs.openSync(options.outputLog, 'a'), errors = fs.openSync(options.errorLog, 'a');
  try {
    const child = spawn(options.nodePath, [options.scriptPath, ...(options.args || [])], {
      cwd: options.cwd, env: process.env, detached: true, windowsHide: true, stdio: ['ignore', output, errors],
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { fs.closeSync(output); fs.closeSync(errors); }
}
if (require.main === module) launch(JSON.parse(process.argv[2])).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { waitForExit };
