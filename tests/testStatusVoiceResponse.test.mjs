import assert from 'node:assert/strict';
import { getTtsStatus } from '../src/utils/testStatus.js';

assert.equal(getTtsStatus({ expectsVoiceResponse: false }), 'skipped');
assert.equal(getTtsStatus({ responseChainPassed: 'skipped_no_voice_expected' }), 'skipped');
assert.equal(getTtsStatus({ responseChainPassed: true }), 'success');
assert.equal(getTtsStatus({ responseChainPassed: false }), 'failed');
