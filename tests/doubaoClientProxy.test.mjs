import assert from 'node:assert/strict';
import { resolveDoubaoClientProxyPath } from '../src/services/ttsRouting.js';

assert.equal(
  resolveDoubaoClientProxyPath('https://openspeech.bytedance.com/api/v3/tts/unidirectional'),
  '/api/tts/doubao-v3'
);
assert.equal(resolveDoubaoClientProxyPath('/api/custom-doubao-v3'), '/api/custom-doubao-v3');
assert.equal(resolveDoubaoClientProxyPath(''), '/api/tts/doubao-v3');
