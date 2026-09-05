import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Isolate configuration and browser storage; validate the actual message formatter without sending.
const source = readFileSync(new URL('../src/services/dingTalkService.js', import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from ['"][^'"]+['"];\s*/g, '')
  + '\nexport { buildMarkdownMessage };';
const stubs = `const SUMMARY_REPORT_STORAGE_KEY = 'test';
const ENVIRONMENT_INFO_FIELDS = []; const normalizeSubmissionParams = x => x;
const ENVIRONMENTS = {}; const CONFIG_TYPES = {}; const readSecureConfig = () => ({});`;
const { buildMarkdownMessage } = await import(`data:text/javascript;base64,${Buffer.from(stubs + source).toString('base64')}`);
for (const type of ['AI_TOY_WAKE_SUCCESS', 'AI_TOY_TURN_RESULT', 'AI_TOY_INTERRUPTED',
  'AI_TOY_REBOOT_STARTED', 'AI_TOY_REBOOT_SUCCESS', 'AI_TOY_REBOOT_FAILED']) {
  test(`${type} uses an AI toy event title and traceable details`, () => {
    const result = buildMarkdownMessage(type, { state: { testOptions: { device: { type: 'ai_toy' } } },
      runId: 'RUN-test', details: ['用例：case-1', '串口：COM3'] });
    assert.match(result.title, /AI玩具/);
    assert.match(result.text, /设备类型：AI玩具/);
    assert.match(result.text, /RUN-test/);
    assert.match(result.text, /用例：case-1/);
    assert.match(result.text, /串口：COM3/);
  });
}
test('shared lifecycle messages identify the selected device', () => {
  assert.match(buildMarkdownMessage('TEST_STARTED', { state: { testOptions: { device: { type: 'ai_toy' } } } }).text, /设备类型：AI玩具/);
  assert.match(buildMarkdownMessage('TEST_STARTED', {}).text, /设备类型：Speaker/);
});
