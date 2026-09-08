import { actions } from '../stores/testStore';

const MAX_TURN_RETRIES = 3;
const MAX_WAKE_RETRIES = 5;
const numberOrDefault = (value, fallback) => Number(value) > 0 ? Number(value) : fallback;

export async function runAiToyTest({
  runId, reportRunId, queue, state, wakeWord, defaultVoiceConfig, testOptions,
  deviceRuntime, dispatch, setCurrentAudioText, refs, services, helpers, onTestComplete,
}) {
  const { isPlayingRef, isPausedRef, runIdRef, firstTestAudioTimeRef,
    lastTestAudioTimeRef, wakeFailCountRef, abortControllerRef } = refs;
  const { ttsService, adbWakeService, notifyDingTalk, playAudioItem } = services;
  const { wait, resolveAudioCaseId, textSimilarity, buildRetryQueueItem,
    buildContinueDecision, resolveExpectsVoiceResponse, logWake, logInput, logResponse } = helpers;
  const shouldStop = () => !isPlayingRef.current || runIdRef.current !== runId;
  const wakeConfig = testOptions.autonomousWake || {};
  const bridgeOptions = {
    bridgeUrl: wakeConfig.bridgeUrl, deviceId: wakeConfig.deviceId,
    deviceType: deviceRuntime.deviceType, logSource: deviceRuntime.logSource,
    serialPort: deviceRuntime.serialPort, baudrate: deviceRuntime.baudrate,
    signal: abortControllerRef.current?.signal,
  };
  let sessionId;
  const serialLogs = [];
  const closeSession = async () => {
    const result = await adbWakeService.closeAiToySession({ ...bridgeOptions, signal: undefined, sessionId });
    if (typeof result?.serialLog === 'string') serialLogs.push(result.serialLog);
    sessionId = undefined;
  };
  let sessionState;
  let firstWake = true;
  let fallbackRebootUsed = false;
  let rebootInProgress = false;
  let notificationCaseId;
  const notify = (type, details = []) => {
    if (!testOptions.dingTalkEnabled) return;
    const context = { state, runId: reportRunId, deviceType: 'ai_toy', happenedAt: Date.now(),
      details: [`设备：AI玩具 · 串口：${bridgeOptions.serialPort}`,
        ...(notificationCaseId == null ? [] : [`用例：${notificationCaseId}`]), ...details] };
    // Network requests must never delay listening, playback or recovery.
    void Promise.resolve().then(() => notifyDingTalk(type, context)).then(result => {
      if (result?.success === false) logWake('ai_toy.notification.failed', { type });
    }).catch(error => logWake('ai_toy.notification.failed', { type, message: error.message }));
  };
  let completedCases = 0;
  let passedCases = 0;
  let failedCases = 0;
  const sessionOptions = () => ({ ...bridgeOptions, sessionId });
  const readSession = async () => {
    sessionState = await adbWakeService.readAiToySession(sessionOptions());
    if (sessionState.error) throw new Error(sessionState.error);
    return sessionState;
  };
  const waitForSession = async (accept, { wakeTimeout = false, bootTimeout = false, turnTimeout = false } = {}) => {
    let started = Date.now();
    const warningMs = numberOrDefault(testOptions.autonomousResponse?.responseMaxWaitMs, 35000);
    let lastWarning = started;
    while (!shouldStop()) {
      const current = await readSession();
      if (isPausedRef.current) {
        const pauseStarted = Date.now();
        await wait(200);
        started += Date.now() - pauseStarted;
        continue;
      }
      if (accept(current)) return current;
      if (bootTimeout && Date.now() - started > 35000) {
        throw new Error('AI玩具重启后未检测到启动完成日志，已停止测试');
      }
      if (wakeTimeout && Date.now() - started > numberOrDefault(wakeConfig.detectionTimeoutMs, 10000) + 3000) {
        return null;
      }
      if (turnTimeout) {
        const elapsed = Date.now() - started;
        const hasInputEvidence = current.inputDetected || current.firstAudioDetected || current.playbackDone;
        if ((!hasInputEvidence && elapsed > numberOrDefault(testOptions.autonomousInput?.asrDetectionTimeoutMs, 8000))
          || elapsed > warningMs) return null;
      }
      if (!wakeTimeout && Date.now() - lastWarning >= warningMs) {
        lastWarning = Date.now();
        logResponse('ai_toy.response.still_waiting', { sessionId, phase: current.phase });
        setCurrentAudioText('AI玩具尚未确认播完并开始收音，继续等待');
      }
      await wait(200);
    }
    return null;
  };

  const rebootAndReconnect = async (cursor, caseId, failReason) => {
    setCurrentAudioText(`${failReason}，正在发送复位信号并等待启动完成`);
    logWake('ai_toy.reboot.start', { cursor, caseId, failReason });
    rebootInProgress = true;
    notify('AI_TOY_REBOOT_STARTED', [`${failReason}，发送复位信号，USB 物理连接保持`]);
    // The session owns the serial lock for its lifetime. Release it before reset.
    await closeSession();
    if (shouldStop()) return;
    const recovery = await adbWakeService.rebootSpeaker({
      ...bridgeOptions, recoveryTimeoutMs: 35000,
    });
    if (recovery.raw?.serialLog) serialLogs.push(recovery.raw.serialLog);
    if (shouldStop()) return;
    if (recovery.success !== true || recovery.bootCompleted !== true || recovery.serialConnected !== true || recovery.rebootCommandOk === false) {
      throw new Error(`AI玩具重启恢复失败，已停止测试：${recovery.message || recovery.rebootCommandError || '串口未恢复'}`);
    }
    rebootInProgress = false;
    notify('AI_TOY_REBOOT_SUCCESS', ['已确认启动完成，将重新唤醒并确认收音',
      `恢复串口：${recovery.recoveredDeviceId || bridgeOptions.serialPort}`]);
    if (recovery.recoveredDeviceId) {
      bridgeOptions.serialPort = recovery.recoveredDeviceId;
      bridgeOptions.deviceId = recovery.recoveredDeviceId;
      deviceRuntime.serialPort = recovery.recoveredDeviceId;
      dispatch(actions.setDeviceOptions({ serialPort: recovery.recoveredDeviceId }));
    }
    ({ sessionId } = await adbWakeService.openAiToySession(bridgeOptions));
    if (shouldStop()) return;
    firstWake = true;
    wakeFailCountRef.current = 0;
    logWake('ai_toy.reboot.recovered', { cursor, caseId, serialPort: bridgeOptions.serialPort });
  };

  try {
    // Opening is acknowledged after the data listener is attached, before any audio.
    ({ sessionId } = await adbWakeService.openAiToySession(bridgeOptions));
    logWake('ai_toy.run.start', { runId: reportRunId, queueLength: queue.length, sessionId });
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      if (shouldStop()) return;
      while (isPausedRef.current && !shouldStop()) {
        await readSession();
        await wait(200);
      }
      if (shouldStop()) return;
      const item = queue[cursor];
      const caseId = resolveAudioCaseId(item.audio, item.listIndex);
      notificationCaseId = caseId;
      await readSession();
      if (shouldStop()) return;
      const needWakeup = firstWake || Boolean(sessionState.interrupted);
      item.needWakeup = needWakeup;
      const continueDecision = buildContinueDecision(item);
      let wakeResult = {
        wake_audio_play_status: 'skipped_reused_session', speaker_wake_status: 'skipped_reused_session',
        wake_fail_count: wakeFailCountRef.current,
      };
      if (needWakeup) {
        // A reboot marker is followed by idle when the application has started again.
        if (sessionState.rebootPending) {
          rebootInProgress = true;
          notify('AI_TOY_REBOOT_STARTED', ['检测到设备自行重启，等待启动完成日志']);
          setCurrentAudioText('AI玩具正在重启，等待启动完成后唤醒');
          await waitForSession(current => current.bootCompleted === true, { bootTimeout: true });
          if (shouldStop()) return;
          rebootInProgress = false;
          notify('AI_TOY_REBOOT_SUCCESS', ['已确认启动完成，将重新唤醒', sessionState.bootMatchedLine || '']);
        }
        await adbWakeService.armAiToySession({ ...sessionOptions(), mode: 'wake' });
        if (shouldStop()) return;
        dispatch(actions.setPlaybackState({ currentIndex: cursor, currentListIndex: item.listIndex,
          currentAudioId: item.audio.id, currentType: 'wake' }));
        setCurrentAudioText(`AI玩具唤醒词: ${wakeWord.text}`);
        const started = Date.now();
        logWake('ai_toy.wake_audio.play.start', { cursor, text: wakeWord.text });
        await ttsService.speak(wakeWord.text, { ...defaultVoiceConfig, volume: 200 });
        const ended = Date.now();
        dispatch(actions.setPlaybackState({ currentType: 'wake-detect' }));
        const listening = await waitForSession(current => current.ready || (current.wakeable && !current.rebootPending), { wakeTimeout: true });
        if (shouldStop()) return;
        // Check remaining work before recovering: a finished run only needs cleanup/logs.
        if (cursor >= queue.length) break;
        if (!listening?.ready) {
          wakeFailCountRef.current += 1;
          const failReason = 'AI玩具唤醒后未检测到开始收音';
          logWake(listening?.wakeable ? 'ai_toy.wake.idle' : 'ai_toy.wake.timeout', { cursor, caseId, remainingCases: queue.length - cursor });
          if (wakeFailCountRef.current <= MAX_WAKE_RETRIES) {
            firstWake = true;
            setCurrentAudioText(`${listening?.wakeable ? 'AI玩具处于等待状态，重新唤醒' : 'AI玩具唤醒失败，正在重试'} ${wakeFailCountRef.current}/${MAX_WAKE_RETRIES}`);
            logWake('ai_toy.wake.retry', { cursor, caseId, retryCount: wakeFailCountRef.current });
            cursor -= 1;
            continue;
          }
          if (fallbackRebootUsed) {
            throw new Error(`${failReason}，重启恢复后仍未收音，已停止测试`);
          }
          fallbackRebootUsed = true;
          await rebootAndReconnect(cursor, caseId, failReason);
          if (shouldStop()) return;
          cursor -= 1;
          continue;
        }
        firstWake = false;
        wakeFailCountRef.current = 0;
        wakeResult = {
          wake_audio_play_status: 'completed', wake_audio_play_start_time: started,
          wake_audio_play_end_time: ended, speaker_wake_status: 'success',
          wake_event_time: listening.listeningTime || Date.now(), wake_fail_count: 0,
          wake_matched_line: listening.listeningLine,
        };
        logWake('ai_toy.wake.success', { cursor, listeningLine: listening.listeningLine });
        notify('AI_TOY_WAKE_SUCCESS', ['已确认开始收音，准备播放当前用例']);
      }
      // Poll once more at the boundary to catch an interruption between cases.
      await readSession();
      if (shouldStop()) return;
      if (sessionState.interrupted) { cursor -= 1; continue; }
      if (!sessionState.ready || isPausedRef.current) {
        await waitForSession(current => current.ready || current.interrupted);
        if (shouldStop()) return;
        if (sessionState.interrupted) { cursor -= 1; continue; }
      }
      const expectsVoiceResponse = resolveExpectsVoiceResponse(item.audio);
      await adbWakeService.armAiToySession({ ...sessionOptions(), mode: 'turn', expectsVoiceResponse });
      if (shouldStop()) return;
      let testAudioStarted = false;
      const playStartTime = Date.now();
      let playEndTime = null;
      let success = true;
      let failStage = '';
      let failReason = '';
      let requiresReboot = false;
      dispatch(actions.setPlaybackState({ currentType: 'test', currentIndex: cursor,
        currentListIndex: item.listIndex, currentAudioId: item.audio.id }));
      setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · ${item.audio.text}`);
      logInput('ai_toy.test_audio.play.start', { cursor, caseId, audioId: item.audio.id });
      try {
        await playAudioItem(item.audio, ttsService, defaultVoiceConfig, {
          onStart: () => {
            if (testAudioStarted) return;
            testAudioStarted = true;
            if (!firstTestAudioTimeRef.current) {
              firstTestAudioTimeRef.current = Date.now();
              dispatch(actions.setReport({ firstTestAudioTime: firstTestAudioTimeRef.current }));
            }
            logInput('ai_toy.test_audio.play.started', { cursor, caseId });
          },
        });
        playEndTime = Date.now();
        lastTestAudioTimeRef.current = playEndTime;
        dispatch(actions.setReport({ lastTestAudioTime: playEndTime }));
        logInput('ai_toy.test_audio.play.completed', { cursor, caseId });
      } catch (error) {
        success = false;
        failStage = 'AI_TOY_TEST_AUDIO';
        failReason = error?.message || 'AI玩具测试音频播放失败';
      }
      if (shouldStop()) return;
      if (success) {
        dispatch(actions.setPlaybackState({ currentType: 'response-detect' }));
        setCurrentAudioText('AI玩具正在响应，等待播完并开始收音');
        // ASR and response evaluation toggles never disable the device readiness gate.
        const response = await waitForSession(current => current.ready || current.interrupted, { turnTimeout: true });
        if (shouldStop()) return;
        if (!response) {
          success = false;
          requiresReboot = true;
          const hasInputEvidence = sessionState.inputDetected || sessionState.firstAudioDetected || sessionState.playbackDone;
          failStage = !hasInputEvidence ? 'AI_TOY_INPUT_TIMEOUT'
            : sessionState.playbackDone ? 'AI_TOY_LISTENING_TIMEOUT' : 'AI_TOY_RESPONSE_TIMEOUT';
          failReason = !hasInputEvidence ? '测试音频已播放，但超时未检测到设备输入或回复'
            : sessionState.playbackDone ? '回复已播完，但超时未恢复收音'
              : '设备回复超时，未检测到完整播报';
        }
      }
      const interrupted = Boolean(sessionState.interrupted);
      if (interrupted) {
        success = false;
        failStage = 'AI_TOY_INTERRUPTED';
        failReason = sessionState.interruptionReason || 'AI玩具会话被中断';
        if (/WS response timeout \(no_tts_start\)/i.test(failReason) && !sessionState.wakeable) {
          requiresReboot = true;
        }
      }
      const inputEnabled = Boolean(testOptions.autonomousInput?.enabled);
      const inputChainPassed = !inputEnabled || Boolean(sessionState.inputDetected);
      const responseChainPassed = Boolean(sessionState.ready && !interrupted);
      const asrResult = { actualAsrText: sessionState.actualAsrText || '',
        status: sessionState.inputDetected ? 'success' : 'not_detected',
        matchedLine: sessionState.asrMatchedLine || '' };
      const asrMatchResult = !inputEnabled ? 'not_checked' : sessionState.inputDetected ? 'matched' : 'marker_failed';
      const asrSimilarity = asrResult.actualAsrText ? textSimilarity(asrResult.actualAsrText, item.audio.text) : null;
      const responseLogResult = { status: responseChainPassed ? 'completed' : sessionState.phase,
        vadStarted: sessionState.firstAudioDetected, vadEnded: sessionState.playbackDone,
        matchedLine: sessionState.listeningLine || '' };
      if (success && !inputChainPassed) {
        success = false;
        failStage = 'AI_TOY_ASR';
        failReason = 'AI玩具已回到收音状态，但未检测到 Cedar: Input Text';
      }
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
      logResponse('ai_toy.turn.result', { cursor, caseId, success: finalSuccess, failStage, failReason });
      notify(interrupted ? 'AI_TOY_INTERRUPTED' : 'AI_TOY_TURN_RESULT', [
        `进度：${cursor + 1}/${queue.length}`, `结果：${finalSuccess ? '通过' : '失败'}`,
        ...(failReason ? [`原因：${failReason}`] : []),
        ...(interrupted ? [`当前已重试：${Number(item.retryCount || 0)} 次`] : []),
      ]);
      if (interrupted || requiresReboot) {
        if (requiresReboot || Number(item.retryCount || 0) >= MAX_TURN_RETRIES) {
          if (fallbackRebootUsed) {
            throw new Error(`AI玩具重启恢复后仍${requiresReboot ? '异常' : '中断'}，已停止测试：${failReason}`);
          }
          fallbackRebootUsed = true;
          await rebootAndReconnect(cursor, caseId, failReason);
          if (shouldStop()) return;
        }
        queue[cursor] = buildRetryQueueItem(item, { failureEvent: failStage, failureLog: failReason });
        logWake('ai_toy.retry.same_turn', { cursor, failStage, failReason,
          retryCount: queue[cursor].retryCount });
        cursor -= 1;
      } else if (!playEndTime) {
        // A playback error is not permission to wake or play another test over the device.
        throw new Error(failReason);
      }
    }
    if (shouldStop()) return;
    dispatch(actions.completeReport());
    isPlayingRef.current = false;
    isPausedRef.current = false;
  } catch (error) {
    if (shouldStop()) return;
    if (rebootInProgress) notify('AI_TOY_REBOOT_FAILED', [error?.message || '恢复未完成']);
    throw error;
  } finally {
    if (sessionId) {
      // Cleanup must still run when the test's AbortSignal is already aborted.
      try {
        await closeSession();
      } catch (error) {
        logWake('ai_toy.session.close.error', { sessionId, message: error.message });
      }
    }
    if (serialLogs.length) {
      dispatch(actions.setReport({
        aiToySerialLog: { runId: reportRunId, serialLog: serialLogs.join('') },
      }));
    }
  }
  notificationCaseId = undefined;
  notify('TEST_COMPLETED', [`执行总数：${queue.length}`, `完成数量：${completedCases}`,
    `通过数量：${passedCases}`, `失败数量：${failedCases}`]);
  onTestComplete?.();
}
