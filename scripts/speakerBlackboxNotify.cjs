const { createHmac } = require('node:crypto');

// Credentials stay only in this closure; neither run metadata nor errors retain them.
function createRunNotifier(config = {}, run = {}, { fetchImpl = fetch } = {}) {
  const delivered = new Set();
  return async function notify(event, current = run) {
    if (delivered.has(event)) return { status: 'duplicate' };
    delivered.add(event);
    if (!config.enabled) return { status: 'skipped', message: '钉钉机器人未启用' };
    try {
      const url = new URL(config.webhook || 'https://oapi.dingtalk.com/robot/send');
      if (url.protocol !== 'https:' || url.hostname !== 'oapi.dingtalk.com' || url.port
        || url.pathname !== '/robot/send' || url.username || url.password) throw new Error();
      const token = config.accessToken || url.searchParams.get('access_token');
      if (!token) return { status: 'skipped', message: '未配置钉钉机器人' };
      url.search = '';
      url.searchParams.set('access_token', token);
      if (config.secret) {
        const timestamp = String(Date.now());
        url.searchParams.set('timestamp', timestamp);
        url.searchParams.set('sign', createHmac('sha256', config.secret).update(`${timestamp}\n${config.secret}`).digest('base64'));
      }
      const title = `【VoiceAuto】音箱黑盒测试${event === 'started' ? '开始' : '结束'}`;
      const text = [`## ${title}`, `- 任务：${run.config?.taskName || '音箱黑盒测试'}`,
        `- 设备：${run.config?.deviceName || run.config?.deviceType || '/'}`, `- 批次：${run.id || '/'}`,
        `- 状态：${event === 'started' ? '开始测试' : ({ completed: '正常结束', aborted: '已停止', error: '异常结束', interrupted: '中断' }[current.status] || current.status)}`,
        `- 时间：${new Date().toISOString()}`].join('\n');
      const response = await fetchImpl(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text } }),
        signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (result.errcode && result.errcode !== 0) throw new Error();
      return { status: 'sent' };
    } catch {
      return { status: 'failed', message: '钉钉通知发送失败，请检查机器人配置及本机网络' };
    }
  };
}
module.exports = { createRunNotifier };
