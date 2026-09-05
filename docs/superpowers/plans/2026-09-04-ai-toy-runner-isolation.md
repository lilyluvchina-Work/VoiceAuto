# AI Toy Runner Isolation Implementation Plan

> 历史设计/实施计划：后续实现已演进为持续会话和启动确认后的恢复。当前操作与限制以[设备测试流程说明](../../product/device-test-workflows.md)为准，本文代码示例和待办状态保留用于追溯。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate AI玩具 voice control into a dedicated Cedar Runner so wake success always proceeds to test audio playback before ASR or response monitoring.

**Architecture:** Keep `useTestRunner.js` as the React hook shell and route `DEVICE_TYPES.AI_TOY` to `runAiToyTest`. Implement `src/runners/aiToyRunner.js` as a Cedar-ordered state machine that does not import or call Speaker-only response recording, Langfuse, continuous Speaker playback guard, or Speaker cooldown logic.

**Tech Stack:** React hook orchestration, plain JavaScript modules, existing `adbWakeService`, existing `playAudioItem`, existing process-log event system, Node `.mjs` source tests.

**Spec:** `docs/superpowers/specs/2026-09-04-ai-toy-runner-isolation-design.md`

## Global Constraints

- Device name remains exactly `AI玩具`.
- AI玩具 default log source remains `LOG_SOURCES.SERIAL`.
- AI玩具 wake success requires `VOICE WAKE WORD HIT ACCEPTED` and `Cedar: Start listening`.
- AI玩具 turn order is wake success -> test audio playback -> `Cedar: Input Text` -> `Audio latency first_downlink_audio` -> `TTS playback done` -> `Cedar: Start listening`.
- AI玩具 Runner must not call `responseMonitorService.detectSpeakerResponse`, `waitForLangfuseResponseComplete`, `SPEAKER_CONTINUOUS_PLAYBACK_DONE_KEYWORD`, or Speaker response cooldown.
- Failed AI玩具 turns retry the same `dialogueTurnKey` with `needWakeup: true` up to 3 retries.
- Keep report field names compatible with existing UI.
- Do not add third-party dependencies.
- Do not revert unrelated dirty worktree changes.

---

### Task 1: Add AI玩具 Runner Source Tests

**Files:**
- Modify: `tests/useTestRunnerSource.test.mjs`
- Create: `tests/aiToyRunnerSource.test.mjs`

**Interfaces:**
- Consumes: planned `runAiToyTest` export from `src/runners/aiToyRunner.js`
- Produces: failing source-level requirements for Runner routing and Cedar-only sequencing

- [ ] **Step 1: Add router assertions to `tests/useTestRunnerSource.test.mjs`**

```js
assert.match(source, /import \{ runAiToyTest \} from '\.\.\/runners\/aiToyRunner';/);
assert.match(source, /if \(isAiToyRun\) \{[\s\S]*await runAiToyTest\(/);
assert.match(source, /runAiToyTest\(\{[\s\S]*playAudioItem[\s\S]*adbWakeService[\s\S]*\}\)/);
```

- [ ] **Step 2: Create `tests/aiToyRunnerSource.test.mjs`**

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/runners/aiToyRunner.js', import.meta.url), 'utf8');

