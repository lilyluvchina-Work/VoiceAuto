# Multi-Turn Agent Evaluation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first staged VoiceAuto multi-turn dialogue execution and agent-evaluation loop without automatic deployment.

**Architecture:** Add pure utilities for dialogue normalization and evaluation plan/result calculation, then wire them into existing test options, runner recording, report UI, and exports. The current playback, ADB, ASR, response capture, Langfuse, and DingTalk paths remain intact.

**Tech Stack:** React 18, Vite, plain Node test scripts using `node:assert`, browser localStorage state, existing VoiceAuto store and report utilities.

**Spec:** `docs/superpowers/specs/2026-08-26-multi-turn-agent-eval-mvp-design.md`

## Global Constraints

- Do not automatically deploy.
- Existing single-turn cases must continue to work.
- Every selected evaluation run must resolve to exactly one plan.
- Plan priority is `planA_link_state` > `planB_semantic` > `builtin_rules`.
- Later turns in a multi-turn case skip wakeup by default.
- MVP semantic evaluation must not call a live model.

---

### Task 1: Multi-Turn Dialogue Utilities

**Files:**
- Create: `src/utils/multiTurnDialogue.js`
- Test: `tests/multiTurnDialogue.test.mjs`

**Interfaces:**
- Produces: `buildMultiTurnQueue(audios, loopCount)`, `buildContinueDecision(queueItem)`, `summarizeMultiTurnCases(cases)`
- Consumes: existing test audio objects with optional `multiTurnCaseId`, `multiTurnTitle`, `turnIndex`, `turnTotal`, `maxTurns`, `requiresWakeup`

- [ ] **Step 1: Write failing tests**

Create tests that assert:

```js
assert.equal(queue.length, 10);
assert.equal(queue[0].needWakeup, true);
assert.equal(queue[1].needWakeup, false);
assert.equal(queue[9].turnIndex, 10);
assert.equal(buildContinueDecision(queue[0]).should_continue, true);
assert.equal(buildContinueDecision(queue[9]).dialogue_status, 'completed');
```

- [ ] **Step 2: Run test to verify RED**

Run: `node tests/multiTurnDialogue.test.mjs`

Expected: fails because `src/utils/multiTurnDialogue.js` does not exist.

- [ ] **Step 3: Implement utility**

Implement grouping, turn ordering, max-turn cap, wakeup policy, continue decision, and summary calculation.

- [ ] **Step 4: Run test to verify GREEN**

Run: `node tests/multiTurnDialogue.test.mjs`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/multiTurnDialogue.js tests/multiTurnDialogue.test.mjs
git commit -m "Add multi-turn dialogue utilities"
```

### Task 2: Agent Evaluation Utilities

**Files:**
- Create: `src/utils/agentEvaluation.js`
- Test: `tests/agentEvaluation.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_AGENT_EVALUATION_METRICS`, `AGENT_EVALUATION_METRIC_GROUPS`, `normalizeSelectedEvaluationMetrics(metrics)`, `selectAgentEvaluationPlan(metrics)`, `evaluateAgentReport(cases, metrics)`
- Consumes: report cases from the existing `report.cases` shape plus new dialogue fields

- [ ] **Step 1: Write failing tests**

Create tests that assert:

```js
assert.equal(selectAgentEvaluationPlan(['intent']).planId, 'planB_semantic');
assert.equal(selectAgentEvaluationPlan(['intent', 'asr']).planId, 'planA_link_state');
assert.equal(selectAgentEvaluationPlan(['case_pass_rate']).planId, 'builtin_rules');
assert.match(evaluateAgentReport([{ success: true }], ['tts_play_complete']).missingMessages[0], /tts_play_complete/);
```

- [ ] **Step 2: Run test to verify RED**

Run: `node tests/agentEvaluation.test.mjs`

Expected: fails because `src/utils/agentEvaluation.js` does not exist.

- [ ] **Step 3: Implement utility**

Implement metric catalog, metric normalization, single-plan selection, built-in metrics, link-state metrics, missing instrumentation messages, semantic pending output, and report summary.

- [ ] **Step 4: Run test to verify GREEN**

Run: `node tests/agentEvaluation.test.mjs`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/agentEvaluation.js tests/agentEvaluation.test.mjs
git commit -m "Add agent evaluation utilities"
```

### Task 3: Store Evaluation Configuration

