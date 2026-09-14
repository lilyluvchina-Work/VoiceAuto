import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDeviceExecutionQueue } from '../src/utils/deviceExecutionQueue.js';
const source = readFileSync(new URL('../src/stores/testStore.jsx', import.meta.url), 'utf8');
assert.doesNotMatch(source, /Math\.min\(99,/, 'The stored loop count must support 1000');
const { normalizeLoopCount } = await import('../src/utils/loopCount.js');
for (const [value, expected] of [[1,1],[1000,1000],['237',237],[1001,1000],[0,1],[-4,1],['',1],['bad',1],[Infinity,1],[3.9,3]]) {
  assert.equal(normalizeLoopCount(value), expected);
}
const reducerSource = source.slice(source.indexOf('function testReducer('), source.indexOf('// Context'));
const reducer = new Function('ActionTypes', 'normalizeLoopCount', `${reducerSource}; return testReducer;`)(new Proxy({}, { get: (_, key) => key }), normalizeLoopCount);
assert.equal(reducer({ testOptions: {} }, { type: 'SET_LOOP_COUNT', payload: 1000 }).testOptions.loopCount, 1000);
for (const [device, continuous] of [['speaker',false],['speaker',true],['ai_toy',false]]) {
  const queue = buildDeviceExecutionQueue([{id:'audio',text:'测试'}],1000,device,{speakerContinuousDialogue:continuous});
  assert.equal(queue.length,1000);
}
console.log('loopCount tests passed');
