import assert from 'node:assert/strict';
import {
  shouldFallbackToWebSpeech,
  shouldUseDoubaoTts,
} from '../src/services/ttsRouting.js';

assert.equal(shouldUseDoubaoTts({ serviceProvider: 'webspeech', requestConfig: { provider: 'doubao-v3' } }), true);
assert.equal(shouldUseDoubaoTts({ serviceProvider: 'webspeech', requestConfig: { voiceType: 'en_female_skye_emo_v2_mars_bigtts' } }), true);
assert.equal(shouldUseDoubaoTts({ serviceProvider: 'doubao', requestConfig: {} }), true);
assert.equal(shouldUseDoubaoTts({ serviceProvider: 'webspeech', requestConfig: { voiceName: 'Microsoft Yaoyao' } }), false);

assert.equal(shouldFallbackToWebSpeech({ requestConfig: { provider: 'doubao-v3' } }), false);
assert.equal(shouldFallbackToWebSpeech({ requestConfig: { voiceType: 'zh_female_shuangkuaisisi_moon_bigtts' } }), false);
assert.equal(shouldFallbackToWebSpeech({ requestConfig: { voice: 'xiaoxiao' } }), true);
