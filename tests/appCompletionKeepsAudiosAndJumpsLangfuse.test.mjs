import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

assert.match(source, /setActiveMode\(MODES\.voice\)/);
assert.match(source, /setActiveMode\(MODES\.langfuse\)/);
assert.match(source, /测试音频会保留/);
assert.match(source, /2 \* 60 \* 1000/);
