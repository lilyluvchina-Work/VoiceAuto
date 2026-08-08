import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ConfigCenter.jsx', import.meta.url), 'utf8');

assert.match(source, /保存成功，配置已写入数据库/);
assert.match(source, /role="status"/);
assert.match(source, /type === 'success'/);
assert.match(source, /border-red-800/);
