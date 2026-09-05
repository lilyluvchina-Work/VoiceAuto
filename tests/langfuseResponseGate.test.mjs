import assert from 'node:assert/strict';
import {
  resolveResponseCompleteCandidate,
  waitForLangfuseResponseComplete,
} from '../src/utils/langfuseResponseGate.js';

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

test('accepts only response_complete observations with non-empty response text', () => {
  const emptyCandidate = resolveResponseCompleteCandidate({
    observations: [
      {
        id: 'obs-empty',
        name: '[response_complete]',
        output: { content: '' },
        traceId: 'trace-1',
      },
    ],
    traces: [{ id: 'trace-1', input: { content: '播放天气' } }],
    testCase: { audio: { text: '播放天气' } },
  });

  assert.equal(emptyCandidate, null);

  const candidate = resolveResponseCompleteCandidate({
    observations: [
      {
        id: 'obs-ok',
        name: '[response_complete]',
        output: { content: '今天北京晴，适合出行。' },
        traceId: 'trace-2',
      },
    ],
    traces: [{ id: 'trace-2', input: { content: '播放天气' } }],
    testCase: { audio: { text: '播放天气' } },
  });

  assert.equal(candidate.success, true);
  assert.equal(candidate.responseText, '今天北京晴，适合出行。');
  assert.equal(candidate.matchedObservationId, 'obs-ok');
  assert.equal(candidate.matchedTraceId, 'trace-2');
});

test('polls Langfuse until response_complete with response text is available', async () => {
  let attempts = 0;
  const result = await waitForLangfuseResponseComplete({
    envKey: 'UAT',
    fromTimestamp: '2026-08-27T00:00:00.000Z',
    toTimestamp: () => '2026-08-27T00:00:10.000Z',
    testCase: { audio: { text: '打开空调' } },
    timeoutMs: 5000,
    intervalMs: 100,
    sleep: async () => {},
    now: () => attempts * 100,
    fetchTraces: async () => [
      { id: 'trace-1', input: { content: '打开空调' } },
    ],
    fetchObservations: async () => {
      attempts += 1;
      return attempts < 2
        ? []
        : [{
          id: 'obs-response',
          traceId: 'trace-1',
          name: 'agent [response_complete]',
          output: { message: { content: '空调已打开。' } },
        }];
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'response_complete');
  assert.equal(result.responseText, '空调已打开。');
  assert.equal(result.attempts, 2);
});
