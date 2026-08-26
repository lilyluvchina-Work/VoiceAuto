# Multi-Turn Agent Evaluation MVP Design

## Goal

Build the first usable VoiceAuto loop for multi-turn dialogue execution and agent evaluation without automatic deployment.

The MVP turns the architecture proposal in `docs/architecture/多轮对话与智能体评测完成方案.md` into a conservative first release:

- Execute fixed multi-turn cases with one wakeup at the start of a dialogue.
- Record each turn with input, response, timing, status, and wakeup policy.
- Let users choose evaluation metrics.
- Select exactly one evaluation plan using the documented priority: PlanA link-state evaluation, then PlanB semantic evaluation, then built-in rule evaluation.
- Show evaluation output in the existing test report and include export-ready data for existing report builders.

## In Scope

### Multi-Turn Case Model

VoiceAuto should support imported or locally shaped cases that contain multiple turns. A multi-turn case can be represented by an audio/test item with:

- `multiTurnCaseId`: stable dialogue-level id.
- `multiTurnTitle`: readable dialogue title.
- `turnIndex`: 1-based turn number.
- `turnTotal`: total turns in the dialogue.
- `maxTurns`: execution cap, default 10.
- `requiresWakeup`: true only for the first turn unless the case explicitly asks for a wakeup.
- `expectedResult`, `expectedResponseText`, `targetAgent`: existing per-turn expectation fields.

Existing single-turn cases remain valid. A single-turn case is treated as a dialogue with one turn.

### Multi-Turn Runner Behavior

The current `useTestRunner` playback flow remains the owner of actual wakeup, TTS playback, ASR detection, Speaker response capture, and report recording.

For MVP multi-turn cases:

- The queue groups generated test audios by `multiTurnCaseId` when present.
- Turn order is `turnIndex` ascending inside a group.
- A dialogue supports at least 10 turns.
- Wakeup is performed on the first turn.
- Later turns skip wakeup by default and reuse the active dialogue context.
- If a turn has `requiresWakeup === true`, that turn performs wakeup.
- Each recorded report case includes dialogue metadata and a continue decision.

The continue decision is rule-based for this MVP:

```json
{
  "should_continue": true,
  "need_wakeup": false,
  "dialogue_status": "fixed_case_next_turn",
  "reason": "固定多轮用例还有下一轮，继续执行且无需重复唤醒"
}
```

Last turns use `should_continue: false` and `dialogue_status: "completed"`.

### Dialogue Record

Every report case should include:

- `multiTurnCaseId`
- `multiTurnTitle`
- `turnIndex`
- `turnTotal`
- `maxTurns`
- `dialogueTurnKey`
- `dialogueStatus`
- `continueDecision`
- `needWakeup`
- `shouldContinue`
- existing wake, ASR, response, pass/fail, and timing fields

These fields must be serializable through existing local state and report export flows.

### Evaluation Metric Configuration

Add persisted test options for selected evaluation metrics. The MVP metrics are grouped as:

- Built-in rules: `case_pass_rate`, `task_completion`, `keyword_assertion`
- Link state: `wakeup`, `asr`, `tts`, `tts_play_complete`, `response_complete`
- Semantic: `intent`, `slot`, `context`, `semantic_continue`, `response_quality`

The UI should allow users to select metrics before or after a run. Selection should not block starting a normal test.

### Evaluation Plan Selector

Create a pure selector that returns exactly one plan:

- If selected metrics contain any link-state metric, select `planA_link_state`.
- Else if selected metrics contain any semantic metric, select `planB_semantic`.
- Else select `builtin_rules`.

The selector returns:

- `planId`
- `planName`
- `category`
- `reason`
- `selectedMetrics`
- `availableMetrics`

### MVP Evaluators

The built-in evaluator should calculate:

- total turns
- passed turns
- failed turns
- pass rate
- failed reasons grouped by stage

The link-state evaluator should calculate what existing report data supports:

- wakeup success counts from wake status fields
- ASR success counts from ASR/input fields
- TTS text presence from response TTS fields
- response completion presence from response status fields when available

If a selected metric lacks required evidence fields, the report must show a clear missing instrumentation message, for example:

```text
当前勾选了【TTS 完播率】，但未检测到 tts_play_complete 埋点，该指标无法计算，请补充播放完成事件埋点。
```

