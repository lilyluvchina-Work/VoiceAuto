import assert from 'node:assert/strict';
import { fetchPlanCases } from '../src/modules/tapd/services/tapdService.js';
import { tapdCaseToTestAudios } from '../src/modules/tapd/utils/tapdParser.js';
import { resolveTestCaseDirectory } from '../src/utils/testCaseOrdering.js';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = { location: { origin: 'http://localhost' } };
globalThis.fetch = async () => Response.json({ status: 1, data: [
  { TestPlanStoryTcaseRelation: { tcase_id: '101', open_to_categories: [{ name: '计划父目录' }, { name: '计划子目录' }], sort: 2 }, category_name: '错误的外层目录' },
  { TestPlanStoryTcaseRelation: { tcase_id: '102' }, story_name: { open_to_categories: '另一个计划目录' } },
  { TestPlanStoryTcaseRelation: { tcase_id: '103', category_name: '12345' } },
  { TestPlanStoryTcaseRelation: { tcase_id: '104', category_name: '播放', category_path: '语音测试 / 音乐 / 播放' } },
  { TestPlanStoryTcaseRelation: { tcase_id: '105', open_to_categories: { name: '播放', path: '计划 / 音乐 / 播放' } } },
  { TestPlanStoryTcaseRelation: { tcase_id: '106', category_name: '播放' }, story_name: { directory_path: '另一个计划 / 播放' } },
  { TestPlanStoryTcaseRelation: { tcase_id: '107', category_name: '播放', category_path: '100/200/300' } },
] });
try {
  const planCases = await fetchPlanCases('workspace', 'plan', 'user', 'password');
  assert.equal(planCases[0].planDirectoryTitle, '计划父目录 / 计划子目录');
  assert.equal(planCases[1].planDirectoryTitle, '另一个计划目录');
  assert.equal(planCases[2].planDirectoryTitle, '');
  assert.equal(planCases[3].planDirectoryTitle, '语音测试 / 音乐 / 播放');
  assert.equal(planCases[4].planDirectoryTitle, '计划 / 音乐 / 播放');
  assert.equal(planCases[5].planDirectoryTitle, '另一个计划 / 播放');
  assert.equal(planCases[6].planDirectoryTitle, '播放');
  const detail = { id: '101', targetText: '你好', categoryName: '用例库目录', tapdPlanDirectory: '用例库目录', categoryPath: '用例库 / 子目录' };
  const convert = (planCase) => tapdCaseToTestAudios(detail, { planCase, testPlanId: 'plan' }, {}, () => 'local-id')[0].audio;
  const audio = convert(planCases[0]);
  assert.equal(audio.tapdPlanDirectory, '计划父目录 / 计划子目录');
  assert.equal(audio.caseDirectory, '计划父目录 / 计划子目录');
  assert.equal(audio.module, '计划父目录 / 计划子目录');
  assert.equal(resolveTestCaseDirectory(audio), '计划父目录 / 计划子目录');
  assert.equal(audio.tapdCategoryName, '用例库目录');
  assert.equal(audio.caseSort, '2');
  assert.equal(convert(planCases[2]).caseDirectory, '用例库 / 子目录');
  assert.equal(convert(planCases[3]).caseDirectory, '语音测试 / 音乐 / 播放');
  // Never attach an unrelated library parent to a plan directory.
  assert.equal(convert(planCases[6]).caseDirectory, '播放');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
}
