import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

assert.match(
  source,
  /<p className="text-xs text-gray-400">语音自动化测试平台\s*·\s*版本号：\{APP_VERSION\}<\/p>/
);
