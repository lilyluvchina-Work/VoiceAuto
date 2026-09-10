import assert from 'node:assert/strict';
import * as usage from '../src/utils/toolUsageStore.js';

assert.equal(typeof usage.filterToolUsageByUserName, 'function');
const records = [
  { userName: '张三', loginAccount: 'zhang', durationMs: 60000, endTime: 30 },
  { userName: '李四', loginAccount: 'li', durationMs: 120000, endTime: 20 },
  { userName: '张三', loginAccount: 'zhang', durationMs: 30000, endTime: 10 },
  { userName: 'Alice Chen', loginAccount: 'alice', durationMs: 45000, endTime: 5 },
];
const snapshot = structuredClone(records);
const filtered = usage.filterToolUsageByUserName(records, ' 张 ');
assert.equal(filtered.length, 2);
const summary = usage.summarizeToolUsageByUser(filtered);
assert.equal(summary[0].runCount, 2);
assert.equal(summary[0].totalDurationText, '1分30秒');
assert.equal(usage.filterToolUsageByUserName(records, ' ALICE ').length, 1);
assert.equal(usage.filterToolUsageByUserName(records, '不存在').length, 0);
assert.deepEqual(usage.filterToolUsageByUserName(records, '  '), records);
assert.deepEqual(usage.filterToolUsageByUserName([], '张'), []);
assert.deepEqual(records, snapshot);
const olderUser = [...Array.from({ length: 15 }, () => records[1]), records[0]];
assert.equal(usage.filterToolUsageByUserName(olderUser, '张').slice(0, 12).length, 1);
console.log('toolUsageSearch tests passed');
