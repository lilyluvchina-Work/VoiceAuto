const DEFAULT_BRIDGE = 'http://127.0.0.1:17321';
export async function restartBridge(bridgeUrl, { signal, onStatus, fetchImpl = globalThis.fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeoutMs = 20000 } = {}) {
  const base = (bridgeUrl || DEFAULT_BRIDGE).replace(/\/+$/, '');
  async function post(action) {
    if (signal?.aborted) throw new Error('桥接重启等待已取消');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, action === 'restart' ? 15000 : 2500);
    try {
      const response = await fetchImpl(`${base}/api/bridge/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        if (response.status === 404) throw new Error('当前版本不支持页面重启，请先在连接设备的电脑更新桥接并运行 npm run adb:bridge');
        throw new Error(data.message || '桥接操作失败');
      }
      return data;
    } catch (error) {
      if (error instanceof TypeError) throw Object.assign(new Error('无法连接本机桥接；若服务已停止，请先在连接设备的电脑运行 npm run adb:bridge'), { transient: true });
      if (error.name === 'AbortError' && !signal?.aborted) error.transient = true;
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  const before = await post('status');
  if (!before.instanceId) throw new Error('请先更新本机桥接再使用页面重启');
  onStatus?.('正在重启桥接…');
  try { await post('restart'); }
  catch (error) { if (!error.transient || signal?.aborted) throw error; onStatus?.('正在等待桥接重新连接…'); }
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (signal?.aborted) throw new Error('桥接重启等待已取消');
    try {
      const next = await post('status');
      if (next.instanceId && next.instanceId !== before.instanceId && !next.restarting) return next;
    } catch { if (signal?.aborted) throw new Error('桥接重启等待已取消'); }
    await sleep(400);
  }
  throw new Error('等待桥接重新连接超时，请检查本机桥接日志或手动运行 npm run adb:bridge');
}
