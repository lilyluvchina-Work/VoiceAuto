import assert from 'node:assert/strict';

import { DEVICE_TYPES } from '../src/config/deviceProfiles.js';
import { buildDeviceExecutionQueue } from '../src/utils/deviceExecutionQueue.js';

const audios = [
  {
    id: 'turn-2',
    text: '第二轮',
    multiTurnCaseId: 'dialogue-1',
    turnIndex: 2,
  },
  {
    id: 'turn-1',
    text: '第一轮',
    multiTurnCaseId: 'dialogue-1',
    turnIndex: 1,
  },
];

const speakerQueue = buildDeviceExecutionQueue(audios, 1, DEVICE_TYPES.SPEAKER);
assert.equal(speakerQueue.length, 2);
assert.equal(speakerQueue[0].audio.id, 'turn-2');
assert.equal(speakerQueue[1].audio.id, 'turn-1');
assert.equal(speakerQueue[0].needWakeup, true);
assert.equal(speakerQueue[1].needWakeup, true);
assert.equal(speakerQueue[0].turnIndex, 1);
assert.equal(speakerQueue[1].turnIndex, 1);
assert.equal(speakerQueue[0].turnTotal, 1);
assert.equal(speakerQueue[1].turnTotal, 1);
assert.equal(speakerQueue[0].multiTurnCaseId, '');
assert.equal(speakerQueue[1].dialogueStatus, 'single_turn');

const continuousSpeakerQueue = buildDeviceExecutionQueue(audios, 1, DEVICE_TYPES.SPEAKER, {
  speakerContinuousDialogue: true,
});
assert.equal(continuousSpeakerQueue.length, 2);
assert.equal(continuousSpeakerQueue[0].audio.id, 'turn-1');
assert.equal(continuousSpeakerQueue[1].audio.id, 'turn-2');
assert.equal(continuousSpeakerQueue[0].needWakeup, true);
assert.equal(continuousSpeakerQueue[1].needWakeup, false);
assert.equal(continuousSpeakerQueue[1].turnIndex, 2);

const explicitRewakeAudios = [
  {
    id: 'speaker-explicit-1',
    text: '第一轮',
    multiTurnCaseId: 'speaker-dialogue',
    turnIndex: 1,
  },
  {
    id: 'speaker-explicit-2',
    text: '第二轮',
    multiTurnCaseId: 'speaker-dialogue',
    turnIndex: 2,
    requiresWakeup: true,
  },
];
const continuousSpeakerNoRewakeQueue = buildDeviceExecutionQueue(explicitRewakeAudios, 1, DEVICE_TYPES.SPEAKER, {
  speakerContinuousDialogue: true,
});
assert.equal(continuousSpeakerNoRewakeQueue[0].needWakeup, true);
assert.equal(continuousSpeakerNoRewakeQueue[1].needWakeup, false);
assert.equal(continuousSpeakerNoRewakeQueue[0].nextRequiresWakeup, false);

const aiToyQueue = buildDeviceExecutionQueue(audios, 1, DEVICE_TYPES.AI_TOY);
assert.equal(aiToyQueue.length, 2);
assert.equal(aiToyQueue[0].audio.id, 'turn-1');
assert.equal(aiToyQueue[1].audio.id, 'turn-2');
assert.equal(aiToyQueue[0].needWakeup, true);
assert.equal(aiToyQueue[1].needWakeup, false);
assert.equal(aiToyQueue[1].turnIndex, 2);

const aiToyAcrossCases = buildDeviceExecutionQueue([
  { id: 'one', text: '独立问题一' },
  { id: 'two', text: '独立问题二', requiresWakeup: true },
], 2, DEVICE_TYPES.AI_TOY);
assert.deepEqual(aiToyAcrossCases.map(item => item.needWakeup), [true, false, false, false]);
