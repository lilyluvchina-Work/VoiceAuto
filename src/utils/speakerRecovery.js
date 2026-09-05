import { buildRetryQueueItem } from './multiTurnDialogue.js';

export function planSpeakerRecovery(item, result = {}) {
  if (result.success === true && result.status === 'playback_done') return null;
  const reason = result.message || '未确认 Speaker 播报结束';
  if (Number(item.retryCount || 0) >= 3) {
    throw new Error(`Speaker 当前用例恢复达到上限，已停止测试：${reason}`);
  }
  return { ...buildRetryQueueItem(item, { failureEvent: 'SPEAKER_PLAYBACK_END_MISSING', failureLog: reason }),
    forceWakeDetection: true };
}