The semantic evaluator is a placeholder in the MVP, not a model call. It should:

- select `planB_semantic` correctly
- show that semantic scoring requires the configured large-model evaluation path
- include per-metric pending status

This keeps the UI and plan-selection contract ready without introducing a new live LLM dependency in this iteration.

### Report UI

Extend the existing `TestReport` surface with:

- multi-turn summary: dialogue count, turn count, average turns, completion rate
- evaluation plan panel: selected plan, reason, selected metrics
- metric result rows: score/status, evidence count, missing field messages
- turn detail metadata in the case list

Do not build a new landing page or deployment flow.

### Exports

Existing JSON/CSV/text report generation should include the new multi-turn and evaluation fields where practical. Excel/summary report integration can consume the same payload later; the MVP should avoid duplicating exporter logic.

## Out Of Scope

- Automatic deployment.
- Creating or merging a pull request.
- Full HTML offline report.
- Live semantic evaluation model calls for each turn.
- Free-form semantic continue decision.
- Replacing the existing playback runner.
- Reworking TAPD import end to end beyond preserving multi-turn metadata when available.

## Architecture

### New Pure Utility Modules

`src/utils/multiTurnDialogue.js`

- Normalize test audios into dialogue-aware queue items.
- Resolve single-turn fallback metadata.
- Build continue decisions.
- Summarize dialogue records.

`src/utils/agentEvaluation.js`

- Define metric catalog.
- Select the evaluation plan.
- Evaluate built-in and link-state metrics from report cases.
- Return semantic pending results for semantic metrics.

Pure modules keep the logic testable without rendering React.

### Store Changes

`src/stores/testStore.jsx`

- Add `testOptions.agentEvaluation.selectedMetrics`.
- Add action `setAgentEvaluationMetrics`.
- Sanitize persisted state by defaulting invalid selections to built-in rule metrics.
- Keep existing test options backward compatible.

### Runner Changes

`src/hooks/useTestRunner.js`

- Replace the flat queue builder with a dialogue-aware queue builder from `multiTurnDialogue.js`.
- Call wakeup only when `queueItem.needWakeup` is true.
- Add dialogue metadata and continue decision to `actions.addReportCase`.
- Preserve existing timing, DingTalk, Langfuse, ADB, ASR, and response behavior.

### UI Changes

`src/components/PlaybackConsole.jsx`

- Add a compact evaluation metric section using grouped checkboxes.
- Show the selected plan preview and reason.
- Keep controls locked while a run is active.

`src/components/TestReport.jsx`

- Compute evaluation output from current report cases and selected metrics.
- Show multi-turn and agent-evaluation panels.
- Include clear missing instrumentation messages.

### Export Changes

`src/utils/audioUtils.jsx`

- Include multi-turn and evaluation data in JSON and text exports.
- Add CSV columns for dialogue id, turn index, selected plan, dialogue status, and missing metric messages.

## Data Flow

1. User imports or prepares cases.
2. `useTestRunner` builds a dialogue-aware queue.
3. First turn wakes Speaker; later turns skip wakeup unless requested.
4. Existing playback and monitoring run per turn.
5. Each turn appends a report case with dialogue metadata.
6. Report UI evaluates the collected cases using selected metrics.
7. User views or exports the report.

## Error Handling

- Invalid or missing `turnIndex` falls back to list order.
- More than `maxTurns` turns are ignored in execution and surfaced in summary as capped.
- Missing instrumentation does not fail the whole report; it becomes a metric warning.
- Existing wakeup/ASR/response failures still mark the turn failed through current report logic.
- Semantic metrics do not call an LLM in this MVP; they show pending configuration status.

## Testing

Use TDD for implementation.

Required test coverage:

- Multi-turn queue grouping and wakeup policy.
- Continue decision for intermediate and last turns.
- At least 10 turns supported.
- Evaluation plan priority: PlanA over PlanB over built-in.
- Built-in metric calculations.
- Link-state missing instrumentation messages.
- Store default/persistence shape for selected metrics.
- Report/export source contains the new fields.

Verification commands:

- Focused node tests for new utility modules.
- Existing relevant tests for store/report/export behavior.
- `npm run build`.

## Deployment

Do not deploy automatically. Development ends with committed code and verification results only.
