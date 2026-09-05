const { StringDecoder } = require('node:string_decoder');
const BOOT_START = /Rebooting\.|ESP-ROM:|rst:\s*0x[0-9a-f]+|Guru Meditation|task_wdt/i;
const BOOT_READY = /Application:.*New State:\s*idle\b/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rebootAndObserve({ open, close, timeoutMs = 35000, pulseMs = 120, pollMs = 200,
  command = 'reboot\n', log = () => {} }) {
  const deadline = Date.now() + timeoutMs;
  let port, recoveredDeviceId = '', disconnected = false;
  let bootSeen = false, bootMatchedLine = '', triggered = false, rebootCommandOk = false;
  let lastError = '', buffered = '', decoder;
  const sampleLines = [];
  const invoke = operation => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('重启操作超时')), Math.max(1, deadline - Date.now()));
    operation(error => { clearTimeout(timer); error ? reject(error) : resolve(); });
  });
  const attach = async () => {
    ({ port, serialPort: recoveredDeviceId } = await open());
    disconnected = false; buffered = ''; decoder = new StringDecoder('utf8');
    port.on('data', chunk => {
      buffered += decoder.write(chunk);
      const lines = buffered.split(/\r?\n/); buffered = (lines.pop() || '').slice(-65536);
      for (const line of lines) {
        sampleLines.push(line); if (sampleLines.length > 30) sampleLines.shift();
        if (!triggered) continue;
        if (BOOT_START.test(line)) { bootSeen = true; bootMatchedLine = ''; }
        if (bootSeen && BOOT_READY.test(line)) bootMatchedLine = line;
        log('serial.reboot.log', { line, bootSeen, bootCompleted: Boolean(bootMatchedLine) });
      }
    });
    port.on('close', () => { disconnected = true; });
    port.on('error', error => { lastError = error.message; disconnected = true; });
  };
  try {
    await attach(); // Subscribe before reset, including logs emitted during the control-line pulse.
    triggered = true;
    try {
      await invoke(cb => port.set({ dtr: false, rts: true }, cb));
      await sleep(pulseMs);
      await invoke(cb => port.set({ dtr: true, rts: false }, cb));
      rebootCommandOk = true;
      await sleep(pulseMs);
      if (!disconnected) await invoke(cb => port.set({ dtr: false, rts: false }, cb));
    } catch (error) {
      lastError = error.message;
      // A USB disconnect during the reset pulse is expected; never send a second reset then.
      if (disconnected) rebootCommandOk = true;
      else if (!rebootCommandOk && Date.now() < deadline) {
        log('serial.reboot.command.fallback', { reason: lastError });
        await invoke(cb => port.write(command, cb));
        await invoke(cb => port.drain(cb));
        rebootCommandOk = true;
      }
    }
    while (Date.now() < deadline) {
      if (bootMatchedLine && !disconnected) return { success: true, bootCompleted: true,
        rebootCommandOk, recoveredDeviceId, bootMatchedLine, sampleLines,
        message: '已监听到设备启动日志及 Application idle，启动完成' };
      if (disconnected) {
        await close(port); port = undefined;
        try { await attach(); } catch (error) { lastError = error.message; disconnected = true; }
      }
      await sleep(pollMs);
    }
    return { success: false, bootCompleted: false, rebootCommandOk, recoveredDeviceId,
      sampleLines, message: '等待 AI玩具启动完成日志超时', rebootCommandError: lastError };
  } catch (error) {
    return { success: false, bootCompleted: false, rebootCommandOk, recoveredDeviceId,
      sampleLines, message: error.message, rebootCommandError: error.message };
  } finally {
    if (port) await close(port);
  }
}
module.exports = { rebootAndObserve, BOOT_START, BOOT_READY };
