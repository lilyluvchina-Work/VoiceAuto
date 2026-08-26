import assert from 'node:assert/strict';

import {
  buildContinueDecision,
  buildMultiTurnQueue,
  summarizeMultiTurnCases,
} from '../src/utils/multiTurnDialogue.js';

const audios = Array.from({ length: 10 }, (_, index) => ({
  id: `turn-${index + 1}`,
  text: `第 ${index + 1} 轮输入`,
  audioStatus: 'generated',
  multiTurnCaseId: 'case-dialogue-1',
  multiTurnTitle: '连续订票对话',
  turnIndex: index + 1,
  turnTotal: 10,
  maxTurns: 10,
}));

const queue = buildMultiTurnQueue(audios, 1);

assert.equal(queue.length, 10);
assert.equal(queue[0].needWakeup, true);
assert.equal(queue[1].needWakeup, false);
assert.equal(queue[9].turnIndex, 10);
assert.equal(queue[9].turnTotal, 10);
assert.equal(queue[9].dialogueTurnKey, 'case-dialogue-1#10');

const firstDecision = buildContinueDecision(queue[0]);
assert.equal(firstDecision.should_continue, true);
assert.equal(firstDecision.need_wakeup, false);
assert.equal(firstDecision.dialogue_status, 'fixed_case_next_turn');
assert.match(firstDecision.reason, /还有下一轮/);

const lastDecision = buildContinueDecision(queue[9]);
assert.equal(lastDecision.should_continue, false);
assert.equal(lastDecision.need_wakeup, false);
assert.equal(lastDecision.dialogue_status, 'completed');

const singleTurnQueue = buildMultiTurnQueue([
  { id: 'single-1', text: '打开空调', audioStatus: 'generated' },
], 2);

assert.equal(singleTurnQueue.length, 2);
assert.equal(singleTurnQueue[0].multiTurnCaseId, 'single-1');
assert.equal(singleTurnQueue[0].turnIndex, 1);
assert.equal(singleTurnQueue[0].needWakeup, true);
assert.equal(singleTurnQueue[1].round, 2);

const summary = summarizeMultiTurnCases([
  { multiTurnCaseId: 'case-dialogue-1', turnIndex: 1, turnTotal: 2, success: true },
  { multiTurnCaseId: 'case-dialogue-1', turnIndex: 2, turnTotal: 2, success: true },
  { multiTurnCaseId: 'case-dialogue-2', turnIndex: 1, turnTotal: 2, success: false },
]);

assert.equal(summary.dialogueCount, 2);
assert.equal(summary.turnCount, 3);
assert.equal(summary.completedDialogueCount, 1);
assert.equal(summary.completionRate, '50.0%');
assert.equal(summary.averageTurns, 1.5);
