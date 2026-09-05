import { DEVICE_TYPES } from '../config/deviceProfiles.js';
import { buildMultiTurnQueue } from './multiTurnDialogue.js';

function buildSingleTurnQueue(audios = [], loopCount = 1) {
  const loops = Math.max(1, Number(loopCount) || 1);
  const queue = [];
  const list = Array.isArray(audios) ? audios : [];

  for (let loopRound = 1; loopRound <= loops; loopRound += 1) {
    list.forEach((audio, listIndex) => {
      queue.push({
        audio,
        listIndex,
        round: loopRound,
        totalRounds: loops,
        multiTurnCaseId: '',
        multiTurnTitle: '',
        turnIndex: 1,
        turnTotal: 1,
        maxTurns: 1,
        dialogueIndex: listIndex + 1,
        dialogueTotal: list.length,
        dialogueTurnKey: audio?.id || `single_${listIndex + 1}`,
        dialogueStatus: 'single_turn',
        needWakeup: true,
      });
    });
  }

  return queue;
}

export function buildDeviceExecutionQueue(audios = [], loopCount = 1, deviceType = DEVICE_TYPES.SPEAKER, options = {}) {
  const speakerContinuousDialogue = Boolean(options.speakerContinuousDialogue);
  if (deviceType === DEVICE_TYPES.SPEAKER && speakerContinuousDialogue) {
    return buildMultiTurnQueue(audios, loopCount).map((item, index) => ({
      ...item,
      needWakeup: index === 0,
      nextRequiresWakeup: false,
    }));
  }

  if (deviceType === DEVICE_TYPES.AI_TOY) {
    return buildMultiTurnQueue(audios, loopCount).map((item, index) => ({
      ...item,
      needWakeup: index === 0,
      nextRequiresWakeup: false,
    }));
  }

  return buildSingleTurnQueue(audios, loopCount);
}
