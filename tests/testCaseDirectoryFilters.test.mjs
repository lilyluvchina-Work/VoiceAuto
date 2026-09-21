import assert from 'node:assert/strict';
import { getDirectoryFilterState } from '../src/utils/testCaseDirectories.js';
import { sortTestCasesByDirectoryOrder } from '../src/utils/testCaseOrdering.js';

const cases = [
  { id: 'create', caseDirectory: '基本功能/智能场景/场景创建' },
  { id: 'delete', caseDirectory: '基本功能 / 智能场景 / 场景删除' },
  { id: 'parent', caseDirectory: '基本功能/智能场景' },
  { id: 'music', caseDirectory: '基本功能/音乐/播放' },
  { id: 'other', caseDirectory: '专项测试/智能场景/场景创建' },
  { id: 'prefix', caseDirectory: '基本功能/智能场景扩展/创建' },
  { id: 'deep', caseDirectory: '基本功能/智能场景/场景创建/异常参数' },
];
const all = getDirectoryFilterState(cases, []);
assert.deepEqual(all.levels[0].map(o => [o.name, o.count]), [['基本功能', 6], ['专项测试', 1]]);
assert.deepEqual(all.levels[1], []);
assert.deepEqual(all.levels[2], []);
const second = getDirectoryFilterState(cases, ['基本功能', '智能场景']);
assert.deepEqual(second.selectedPath, ['基本功能', '智能场景']);
assert.deepEqual(second.levels[2].map(o => [o.name, o.count]), [['场景创建', 2], ['场景删除', 1]]);
assert.deepEqual(sortTestCasesByDirectoryOrder(cases, { directory: second.directory, includeDescendants: true }).map(c => c.id).sort(), ['create', 'deep', 'delete', 'parent']);
const third = getDirectoryFilterState(cases, ['基本功能', '智能场景', '场景创建']);
assert.deepEqual(sortTestCasesByDirectoryOrder(cases, { directory: third.directory, includeDescendants: true }).map(c => c.id).sort(), ['create', 'deep']);
assert.deepEqual(getDirectoryFilterState(cases, ['专项测试', '音乐', '播放']).selectedPath, ['专项测试']);
assert.deepEqual(getDirectoryFilterState([], third.selectedPath).selectedPath, []);
// Existing exact directory filtering stays exact unless descendants are requested.
assert.equal(sortTestCasesByDirectoryOrder(cases, { directory: '基本功能/智能场景' }).length, 1);
