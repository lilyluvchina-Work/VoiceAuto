const { StringDecoder } = require('node:string_decoder');
const BOOT_START = /Rebooting\.|ESP-ROM:|rst:\s*0x[0-9a-f]+|USB_UART_CHIP_RESET|Guru Meditation|task_wdt/i;
const BOOT_READY = /Application:.*New State:\s*idle\b/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rebootAndObserve({ open, close, timeoutMs = 35000, pulseMs = 200, pollMs = 200,
  log = () => {} }) {
  const deadline = Date.now() + timeoutMs;
  let port, recoveredDeviceId = '', disconnected = false;
  let bootSeen = false, bootMatchedLine = '', triggered = false, rebootCommandOk = false;
  let lastError = '', buffered = '', decoder;
  const sampleLines = [];
  const rawChunks = [];
  const invoke = operation => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('重启操作超时')), Math.max(1, deadline - Date.now()));
    operation(error => { clearTimeout(timer); error ? reject(error) : resolve(); });
  });
  const attach = async () => {
    ({ port, serialPort: recoveredDeviceId } = await open());
    disconnected = false; buffered = ''; decoder = new StringDecoder('utf8');
    port.on('data', chunk => {
      rawChunks.push(Buffer.from(chunk));
      buffered += decoder.write(chunk);
      const lines = buffered.split(/\r?\n/); buffered = (lines.pop() || '').slice(-65536);
      for (const line of lines) {
        sampleLines.push(line); if (sampleLines.length > 30) sampleLines.shift();
        if (!triggered) continue;
        if (BOOT_START.test(line)) { bootSeen = /USB_UART_CHIP_RESET/i.test(line); bootMatchedLine = ''; }
        if (bootSeen && BOOT_READY.test(line)) bootMatchedLine = line;
        log('serial.reboot.log', { line, bootSeen, bootCompleted: Boolean(bootMatchedLine) });
      }
    });
    port.on('close', () => { disconnected = true; });
    port.on('error', error => { lastError = error.message; disconnected = true; });
  };
  try {
    await attach(); // Subscribe before reset, including logs emitted during the control-line pulse.
    await invoke(cb => port.set({ dtr: false, rts: false }, cb));
    triggered = true;
    try {
      await invoke(cb => port.set({ dtr: false, rts: true }, cb));
      await sleep(pulseMs);
      // On Windows SerialPort.set applies RTS first, then re-applies DTR.
      // Always supply both: omitted flags default to true in serialport.
      await invoke(cb => port.set({ dtr: false, rts: false }, cb));
      rebootCommandOk = true;
      await sleep(pulseMs);
    } catch (error) {
      lastError = error.message;
      // A USB disconnect during the reset pulse is expected; never send a second reset then.
      if (disconnected) rebootCommandOk = true;

    }
    while (Date.now() < deadline) {
      if (bootMatchedLine && !disconnected) return { success: true, serialConnected: true, bootCompleted: true,
        rebootCommandOk, recoveredDeviceId, bootMatchedLine, sampleLines, serialLog: Buffer.concat(rawChunks).toString('utf8'),
        message: '已确认 USB_UART_CHIP_RESET 及 Application idle，启动完成' };
      if (disconnected) {
        await close(port); port = undefined;
        try { await attach(); } catch (error) { lastError = error.message; disconnected = true; }
      }
      await sleep(pollMs);
    }
    return { success: false, serialConnected: Boolean(port && !disconnected), bootCompleted: false, rebootCommandOk, recoveredDeviceId,
      sampleLines, serialLog: Buffer.concat(rawChunks).toString('utf8'), message: '等待 AI玩具启动完成日志超时', rebootCommandError: lastError };
  } catch (error) {
    return { success: false, serialConnected: Boolean(port && !disconnected), bootCompleted: false, rebootCommandOk, recoveredDeviceId,
      sampleLines, serialLog: Buffer.concat(rawChunks).toString('utf8'), message: error.message, rebootCommandError: error.message };
  } finally {
    if (port) await close(port);
  }
}
module.exports = { rebootAndObserve, BOOT_START, BOOT_READY };
