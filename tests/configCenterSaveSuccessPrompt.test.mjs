import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/ConfigCenter.jsx', import.meta.url), 'utf8');

assert.match(source, /保存成功，配置已写入数据库/);
assert.match(source, /role="status"/);
assert.match(source, /type === 'success'/);
assert.match(source, /border-red-800/);
assert.match(source, /已创建账号/);
assert.match(source, /测试信息统计/);
assert.match(source, /开始测试/);
assert.match(source, /结束测试/);
assert.match(source, /测试时长/);
assert.match(source, /测试人/);
assert.match(source, /currentUser\?\.role === 'admin'/);
assert.match(source, /const canManage = isAdminUser/);
