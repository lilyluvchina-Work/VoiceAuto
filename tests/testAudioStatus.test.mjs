import assert from 'node:assert/strict';
import { isGeneratedTestAudio } from '../src/utils/testAudioStatus.js';

assert.equal(isGeneratedTestAudio({ audioStatus: 'generated' }), true);
assert.equal(isGeneratedTestAudio({ audioStatus: 'not_generated' }), false);
assert.equal(isGeneratedTestAudio({}), false);
assert.equal(isGeneratedTestAudio(null), false);
