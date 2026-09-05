# AI Toy Runner Isolation Design

> 历史设计/实施计划：后续实现已演进为持续会话和启动确认后的恢复。当前操作与限制以[设备测试流程说明](../../product/device-test-workflows.md)为准，本文代码示例和待办状态保留用于追溯。

## Problem

AI玩具唤醒后已经进入 `test-ready`，但测试音频仍可能不播放。多次局部修复没有稳定解决，根因是 AI玩具流程仍寄生在 `useTestRunner.js` 的 Speaker 编排中。当前大流程同时处理 Speaker 的 ADB、麦克风录音、Langfuse、连续对话守护、TTS 队列重置和 AI玩具的 Cedar 串口事件，导致 AI玩具在“准备测试用例 -> 播放测试音频”之间仍可能受到 Speaker-only 分支和异步监听时序影响。

## Goal

将 AI玩具语音控制和监测拆成独立 Runner，使 AI玩具严格按照 Cedar 串口状态机执行：唤醒、进入 listening、播放测试音频、监听输入文本、监听首包音频、监听 TTS 完播、监听回到 listening，然后进入下一轮。

## Non-Goals

- 不重写 Speaker 的现有麦克风录音、Langfuse response gate、连续对话守护和播报冷却逻辑。
- 不改变测试用例管理、音频生成、TAPD 导入或报告页面的外部交互。
- 不新增第三方依赖。
- 不依赖真实硬件作为自动化测试前置条件；真实硬件验证通过过程日志和 bridge 行为辅助完成。

## Current Findings

- `useTestRunner.js` 仍然包含 `isAiToyRun` / `isSpeakerRun` 分支，但核心循环仍共享同一套 `wakeResult`、`asrDetectPromise`、`responseLogDetectPromise`、`responseChainPassed` 和最终报告字段。
- AI玩具当前会调用通用 `detectAsr` 和 `detectSpeakerResponseLog`，这些调用会分别打开串口。参考 `E:\hey_cedar_test`，稳定模式是一条串口 reader 按顺序消费事件，而不是在一轮中反复打开不同监听。
- `playAudioItem` 本身只依赖 `audio.audioUrl` 或 `audio.text`，真正应保证的是 Runner 在调用播放前不启动 AI玩具串口 ASR/响应监听，也不进入 Speaker-only TTS reset、麦克风、Langfuse 和播报冷却分支。
- 过程日志需要覆盖 `test-ready -> playAudioItem` 的每一步，否则用户只能看到界面停在准备阶段。

## Architecture

### Runner Router

`useTestRunner.js` 保留 React hook 外壳、按钮状态、pause/stop/reset 入口和共享报告状态。它根据 `resolveDeviceRuntimeOptions(testOptions).deviceType` 路由：

- `DEVICE_TYPES.AI_TOY` 调用 AI玩具 Runner。
- `DEVICE_TYPES.SPEAKER` 调用现有 Speaker 流程。

AI玩具 Runner 不调用 Speaker-only 服务：

- 不调用 `responseMonitorService.detectSpeakerResponse`。
- 不调用 `waitForLangfuseResponseComplete`。
- 不使用 `SPEAKER_CONTINUOUS_PLAYBACK_DONE_KEYWORD`。
- 不执行测试音频前的 Speaker TTS 队列 `stopAudio()` + `POST_WAKE_TTS_QUEUE_RESET_MS`。
- 不执行 Speaker response end cooldown。

### AI玩具 Runner

新增 `src/runners/aiToyRunner.js`，导出 `runAiToyTest(options)`。它接收依赖注入参数，避免直接依赖 React hook 内部状态：

```js
runAiToyTest({
  runId,
  reportRunId,
  queue,
  state,
  wakeWord,
  defaultVoiceConfig,
  testOptions,
  deviceRuntime,
  dispatch,
  setCurrentAudioText,
  refs,
  services,
  helpers,
  onTestComplete,
})
```

`refs` 包含 `isPlayingRef`、`isPausedRef`、`runIdRef`、`firstTestAudioTimeRef`、`lastTestAudioTimeRef`、`wakeFailCountRef`、`rebootCountRef`、`abortControllerRef`。`services` 包含 `ttsService`、`adbWakeService`、`notifyDingTalk`、`playAudioItem`。`helpers` 包含 `wait`、`resolveAudioCaseId`、`textSimilarity`、`buildRetryQueueItem`、`buildContinueDecision`、`resolveExpectsVoiceResponse`、`logWake`、`logInput`、`logResponse`、`createStageError`。

### AI玩具 State Machine

For each queue item:

1. If `item.needWakeup` is true:
   - Start wake detection before wake audio playback using AI玩具 profile wake keywords.
   - Play wake word audio.
   - Wait until bridge reports both `VOICE WAKE WORD HIT ACCEPTED` and `Cedar: Start listening`.
   - On failure, retry wake up to the existing threshold and use AI玩具 serial reboot if configured.
