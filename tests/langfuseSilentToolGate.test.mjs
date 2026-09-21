import assert from 'node:assert/strict';
import { waitForLangfuseResponseComplete } from '../src/utils/langfuseResponseGate.js';

async function run({ expectsVoiceResponse = false, observations = [], traces, aborted = false } = {}) {
  let time = 0;
  return waitForLangfuseResponseComplete({
    expectsVoiceResponse, testCase: { audio: { text: '创建场景', humanIndex: 1 } },
    fetchTraces: async () => traces || [{ id: 'current', input: { content: '创建场景' } }],
    fetchObservations: async () => observations,
    timeoutMs: 20, intervalMs: 10, now: () => time, sleep: async ms => { time += ms; },
    signal: { aborted },
  });
}
const tool = { id: 'tool-1', traceId: 'current', name: '[output_tool]', output: { name: 'create_scene' } };
const success = await run({ observations: [tool] });
assert.equal(success.success, true);
assert.equal(success.status, 'tool_called_no_voice_expected');
assert.equal(success.responseText, '');
assert.equal(success.matchedTraceId, 'current');
assert.equal((await run()).success, false);
assert.equal((await run({ observations: [tool], expectsVoiceResponse: true })).success, false);
assert.equal((await run({ observations: [{ ...tool, traceId: 'other' }] })).success, false);
assert.equal((await run({ observations: [tool], traces: [{ id: 'current', input: '另一条用例1' }] })).success, false);
assert.equal((await run({ observations: [{ ...tool, level: 'ERROR' }] })).success, false);
assert.equal((await run({ observations: [{ ...tool, output: null }] })).success, false);
assert.equal((await run({ observations: [{ ...tool, output: null, input: { tool: 'create_scene' } }] })).success, true);
assert.equal((await run({ observations: [tool], aborted: true })).status, 'aborted');
