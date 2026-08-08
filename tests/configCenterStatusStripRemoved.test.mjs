import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ConfigCenter.jsx', import.meta.url), 'utf8');

assert.doesNotMatch(source, /ConfigStatusStrip/);
assert.doesNotMatch(source, /敏感字段默认脱敏展示/);
