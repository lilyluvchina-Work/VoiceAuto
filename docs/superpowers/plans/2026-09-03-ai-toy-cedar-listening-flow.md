# AI Toy Cedar Listening Flow Implementation Plan

> 历史设计/实施计划：后续实现已演进为持续会话和启动确认后的恢复。当前操作与限制以[设备测试流程说明](../../product/device-test-workflows.md)为准，本文代码示例和待办状态保留用于追溯。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align VoiceAuto AI玩具 USB串口 monitoring with `E:\hey_cedar_test` from wakeup through each dialogue turn and retry.

**Architecture:** Keep the current bridge API shape, but make the serial response detector enforce the Cedar order: input is detected separately, then response must observe first audio, playback done, and back-to-listening before success. Update runner retry policy so any failed AI玩具 turn is re-woken and replayed instead of moving to the next dialogue turn.

**Tech Stack:** React 18, Vite, Node CommonJS bridge, Node `.mjs` assertion tests, `serialport`.

**Spec:** `E:\hey_cedar_test\README.md` and `E:\hey_cedar_test\hey_cedar_test.py`

## Global Constraints

- AI玩具 event order follows `Cedar: Input Text -> Audio latency first_downlink_audio -> TTS playback done -> Cedar: Start listening`.
- First dialogue turn wakes the device; continuation turns reuse the session.
- Any AI玩具 turn failure records the failed attempt, then retries the same queue item after a fresh wakeup.
- Failure markers are `idle`, `tts_timeout`, `reboot`, and `serial_error` equivalent events.

---

### Task 1: Serial Response Stage Order

**Files:**
- Modify: `scripts/adbBridge.cjs`
- Test: `tests/adbBridgeSource.test.mjs`

**Interfaces:**
- Consumes: `detectSpeakerResponseLog(body)` serial mode.
- Produces: serial response results where AI玩具 success requires `firstAudioDetected && playbackDoneDetected && listeningDetected`.

- [ ] Add failing source assertions for `listeningDetected` state and ordered AI玩具 completion.
- [ ] Run `node tests/adbBridgeSource.test.mjs` and confirm failure.
- [ ] Update serial response detection to persist `listeningDetected`, `listeningTime`, and `listeningLine`.
- [ ] Return `vadEnded` only after playback done and `status: 'completed'` only after back-to-listening.
- [ ] Run `node tests/adbBridgeSource.test.mjs`.

### Task 2: AI Toy Retry Current Turn

**Files:**
- Modify: `src/hooks/useTestRunner.js`
- Test: `tests/useTestRunnerSource.test.mjs`

**Interfaces:**
- Consumes: `buildRetryQueueItem(queueItem, failureResult)`.
- Produces: failed AI玩具 attempts replay the same `dialogueTurnKey` with `needWakeup: true`.

- [ ] Add failing source assertions that AI玩具 retry is not limited to `matchesAiToyRecoverableFailure`.
- [ ] Run `node tests/useTestRunnerSource.test.mjs` and confirm failure.
- [ ] Change `shouldRetryCurrentAiToyTurn` to retry any failed AI玩具 turn up to the existing retry cap.
- [ ] Include response timeout and playback completion status in `previousFailureEvent`.
- [ ] Run `node tests/useTestRunnerSource.test.mjs`.

### Task 3: Verification

**Files:**
- Test: all `tests/*.mjs`

- [ ] Run every `.mjs` test under `tests`.
- [ ] Inspect the final diff for unrelated edits.
