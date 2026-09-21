import assert from 'node:assert/strict';
import { fetchCaseDetails } from '../src/modules/tapd/services/tapdService.js';
import { tapdCaseToTestAudios } from '../src/modules/tapd/utils/tapdParser.js';
import { resolveTestCaseDirectory, sortTestCasesByDirectoryOrder } from '../src/utils/testCaseOrdering.js';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = { location: { origin: 'http://localhost' } };
globalThis.fetch = async (input) => {
  const url = new URL(input);
  if (url.pathname.endsWith('/tcase_categories')) {
    return Response.json({ status: 1, data: [
      { TcaseCategory: { id: '3', name: '场景创建', parent_id: '2' } },
      { TcaseCategory: { id: '1', name: '基本功能', parent_id: '0' } },
      { TcaseCategory: { id: '2', name: '智能场景', parent_id: '1' } },
      { TcaseCategory: { id: '4', name: '场景创建', parent_id: '0' } },
    ] });
  }
  assert.equal(url.pathname, '/tapd-api/tcases');
  return Response.json({ status: 1, data: [{ Tcase: {
    id: 'case-1', category_id: '3', name: '创建一个场景', steps: 'Human: 创建场景',
  } }] });
};
try {
  const [detail] = await fetchCaseDetails('workspace', ['case-1'], 'user', 'password', { customFieldInfo: {} });
  assert.equal(detail.categoryPath, '基本功能 / 智能场景 / 场景创建');
  const convert = (title) => tapdCaseToTestAudios(detail, {
    planCase: { planDirectoryTitle: title }, testPlanId: 'plan',
  }, {}, () => 'local-id')[0].audio;
  const audio = convert('场景创建');
  assert.equal(audio.caseDirectory, '基本功能 / 智能场景 / 场景创建');
  assert.equal(audio.tapdPlanDirectory, '基本功能 / 智能场景 / 场景创建');
  assert.equal(audio.module, '基本功能 / 智能场景 / 场景创建');
  // Already-imported records also display their known ancestors without reimporting.
  const oldAudio = { ...audio, tapdPlanDirectory: '场景创建', caseDirectory: '场景创建', module: '场景创建' };
  assert.equal(resolveTestCaseDirectory(oldAudio), '基本功能 / 智能场景 / 场景创建');
  assert.equal(sortTestCasesByDirectoryOrder([oldAudio], { directory: '基本功能 / 智能场景 / 场景创建' }).length, 1);
  // Explicit plan paths and different plan directory names keep their own ancestry.
  assert.equal(convert('专项计划 / 场景创建').caseDirectory, '专项计划 / 场景创建');
  assert.equal(convert('场景删除').caseDirectory, '场景删除');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
}