2. Enter `test-ready`.
3. Log `ai_toy.test_audio.ready`.
4. Call `playAudioItem` before starting ASR or response monitoring.
5. On `playAudioItem` `onStart`, log `ai_toy.test_audio.started`.
6. Wait for `playAudioItem` to complete and log `ai_toy.test_audio.completed`.
7. If autonomous input is enabled, call `detectAsr` after test audio playback starts or completes; it must never run before `playAudioItem`.
8. If a voice response is expected and autonomous response is enabled, call `detectSpeakerResponseLog` only after ASR success; AI玩具 success requires `firstAudioDetected && playbackDoneDetected && responseListeningDetected`.
9. Add report case with compatible report fields.
10. If the turn failed, record the failed attempt and retry the same queue item with `needWakeup: true`, up to 3 retries.
11. If the turn succeeded and next queue item is the next AI玩具 dialogue turn, continue without Speaker cooldown. The next item’s `needWakeup` value comes from `buildDeviceExecutionQueue`.

### Bridge Boundary

Keep existing bridge endpoints for now:

- `/api/adb/wakeup/detect`
- `/api/adb/asr/detect`
- `/api/adb/response/detect`
- `/api/adb/reboot-and-wait`

The AI玩具 Runner calls these endpoints in a strict serial order. It does not open ASR and response listeners concurrently. A future improvement can add one long-lived Cedar session endpoint, but this implementation focuses on isolating the frontend Runner and preserving the current bridge API.

### Reporting

AI玩具 reports continue using existing report fields for UI compatibility:

- `speakerWakeStatus` stores wake status.
- `actualAsrText`, `asrStatus`, and ASR matched-line fields store Cedar input text state.
- `responseTtsStatus`, `responseVadStarted`, `responseVadEnded`, `responseTtsMatchedLine`, and `responseChainPassed` store AI玩具 first-audio/playback/listening completion.

Process logs add AI玩具-specific stages:

- `ai_toy.run.start`
- `ai_toy.wake.detect.start`
- `ai_toy.wake.success`
- `ai_toy.test_audio.ready`
- `ai_toy.test_audio.play.start`
- `ai_toy.test_audio.play.started`
- `ai_toy.test_audio.play.completed`
- `ai_toy.asr.detect.start.after_test_audio`
- `ai_toy.response.detect.start.after_asr`
- `ai_toy.turn.result`
- `ai_toy.retry.same_turn`

### Error Handling

- If wake detection fails, retry wake until threshold, then reboot via existing AI玩具 serial recovery path if configured.
- If test audio playback fails, mark the case failed with `failStage: 'TEST_AUDIO_PLAY'` and do not start ASR/response monitoring for that attempt.
- If ASR fails, mark `failStage: 'AI_TOY_ASR'`.
- If response sequence fails, mark `failStage: 'AI_TOY_RESPONSE'`.
- Any failed AI玩具 turn retries the same `dialogueTurnKey` with `needWakeup: true` up to 3 retries.
- Stop/pause/runId changes log a specific AI玩具 process event before returning.

## Testing Strategy

- Add static tests proving `useTestRunner.js` routes AI玩具 to `runAiToyTest` and Speaker to the existing flow.
- Add source tests proving `aiToyRunner.js` never imports or calls `responseMonitorService`, `waitForLangfuseResponseComplete`, or `SPEAKER_CONTINUOUS_PLAYBACK_DONE_KEYWORD`.
- Add source tests proving AI玩具 calls `playAudioItem` before `detectAsr` and calls response log detection only after ASR handling.
- Add unit tests for an extracted AI玩具 turn helper if the implementation extracts pure helpers for report building or retry decisions.
- Run all existing `.mjs` tests and `npm run build`.

## Acceptance Criteria

- Selecting `AI玩具` starts the isolated AI玩具 Runner.
- After wake success and `Cedar: Start listening`, AI玩具 logs `ai_toy.test_audio.play.start` and calls `playAudioItem` before any ASR or response detection.
- AI玩具 flow contains no Speaker-only microphone, Langfuse, continuous playback done, or Speaker cooldown logic.
- Speaker flow still passes existing source tests and remains available.
- AI玩具 failed turns retry the same item after a fresh wakeup.
- Build succeeds.

## Risks

- `useTestRunner.js` is already large and dirty, so routing changes must be small and avoid reformatting unrelated Speaker code.
- Existing report UI uses Speaker-named fields; this design keeps those fields for compatibility instead of renaming the whole report model.
- The bridge still opens separate serial readers per stage. The Runner prevents overlap, but real hardware could still expose driver-level serial close/open latency. Process logs must make this visible.
