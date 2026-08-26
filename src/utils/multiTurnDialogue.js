const DEFAULT_MAX_TURNS = 10;

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function resolveDialogueId(audio, fallbackId) {
  return normalizeText(
    audio?.multiTurnCaseId
    || audio?.dialogueId
    || audio?.conversationId
    || audio?.caseId
    || audio?.tapdCaseId
    || audio?.id,
    fallbackId
  );
}

function resolveTurnIndex(audio, fallbackIndex) {
  return numberOrDefault(audio?.turnIndex || audio?.humanIndex || audio?.turn || audio?.roundIndex, fallbackIndex);
}

function compareTurns(left, right) {
  if (left.turnIndex !== right.turnIndex) return left.turnIndex - right.turnIndex;
  return left.sourceIndex - right.sourceIndex;
}

function createQueueItem({
  audio,
  listIndex,
  loopRound,
  loopTotal,
  turnIndex,
  turnTotal,
  dialogueIndex,
  dialogueTotal,
  maxTurns,
}) {
  const multiTurnCaseId = resolveDialogueId(audio, audio?.id || `dialogue_${listIndex + 1}`);
  const multiTurnTitle = normalizeText(
    audio?.multiTurnTitle || audio?.dialogueTitle || audio?.caseTitle || audio?.text,
    multiTurnCaseId
  );
  const explicitWakeup = audio?.requiresWakeup;
  const needWakeup = explicitWakeup == null ? turnIndex === 1 : Boolean(explicitWakeup);

  return {
    audio,
    listIndex,
    round: loopRound,
    totalRounds: loopTotal,
    multiTurnCaseId,
    multiTurnTitle,
    turnIndex,
    turnTotal,
    maxTurns,
    dialogueIndex,
    dialogueTotal,
    dialogueTurnKey: `${multiTurnCaseId}#${turnIndex}`,
    needWakeup,
  };
}

export function buildContinueDecision(queueItem = {}) {
  const shouldContinue = Number(queueItem.turnIndex) < Number(queueItem.turnTotal);
  const nextNeedsWakeup = Boolean(queueItem.nextRequiresWakeup);
  if (shouldContinue) {
    return {
      should_continue: true,
      need_wakeup: nextNeedsWakeup,
      dialogue_status: nextNeedsWakeup ? 'need_rewake' : 'fixed_case_next_turn',
      reason: nextNeedsWakeup
        ? '固定多轮用例还有下一轮，下一轮配置为需要重新唤醒'
        : '固定多轮用例还有下一轮，继续执行且无需重复唤醒',
    };
  }

  return {
    should_continue: false,
    need_wakeup: false,
    dialogue_status: 'completed',
    reason: '固定多轮用例已执行到最后一轮，结束对话',
  };
}

export function buildMultiTurnQueue(audios = [], loopCount = 1) {
  const loops = Math.max(1, Number(loopCount) || 1);
  const normalized = (audios || []).map((audio, sourceIndex) => {
    const multiTurnCaseId = resolveDialogueId(audio, audio?.id || `dialogue_${sourceIndex + 1}`);
    return {
      audio,
      sourceIndex,
      multiTurnCaseId,
      turnIndex: resolveTurnIndex(audio, sourceIndex + 1),
      maxTurns: numberOrDefault(audio?.maxTurns, DEFAULT_MAX_TURNS),
    };
  });

  const groups = [];
  const groupById = new Map();
  for (const item of normalized) {
    if (!groupById.has(item.multiTurnCaseId)) {
      const group = { id: item.multiTurnCaseId, items: [] };
      groupById.set(item.multiTurnCaseId, group);
      groups.push(group);
    }
    groupById.get(item.multiTurnCaseId).items.push(item);
  }

  const queue = [];
  for (let loopRound = 1; loopRound <= loops; loopRound += 1) {
    groups.forEach((group, dialogueIndex) => {
      const sorted = [...group.items].sort(compareTurns);
      const groupMaxTurns = Math.max(1, Math.min(
        DEFAULT_MAX_TURNS,
        ...sorted.map((item) => item.maxTurns)
      ));
      const capped = sorted.slice(0, groupMaxTurns);
      const declaredTurnTotal = Math.max(
        capped.length,
        ...capped.map((item) => numberOrDefault(item.audio?.turnTotal || item.audio?.totalTurns, capped.length))
      );
      const turnTotal = Math.min(DEFAULT_MAX_TURNS, declaredTurnTotal);

      capped.forEach((item, index) => {
        const turnIndex = numberOrDefault(item.audio?.turnIndex || item.audio?.humanIndex || item.audio?.turn, index + 1);
        const next = capped[index + 1]?.audio;
        queue.push(createQueueItem({
          audio: item.audio,
          listIndex: item.sourceIndex,
          loopRound,
          loopTotal: loops,
          turnIndex,
          turnTotal,
          dialogueIndex: dialogueIndex + 1,
          dialogueTotal: groups.length,
          maxTurns: groupMaxTurns,
        }));
        queue[queue.length - 1].nextRequiresWakeup = Boolean(next?.requiresWakeup);
      });
    });
  }

  return queue;
}

function formatPercent(numerator, denominator) {
  if (!denominator) return '0.0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function summarizeMultiTurnCases(cases = []) {
  const dialogueMap = new Map();
  for (const item of cases || []) {
    const id = resolveDialogueId(item, item?.caseId || `dialogue_${dialogueMap.size + 1}`);
    if (!dialogueMap.has(id)) {
      dialogueMap.set(id, {
        id,
        turnCount: 0,
        expectedTurns: numberOrDefault(item?.turnTotal, 1),
        failed: false,
      });
    }
    const dialogue = dialogueMap.get(id);
    dialogue.turnCount += 1;
    dialogue.expectedTurns = Math.max(dialogue.expectedTurns, numberOrDefault(item?.turnTotal, dialogue.expectedTurns));
    if (item?.success === false) dialogue.failed = true;
  }

  const dialogues = Array.from(dialogueMap.values());
  const turnCount = (cases || []).length;
  const completedDialogueCount = dialogues.filter((item) => !item.failed && item.turnCount >= item.expectedTurns).length;

  return {
    dialogueCount: dialogues.length,
    turnCount,
    completedDialogueCount,
    failedDialogueCount: Math.max(0, dialogues.length - completedDialogueCount),
    completionRate: formatPercent(completedDialogueCount, dialogues.length),
    averageTurns: dialogues.length ? Number((turnCount / dialogues.length).toFixed(1)) : 0,
    dialogues,
  };
}
