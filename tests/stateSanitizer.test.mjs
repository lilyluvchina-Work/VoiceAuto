import assert from 'node:assert/strict';
import { sanitizePersistedVoiceAutoState } from '../src/stores/stateSanitizer.js';

{
  const sanitized = sanitizePersistedVoiceAutoState({
    testAudios: { bad: 'shape' },
    testOptions: 'bad-options',
    defaultVoiceConfig: null,
  });

  assert.deepEqual(sanitized.testAudios, []);
  assert.deepEqual(sanitized.testOptions, {});
  assert.deepEqual(sanitized.defaultVoiceConfig, {});
}

{
  const audioRows = [{ id: 'a1', text: 'hello' }];
  const sanitized = sanitizePersistedVoiceAutoState({
    testAudios: audioRows,
    testOptions: { loopCount: 3 },
    defaultVoiceConfig: { voiceName: '晓晓' },
  });

  assert.equal(sanitized.testAudios, audioRows);
  assert.equal(sanitized.testOptions.loopCount, 3);
  assert.equal(sanitized.defaultVoiceConfig.voiceName, '晓晓');
}
