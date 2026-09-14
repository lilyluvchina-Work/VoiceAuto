const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Attach before opening the port so even startup bytes are captured unchanged.
function attachSerialLog(port, serialPort, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const name = String(serialPort).replace(/[^a-zA-Z0-9_-]/g, '_');
  port.serialLogPath = path.resolve(directory, `${name}-${Date.now()}-${randomUUID()}.log`);
  fs.writeFileSync(port.serialLogPath, Buffer.alloc(0), { flag: 'wx' });
  port.on('data', chunk => {
    try {
      fs.appendFileSync(port.serialLogPath, chunk);
    } catch (error) {
      port.serialLogError = `串口日志保存失败：${error.message}`;
    }
  });
  return port.serialLogPath;
}

module.exports = { attachSerialLog };
