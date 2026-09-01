import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/adbBridge.cjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

assert.match(source, /LOG_SOURCE_SERIAL/);
assert.match(source, /loadSerialPort/);
assert.match(source, /listSerialPorts/);
assert.match(source, /detectFromSerial/);
assert.match(source, /VOICE WAKE WORD HIT ACCEPTED/);
assert.match(source, /Cedar: Input Text/);
assert.match(source, /Audio latency first_downlink_audio/);
assert.match(source, /TTS playback done/);
assert.match(source, /WS response timeout/);
assert.equal(pkg.dependencies.serialport, '^12.0.0');
