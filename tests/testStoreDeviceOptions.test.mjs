import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/stores/testStore.jsx', import.meta.url), 'utf8');

assert.match(source, /testOptions:\s*\{[\s\S]*device:\s*\{/);
assert.match(source, /SET_DEVICE_OPTIONS/);
assert.match(source, /setDeviceOptions/);
assert.match(source, /AI_TOY|ai_toy/);
assert.match(source, /serialPort/);
assert.match(source, /baudrate/);
assert.match(source, /langfuseResponseGateEnabled:\s*false/);
assert.doesNotMatch(source, /langfuseResponseGateEnabled:\s*parsed\.testOptions\?\.autonomousResponse\?\.langfuseResponseGateEnabled !== false/);