assert.match(source, /export async function runAiToyTest/);
assert.match(source, /ai_toy\.run\.start/);
assert.match(source, /ai_toy\.test_audio\.play\.start/);
assert.match(source, /playAudioItem\(item\.audio/);
assert.match(source, /ai_toy\.asr\.detect\.start\.after_test_audio/);
assert.match(source, /adbWakeService\.detectAsr/);
assert.match(source, /ai_toy\.response\.detect\.start\.after_asr/);
assert.match(source, /adbWakeService\.detectSpeakerResponseLog/);
assert.match(source, /ai_toy\.retry\.same_turn/);
assert.doesNotMatch(source, /responseMonitorService/);
assert.doesNotMatch(source, /waitForLangfuseResponseComplete/);
assert.doesNotMatch(source, /SPEAKER_CONTINUOUS_PLAYBACK_DONE_KEYWORD/);

const playIndex = source.indexOf('playAudioItem(item.audio');
const asrIndex = source.indexOf('adbWakeService.detectAsr');
const responseIndex = source.indexOf('adbWakeService.detectSpeakerResponseLog');
assert.ok(playIndex > -1, 'AI toy runner should play test audio');
assert.ok(asrIndex > playIndex, 'AI toy ASR must start after playAudioItem');
assert.ok(responseIndex > asrIndex, 'AI toy response detection must start after ASR');
```

- [ ] **Step 3: Run RED tests**

Run: `node tests/useTestRunnerSource.test.mjs`

Expected: FAIL because `runAiToyTest` is not imported or called.

Run: `node tests/aiToyRunnerSource.test.mjs`

Expected: FAIL because `src/runners/aiToyRunner.js` does not exist.

### Task 2: Implement Isolated AI玩具 Runner

**Files:**
- Create: `src/runners/aiToyRunner.js`

**Interfaces:**
- Consumes: injected `queue`, `state`, `wakeWord`, `defaultVoiceConfig`, `testOptions`, `deviceRuntime`, `dispatch`, `refs`, `services`, and `helpers`
- Produces: `export async function runAiToyTest(options)`

- [ ] **Step 1: Create module skeleton**

```js
import { actions } from '../stores/testStore';

export async function runAiToyTest({
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
}) {
  const {
    isPlayingRef,
    isPausedRef,
    runIdRef,
    firstTestAudioTimeRef,
    lastTestAudioTimeRef,
    wakeFailCountRef,
    abortControllerRef,
  } = refs;
  const {
    ttsService,
    adbWakeService,
    notifyDingTalk,
    playAudioItem,
  } = services;
  const {
    wait,
    resolveAudioCaseId,
    textSimilarity,
    buildRetryQueueItem,
    buildContinueDecision,
    resolveExpectsVoiceResponse,
    logWake,
    logInput,
    logResponse,
    createStageError,
    resolveConfiguredList,
    toLines,
  } = helpers;
  const shouldStop = () => !isPlayingRef.current || runIdRef.current !== runId;
  const resolveStopReason = () => {
    if (!isPlayingRef.current) return isPausedRef.current ? 'paused' : 'not_playing';
    if (runIdRef.current !== runId) return 'run_id_changed';
    return '';
  };

  logWake('ai_toy.run.start', {
    runId: reportRunId,
    queueLength: queue.length,
    serialPort: deviceRuntime.serialPort,
    baudrate: deviceRuntime.baudrate,
  });
}
```

- [ ] **Step 2: Add wake helper inside `runAiToyTest`**

```js
  const ensureAiToyWakeup = async (item, cursor) => {
    const config = testOptions.autonomousWake || {};
    const autonomousWakeEnabled = Boolean(config.enabled);
    const wakeKeywords = toLines(config.keywords).length
      ? toLines(config.keywords)
      : toLines(deviceRuntime.profile.wake?.keywords);
    const timeoutMs = (Number(config.detectionTimeoutMs) || deviceRuntime.profile.defaults.wakeDetectionTimeoutMs || 10000) + 3000;

    dispatch(actions.setPlaybackState({
      currentIndex: cursor,
      currentListIndex: item.listIndex,
      currentAudioId: item.audio.id,
      currentType: 'wake',
    }));
    setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · AI玩具唤醒词: ${wakeWord.text}`);

    let detectPromise = null;
    if (autonomousWakeEnabled) {
      logWake('ai_toy.wake.detect.start', { cursor, timeoutMs, wakeKeywords });
      detectPromise = adbWakeService.detectWakeup({
        bridgeUrl: config.bridgeUrl,
        deviceId: config.deviceId,
        deviceType: deviceRuntime.deviceType,
        logSource: deviceRuntime.logSource,
        serialPort: deviceRuntime.serialPort,
        baudrate: deviceRuntime.baudrate,
        keywords: wakeKeywords,
        timeoutMs,
        signal: abortControllerRef.current?.signal,
      }).catch((err) => ({ __error: err }));
    }

    const wakeAudioPlayStartTime = Date.now();
    await ttsService.speak(wakeWord.text, {
      voice: defaultVoiceConfig.voice,
      voiceType: defaultVoiceConfig.voiceType,
      voiceName: defaultVoiceConfig.voiceName,
      provider: defaultVoiceConfig.provider,
      lang: defaultVoiceConfig.lang,
      volume: 200,
      rate: defaultVoiceConfig.rate,
    });
    const wakeAudioPlayEndTime = Date.now();

    if (!autonomousWakeEnabled) {
      return {
        wake_audio_play_status: 'completed',
        wake_audio_play_start_time: wakeAudioPlayStartTime,
        wake_audio_play_end_time: wakeAudioPlayEndTime,
        speaker_wake_status: 'not_detected',
        wake_event_time: null,
        wake_fail_count: wakeFailCountRef.current,
      };
    }

    const detectResult = await detectPromise;
    if (detectResult?.__error) throw detectResult.__error;
    if (!detectResult?.success) {
      return {
        wake_audio_play_status: 'completed',
        wake_audio_play_start_time: wakeAudioPlayStartTime,
        wake_audio_play_end_time: wakeAudioPlayEndTime,
        speaker_wake_status: 'failed',
        wake_event_time: null,
        wake_fail_count: wakeFailCountRef.current + 1,
        fail_stage: 'AI_TOY_WAKE',
        fail_reason: detectResult?.message || 'AI玩具唤醒后未检测到 Cedar listening',
        wake_matched_keyword: detectResult?.matchedKeyword || '',
        wake_matched_line: detectResult?.matchedLine || '',
      };
    }

    logWake('ai_toy.wake.success', {
      cursor,
      matchedKeyword: detectResult.matchedKeyword,
      matchedLine: detectResult.matchedLine,
    });
    wakeFailCountRef.current = 0;
    return {
      wake_audio_play_status: 'completed',
      wake_audio_play_start_time: wakeAudioPlayStartTime,
      wake_audio_play_end_time: wakeAudioPlayEndTime,
      speaker_wake_status: 'success',
      wake_event_time: detectResult.eventTime,
      wake_fail_count: 0,
      wake_matched_keyword: detectResult.matchedKeyword,
      wake_matched_line: detectResult.matchedLine,
    };
  };
```

- [ ] **Step 3: Add main queue loop with test audio before monitoring**

```js
  let completedCases = 0;
  let passedCases = 0;
  let failedCases = 0;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (shouldStop()) return;
    while (isPausedRef.current) {
      await wait(100);
      if (shouldStop()) return;
    }

    const item = queue[cursor];
    const continueDecision = buildContinueDecision(item);
    const caseId = resolveAudioCaseId(item.audio, item.listIndex);
    const wakeResult = item.needWakeup
      ? await ensureAiToyWakeup(item, cursor)
      : {
          wake_audio_play_status: 'skipped_reused_session',
          speaker_wake_status: 'skipped_reused_session',
          wake_fail_count: wakeFailCountRef.current,
        };

    if (wakeResult?.speaker_wake_status === 'failed') {
      queue[cursor] = buildRetryQueueItem(item, {
        failureEvent: wakeResult.fail_reason,
        failureLog: wakeResult.wake_matched_line,
      });
      logWake('ai_toy.retry.same_turn', {
        cursor,
        retryCount: queue[cursor].retryCount,
        dialogueTurnKey: item.dialogueTurnKey,
      });
      cursor -= 1;
      continue;
    }

    dispatch(actions.setPlaybackState({
      currentIndex: cursor,
      currentListIndex: item.listIndex,
      currentAudioId: item.audio.id,
      currentType: 'test-ready',
    }));
    setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · AI玩具准备播放测试音频`);
    logInput('ai_toy.test_audio.ready', {
      cursor,
      caseId,
      targetText: item.audio.text,
      stopReason: resolveStopReason(),
    });

    if (shouldStop()) {
      logInput('ai_toy.test_audio.stopped_before_play', {
        cursor,
        caseId,
        stopReason: resolveStopReason(),
      });
      return;
    }

    let testAudioStarted = false;
    let playStartTime = Date.now();
    let playEndTime = null;
    let success = true;
    let failStage = '';
    let failReason = '';

    dispatch(actions.setPlaybackState({ currentType: 'test' }));
    setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · ${item.audio.text}`);
    logInput('ai_toy.test_audio.play.start', {
      cursor,
      caseId,
      audioId: item.audio.id,
      targetText: item.audio.text,
      hasAudioUrl: Boolean(item.audio.audioUrl),
    });
    await playAudioItem(item.audio, ttsService, defaultVoiceConfig, {
      onStart: () => {
        if (testAudioStarted) return;
        testAudioStarted = true;
        if (!firstTestAudioTimeRef.current) {
          firstTestAudioTimeRef.current = Date.now();
          dispatch(actions.setReport({ firstTestAudioTime: firstTestAudioTimeRef.current }));
        }
        logInput('ai_toy.test_audio.play.started', {
          cursor,
          caseId,
          audioId: item.audio.id,
          targetText: item.audio.text,
        });
      },
    });
    playEndTime = Date.now();
    lastTestAudioTimeRef.current = playEndTime;
    dispatch(actions.setReport({ lastTestAudioTime: playEndTime }));
    logInput('ai_toy.test_audio.play.completed', {
      cursor,
      caseId,
      durationMs: playEndTime - playStartTime,
    });
  }
```

- [ ] **Step 4: Add ASR and response monitoring after playback**

```js
    const autonomousInputConfig = testOptions.autonomousInput || {};
    const autonomousInputEnabled = Boolean(autonomousInputConfig.enabled);
    const autonomousResponseConfig = testOptions.autonomousResponse || {};
    const expectsVoiceResponse = resolveExpectsVoiceResponse(item.audio);
    const autonomousResponseEnabled = Boolean(autonomousResponseConfig.enabled && expectsVoiceResponse);
    const asrKeywords = resolveConfiguredList(autonomousInputConfig.asrKeywords, deviceRuntime.profile.input?.endKeywords);
    const asrStartKeywords = resolveConfiguredList(autonomousInputConfig.asrStartKeywords, deviceRuntime.profile.input?.startKeywords);
    const asrEndKeywords = resolveConfiguredList(
      autonomousInputConfig.asrEndKeywords || autonomousInputConfig.asrKeywords,
      deviceRuntime.profile.input?.endKeywords || asrKeywords
    );
    const asrFailureKeywords = resolveConfiguredList(autonomousInputConfig.asrFailureKeywords, deviceRuntime.profile.input?.failureKeywords);
    const asrPatterns = resolveConfiguredList(autonomousInputConfig.asrPatterns, deviceRuntime.profile.input?.extractPatterns);
    let asrResult = null;
    let responseLogResult = null;
    let inputChainPassed = !autonomousInputEnabled;
    let responseChainPassed = !autonomousResponseEnabled;
    let asrMatchResult = 'not_checked';
    let asrSimilarity = null;

    if (autonomousInputEnabled && success) {
      dispatch(actions.setPlaybackState({ currentType: 'asr-detect' }));
      setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · AI玩具监听 Cedar 输入文本`);
      logInput('ai_toy.asr.detect.start.after_test_audio', { cursor, caseId, targetText: item.audio.text });
      asrResult = await adbWakeService.detectAsr({
        bridgeUrl: testOptions.autonomousWake?.bridgeUrl,
        deviceId: testOptions.autonomousWake?.deviceId,
        deviceType: deviceRuntime.deviceType,
        logSource: deviceRuntime.logSource,
        serialPort: deviceRuntime.serialPort,
        baudrate: deviceRuntime.baudrate,
        timeoutMs: Number(autonomousInputConfig.asrDetectionTimeoutMs) || deviceRuntime.profile.defaults.asrDetectionTimeoutMs || 14000,
        keywords: asrKeywords.length ? asrKeywords : undefined,
        startKeywords: asrStartKeywords.length ? asrStartKeywords : undefined,
        endKeywords: asrEndKeywords.length ? asrEndKeywords : undefined,
        failureKeywords: asrFailureKeywords.length ? asrFailureKeywords : undefined,
        patterns: asrPatterns,
        signal: abortControllerRef.current?.signal,
      });
      const actualAsrText = asrResult.actualAsrText || '';
      asrSimilarity = actualAsrText ? textSimilarity(actualAsrText, item.audio.text) : 0;
      inputChainPassed = Boolean(asrResult.success);
      asrMatchResult = actualAsrText ? 'matched' : (asrResult.success ? 'marker_success_no_text' : 'marker_failed');
      if (!inputChainPassed) {
        success = false;
        failStage = 'AI_TOY_ASR';
        failReason = asrResult.message || 'AI玩具未检测到 Cedar: Input Text';
      }
    }

    if (autonomousResponseEnabled && success) {
      dispatch(actions.setPlaybackState({ currentType: 'response-detect' }));
      setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · AI玩具监听首包、完播和 listening`);
      logResponse('ai_toy.response.detect.start.after_asr', { cursor, caseId, targetText: item.audio.text });
      responseLogResult = await adbWakeService.detectSpeakerResponseLog({
        bridgeUrl: testOptions.autonomousWake?.bridgeUrl,
        deviceId: testOptions.autonomousWake?.deviceId,
        deviceType: deviceRuntime.deviceType,
        logSource: deviceRuntime.logSource,
        serialPort: deviceRuntime.serialPort,
        baudrate: deviceRuntime.baudrate,
        timeoutMs: Number(autonomousResponseConfig.responseWindowMs) || deviceRuntime.profile.defaults.responseWindowMs || 18000,
        maxWaitMs: Number(autonomousResponseConfig.responseMaxWaitMs) || deviceRuntime.profile.defaults.responseMaxWaitMs || 35000,
        firstAudioKeywords: deviceRuntime.profile.response?.firstAudioKeywords,
        playbackDoneKeywords: deviceRuntime.profile.response?.playbackDoneKeywords,
        listeningKeywords: deviceRuntime.profile.response?.listeningKeywords,
        failureKeywords: deviceRuntime.profile.failure?.keywords,
        signal: abortControllerRef.current?.signal,
      });
      responseChainPassed = Boolean(responseLogResult.success);
      if (!responseChainPassed) {
        success = false;
        failStage = 'AI_TOY_RESPONSE';
        failReason = responseLogResult.message || 'AI玩具响应未完成 first audio -> playback done -> listening';
      }
    }
```

- [ ] **Step 5: Add report, retry, completion**

```js
    const finalSuccess = Boolean(success && playEndTime && inputChainPassed && responseChainPassed);
    dispatch(actions.addReportCase({
      index: cursor,
      listIndex: item.listIndex,
      round: item.round,
      multiTurnCaseId: item.multiTurnCaseId,
      multiTurnTitle: item.multiTurnTitle,
      turnIndex: item.turnIndex,
      turnTotal: item.turnTotal,
      dialogueTurnKey: item.dialogueTurnKey,
      dialogueStatus: continueDecision.dialogue_status,
      continueDecision,
      needWakeup: item.needWakeup,
      shouldContinue: continueDecision.should_continue,
      runId: reportRunId,
      caseId,
      playIndex: cursor + 1,
      audioId: item.audio.id,
      audioFile: `${reportRunId}_${caseId}.wav`,
      text: item.audio.text,
      targetText: item.audio.text,
      expectedResult: item.audio.expectedResult || item.audio.expectation || '',
      expectsVoiceResponse,
      playStartTime,
      playEndTime,
      success: finalSuccess,
      duration: item.audio.duration || 0,
      failStage,
      failReason,
      wakeAudioFile: wakeWord.audioUrl || wakeWord.text,
      wakeAudioPlayStatus: wakeResult?.wake_audio_play_status || '',
      wakeAudioPlayStartTime: wakeResult?.wake_audio_play_start_time || null,
      wakeAudioPlayEndTime: wakeResult?.wake_audio_play_end_time || null,
      speakerWakeStatus: wakeResult?.speaker_wake_status || '',
      wakeEventTime: wakeResult?.wake_event_time || null,
      wakeFailCount: wakeResult?.wake_fail_count || 0,
      wakeMatchedKeyword: wakeResult?.wake_matched_keyword || '',
      wakeMatchedLine: wakeResult?.wake_matched_line || '',
      humanAudioText: item.audio.text,
      testAudioFile: item.audio.audioUrl || item.audio.audioFile || '',
      testAudioPlayStatus: playEndTime ? 'completed' : 'error',
      testAudioPlayStartTime: playStartTime,
      testAudioPlayEndTime: playEndTime,
      testAudioActualDuration: playEndTime ? playEndTime - playStartTime : 0,
      testAudioExpectedDuration: item.audio.duration || 0,
      actualAsrText: asrResult?.actualAsrText || '',
      asrMatchResult,
      asrSimilarity,
      asrStatus: asrResult?.status || '',
      asrMatchedLine: asrResult?.matchedLine || '',
      asrMatchedKeyword: asrResult?.matchedKeyword || '',
      inputChainPassed,
      responseTtsStatus: responseLogResult?.status || '',
      responseVadStarted: Boolean(responseLogResult?.vadStarted),
      responseVadEnded: Boolean(responseLogResult?.vadEnded),
      responseTtsMatchedLine: responseLogResult?.ttsMatchedLine || responseLogResult?.matchedLine || '',
      responseChainPassed,
    }));
    completedCases += 1;
    if (finalSuccess) passedCases += 1;
    else failedCases += 1;

    logResponse('ai_toy.turn.result', {
      cursor,
      caseId,
      success: finalSuccess,
      failStage,
      failReason,
    });

    if (!finalSuccess && Number(item.retryCount || 0) < 3) {
      queue[cursor] = buildRetryQueueItem(item, {
        failureEvent: failStage,
        failureLog: failReason,
      });
      logWake('ai_toy.retry.same_turn', {
        cursor,
        retryCount: queue[cursor].retryCount,
        dialogueTurnKey: item.dialogueTurnKey,
      });
      cursor -= 1;
    }
  }

  dispatch(actions.completeReport());
  isPlayingRef.current = false;
  isPausedRef.current = false;
  await notifyDingTalk('TEST_COMPLETED', {
    state,
    runId: reportRunId,
    details: [
      `执行总数：${queue.length}`,
      `完成数量：${completedCases}`,
      `通过数量：${passedCases}`,
      `失败数量：${failedCases}`,
    ],
  });
  onTestComplete?.();
```

- [ ] **Step 6: Run GREEN for AI玩具 Runner source test**

Run: `node tests/aiToyRunnerSource.test.mjs`

Expected: PASS.

### Task 3: Route AI玩具 From `useTestRunner.js`

**Files:**
- Modify: `src/hooks/useTestRunner.js`

**Interfaces:**
- Consumes: `runAiToyTest(options)` from `src/runners/aiToyRunner.js`
- Produces: AI玩具 routing before the existing Speaker loop executes

- [ ] **Step 1: Import Runner**

```js
import { runAiToyTest } from '../runners/aiToyRunner';
```

- [ ] **Step 2: Add AI玩具 route after run setup and before existing Speaker-specific queue loop**

```js
    if (isAiToyRun) {
      await runAiToyTest({
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
        refs: {
          isPlayingRef,
          isPausedRef,
          runIdRef,
          firstTestAudioTimeRef,
          lastTestAudioTimeRef,
          wakeFailCountRef,
          rebootCountRef,
          abortControllerRef,
        },
        services: {
          ttsService,
          adbWakeService,
          notifyDingTalk,
          playAudioItem,
        },
        helpers: {
          wait,
          resolveAudioCaseId,
          textSimilarity,
          buildRetryQueueItem,
          buildContinueDecision,
          resolveExpectsVoiceResponse,
          logWake,
          logInput,
          logResponse,
          createStageError,
          resolveConfiguredList,
          toLines,
        },
        onTestComplete,
      });
      return;
    }
```

- [ ] **Step 3: Run router test**

Run: `node tests/useTestRunnerSource.test.mjs`

Expected: PASS.

### Task 4: Verify Existing Flow and Build

**Files:**
- Test only

**Interfaces:**
- Consumes: all modified files
- Produces: verification evidence

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node tests/aiToyRunnerSource.test.mjs
node tests/useTestRunnerSource.test.mjs
node tests/adbBridgeSource.test.mjs
node tests/deviceExecutionQueue.test.mjs
node tests/adbWakeServiceDevicePayload.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 2: Run all `.mjs` tests**

Run:

```powershell
$failed = @(); Get-ChildItem -LiteralPath tests -Filter *.mjs | Sort-Object Name | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { $failed += $_.Name } }; if ($failed.Count -gt 0) { Write-Host ('FAILED: ' + ($failed -join ', ')); exit 1 }; Write-Host 'All tests passed'
```

Expected: `All tests passed`.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: Vite build exits 0. If sandbox returns esbuild `spawn EPERM`, rerun with approved normal permissions and record warnings.

- [ ] **Step 4: Inspect final source boundaries**

Run:

```powershell
Select-String -LiteralPath src/runners/aiToyRunner.js -Pattern "responseMonitorService|waitForLangfuseResponseComplete|SPEAKER_CONTINUOUS_PLAYBACK_DONE_KEYWORD"
Select-String -LiteralPath src/hooks/useTestRunner.js -Pattern "runAiToyTest|if \\(isAiToyRun\\)"
```

Expected: first command returns no matches; second command shows AI玩具 routing.

## Self-Review

- Spec coverage: Runner router, AI玩具 Cedar sequence, bridge boundary, reporting compatibility, error handling, retries, and tests are covered by Tasks 1-4.
- Placeholder scan: no `TBD`, `TODO`, `implement later`, or vague test-only instructions remain.
- Type consistency: `runAiToyTest(options)`, `refs`, `services`, and `helpers` names match across Task 2 and Task 3.