**Files:**
- Modify: `src/stores/testStore.jsx`
- Modify: `src/stores/stateSanitizer.js`
- Test: `tests/stateSanitizer.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_AGENT_EVALUATION_METRICS`, `normalizeSelectedEvaluationMetrics`
- Produces: `state.testOptions.agentEvaluation.selectedMetrics`, `actions.setAgentEvaluationMetrics(metrics)`

- [ ] **Step 1: Write failing tests**

Extend sanitizer tests to verify invalid/missing `agentEvaluation.selectedMetrics` normalize to defaults and valid selections persist.

- [ ] **Step 2: Run test to verify RED**

Run: `node tests/stateSanitizer.test.mjs`

Expected: fails because sanitizer does not normalize agent evaluation options.

- [ ] **Step 3: Implement store and sanitizer**

Add defaults, reducer action, action creator, restoration normalization, and persistence shape.

- [ ] **Step 4: Run test to verify GREEN**

Run: `node tests/stateSanitizer.test.mjs`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/testStore.jsx src/stores/stateSanitizer.js tests/stateSanitizer.test.mjs
git commit -m "Persist agent evaluation metric selection"
```

### Task 4: Runner Multi-Turn Recording

**Files:**
- Modify: `src/hooks/useTestRunner.js`
- Test: `tests/useTestRunnerSource.test.mjs`

**Interfaces:**
- Consumes: `buildMultiTurnQueue`, `buildContinueDecision`
- Produces: report case fields `multiTurnCaseId`, `multiTurnTitle`, `turnIndex`, `turnTotal`, `maxTurns`, `dialogueTurnKey`, `dialogueStatus`, `continueDecision`, `needWakeup`, `shouldContinue`

- [ ] **Step 1: Write failing source test**

Assert that the runner imports `buildMultiTurnQueue`, checks `item.needWakeup`, records `dialogueTurnKey`, and stores `continueDecision`.

- [ ] **Step 2: Run test to verify RED**

Run: `node tests/useTestRunnerSource.test.mjs`

Expected: fails because runner still uses the local flat `buildQueue`.

- [ ] **Step 3: Implement runner changes**

Use the dialogue-aware queue, skip `ensureSpeakerWakeup` when `needWakeup` is false, record skipped wakeup fields, and include continue decision fields in the report case.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node tests/useTestRunnerSource.test.mjs
node tests/multiTurnDialogue.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTestRunner.js tests/useTestRunnerSource.test.mjs
git commit -m "Record multi-turn dialogue execution metadata"
```

### Task 5: Report UI And Export Integration

**Files:**
- Modify: `src/components/PlaybackConsole.jsx`
- Modify: `src/components/TestReport.jsx`
- Modify: `src/utils/reportGenerator.js`
- Test: `tests/agentEvaluationUiSource.test.mjs`
- Test: `tests/reportGenerator.test.mjs`

**Interfaces:**
- Consumes: `AGENT_EVALUATION_METRIC_GROUPS`, `selectAgentEvaluationPlan`, `evaluateAgentReport`, `summarizeMultiTurnCases`
- Produces: metric checkbox UI, plan preview, report evaluation panel, JSON/text/CSV export fields

- [ ] **Step 1: Write failing tests**

Add source assertions for UI imports and labels, and report generator assertions for multi-turn/evaluation export fields.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
node tests/agentEvaluationUiSource.test.mjs
node tests/reportGenerator.test.mjs
```

Expected: fail before UI/export changes.

- [ ] **Step 3: Implement UI and export**

Add grouped metric checkboxes, plan preview, multi-turn summary, evaluation result panel, case turn metadata, and export fields.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node tests/agentEvaluationUiSource.test.mjs
node tests/reportGenerator.test.mjs
node tests/agentEvaluation.test.mjs
node tests/multiTurnDialogue.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlaybackConsole.jsx src/components/TestReport.jsx src/utils/reportGenerator.js tests/agentEvaluationUiSource.test.mjs tests/reportGenerator.test.mjs
git commit -m "Add agent evaluation report UI and exports"
```

### Task 6: Final Verification

**Files:**
- No production files unless verification reveals an issue.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: verified branch state with no deployment.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node tests/multiTurnDialogue.test.mjs
node tests/agentEvaluation.test.mjs
node tests/stateSanitizer.test.mjs
node tests/useTestRunnerSource.test.mjs
node tests/agentEvaluationUiSource.test.mjs
node tests/reportGenerator.test.mjs
```

- [ ] **Step 2: Run build**

Run: `npm run build`

- [ ] **Step 3: Inspect git status**

Run: `git status --short --branch`

- [ ] **Step 4: Commit any final fixes**

Only commit fixes required by failed verification.
