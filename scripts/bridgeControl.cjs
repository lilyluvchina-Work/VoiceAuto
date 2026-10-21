const { randomUUID } = require('node:crypto');

function createBridgeControl({ instanceId = randomUUID(), busyReason = () => '',
  closeResources = async () => {}, spawnRestart = async () => {}, closeTimeoutMs = 5000 } = {}) {
  let restarting = false;
  let activeRequests = 0;
  function beginRequest() {
    activeRequests++;
    let completed = false;
    return () => { if (!completed) { completed = true; activeRequests--; } };
  }
  function status() { return { success: true, instanceId, restarting, capabilities: ['restart', 'native-audio', 'blackbox-audio'] }; }
  async function restart() {
    const reason = restarting ? '桥接正在重启，请稍候' : activeRequests ? '桥接正在处理请求，请等待完成后再重启' : busyReason();
    if (reason) throw Object.assign(new Error(reason), { statusCode: 409 });
    restarting = true;
    try {
      let timer;
      try {
        await Promise.race([closeResources(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('关闭桥接资源超时，已取消重启，请检查串口连接')), closeTimeoutMs);
        })]);
      } finally { clearTimeout(timer); }
      await spawnRestart();
      return { success: true, restarting: true, previousInstanceId: instanceId };
    } catch (error) { restarting = false; throw error; }
  }
  return { status, restart, beginRequest };
}
function exitAfterResponse(response, shutdown) {
  let exited = false;
  const finish = () => {
    if (exited) return;
    exited = true; response.off('finish', finish); response.off('close', finish); shutdown();
  };
  if (response.destroyed || response.writableFinished) finish();
  else { response.once('finish', finish); response.once('close', finish); }
}
module.exports = { createBridgeControl, exitAfterResponse };
