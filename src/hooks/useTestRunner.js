/**
 * 测试执行 Hook - 从 PlaybackConsole 抽离测试编排逻辑
 */
import { useState, useRef, useCallback } from 'react';
import { useTest, actions } from '../stores/testStore';
import ttsService from '../services/ttsService.jsx';
import adbWakeService from '../services/adbWakeService';
import responseMonitorService from '../services/responseMonitorService';
import { playAudioItem } from '../utils/audioHelpers';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const POST_REBOOT_WAKE_RETRY_DELAY_MS = 120000;
const POST_WAKE_TEST_AUDIO_GAP_MS = 800;
const POST_WAKE_TTS_QUEUE_RESET_MS = 180;
const TEST_AUDIO_START_TIMEOUT_MS = 10000;
const RESPONSE_END_MAX_WAIT_MS = 120000;
const RESPONSE_END_WAKE_GUARD_MS = 3000;

const numberOrDefault = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function buildResponseRuntimeConfig(config = {}, item = {}) {
  const responseWindowMs = numberOrDefault(config.responseWindowMs, 15000);
  const maxRecordMs = numberOrDefault(config.maxRecordMs, RESPONSE_END_MAX_WAIT_MS);
  // Keep browser recording and ADB response-log waiting on the same timeout policy.
  const responseMaxWaitMs = Math.max(
    responseWindowMs,
    numberOrDefault(config.responseMaxWaitMs, RESPONSE_END_MAX_WAIT_MS),
    maxRecordMs
  );
  const afterFinishCooldownMs = Math.max(
    0,
    numberOrDefault(config.afterFinishCooldownMs, RESPONSE_END_WAKE_GUARD_MS)
  );
  const targetText = item.audio?.text || '';

  return {
    targetText,
    afterFinishCooldownMs,
    responseMaxWaitMs,
    responseWindowMs,
    monitorOptions: {
      deviceId: config.microphoneDeviceId || '',
      responseWindowMs,
      targetText,
      promptText: targetText,
      expectedTtsText: item.audio?.expectedResponseText || item.audio?.expectedTtsText || '',
      silenceMs: numberOrDefault(config.silenceMs, 1200),
      minDurationMs: numberOrDefault(config.minDurationMs, 500),
      noiseThreshold: numberOrDefault(config.noiseThreshold, 0.02),
      preRollMs: numberOrDefault(config.preRollMs, 1500),
      postRollMs: numberOrDefault(config.postRollMs, 1000),
      replyStartTimeoutMs: numberOrDefault(config.replyStartTimeoutMs, 20000),
      charsPerSecond: numberOrDefault(config.charsPerSecond, 4.2),
      durationBufferRatio: numberOrDefault(config.durationBufferRatio, 0.35),
      minProtectRatio: numberOrDefault(config.minProtectRatio, 0.75),
      minProtectMs: numberOrDefault(config.minProtectMs, 10000),
      maxRecordMs: maxRecordMs || responseMaxWaitMs,
      shortTextSilenceEndMs: numberOrDefault(config.shortTextSilenceEndMs, 2000),
      longTextSilenceEndMs: numberOrDefault(config.longTextSilenceEndMs, 3500),
      veryLongTextSilenceEndMs: numberOrDefault(config.veryLongTextSilenceEndMs, 5000),
      afterFinishCooldownMs,
      language: config.language || 'zh-CN'
    }
  };
}

function waitForAudioStart(getStarted, timeoutMs) {
  return new Promise((_, reject) => {
    const timeoutId = setTimeout(() => {
      if (!getStarted()) {
        reject(new Error(`测试音频 ${timeoutMs}ms 内未开始播放`));
      }
    }, timeoutMs);

    if (typeof timeoutId.unref === 'function') {
      timeoutId.unref();
    }
  });
}

function createStageError(stage, message) {
  const error = new Error(message);
  error.stage = stage;
  return error;
}

const pad = (value) => String(value).padStart(2, '0');

const createReportRunId = () => {
  const now = new Date();
  return [
    'RUN_',
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
};

const resolveAudioCaseId = (audio, index) => {
  if (audio?.caseId || audio?.case_id) return audio.caseId || audio.case_id;
  if (audio?.tapdCaseId && audio?.humanIndex) return `${audio.tapdCaseId}_${audio.humanIndex}`;
  if (audio?.tapdCaseId) return audio.tapdCaseId;
  return audio?.id || `case_${index + 1}`;
};

const buildQueue = (audios, loopCount) => {
  const queue = [];
  for (let round = 0; round < loopCount; round++) {
    for (let i = 0; i < audios.length; i++) {
      queue.push({
        audio: audios[i],
        listIndex: i,
        round: round + 1,
        totalRounds: loopCount
      });
    }
  }
  return queue;
};

const logWake = (stage, payload = {}) => {
  const detail = {
    id: `process_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'WAKE',
    stage,
    time: new Date().toISOString(),
    ...payload
  };
  console.log(`[VoiceAuto][WAKE] ${stage}`, detail);
  window.dispatchEvent(new CustomEvent('voiceauto-process-log', { detail }));
};

const parseWakeKeywords = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeComparableText = (value) => (
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
);

const levenshteinDistance = (left, right) => {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  const curr = new Array(right.length + 1);

  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= right.length; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[right.length];
};

const textSimilarity = (left, right) => {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);
  const maxLen = Math.max(normalizedLeft.length, normalizedRight.length);
  if (!maxLen) return 0;
  return Math.max(0, 1 - (levenshteinDistance(normalizedLeft, normalizedRight) / maxLen));
};

const parseListConfig = parseWakeKeywords;

const logInput = (stage, payload = {}) => {
  const detail = {
    id: `process_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'INPUT',
    stage,
    time: new Date().toISOString(),
    ...payload
  };
  console.log(`[VoiceAuto][INPUT] ${stage}`, detail);
  window.dispatchEvent(new CustomEvent('voiceauto-process-log', { detail }));
};

const logResponse = (stage, payload = {}) => {
  const detail = {
    id: `process_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'RESPONSE',
    stage,
    time: new Date().toISOString(),
    ...payload
  };
  console.log(`[VoiceAuto][RESPONSE] ${stage}`, detail);
  window.dispatchEvent(new CustomEvent('voiceauto-process-log', { detail }));
};

export default function useTestRunner({ onTestComplete } = {}) {
  const { state, dispatch } = useTest();
  const { wakeWord, testAudios, playback, defaultVoiceConfig, testOptions } = state;

  const playableAudios = testAudios.filter((audio) => {
    const generated = audio.audioStatus ? audio.audioStatus === 'generated' : true;
    const moduleMatched = (testOptions.selectedTestModule || 'all') === 'all'
      ? true
      : (audio.module || '未分类') === testOptions.selectedTestModule;
    return generated && moduleMatched;
  });

  const totalCases = playableAudios.length * (testOptions.loopCount || 1);

  const [currentAudioText, setCurrentAudioText] = useState('');
  const startTimeRef = useRef(null);
  const firstTestAudioTimeRef = useRef(null);
  const lastTestAudioTimeRef = useRef(null);
  const isPlayingRef = useRef(false);
  const isPausedRef = useRef(false);
  const runIdRef = useRef(0);
  const reportRunIdRef = useRef('');
  const wakeFailCountRef = useRef(0);
  const rebootCountRef = useRef(0);
  const abortControllerRef = useRef(null);

  const estimateRemainingTime = useCallback(() => {
    if (totalCases === 0 || playback.currentIndex < 0) return 0;
    const remainingCount = Math.max(0, totalCases - (playback.currentIndex + 1));
    const avgTimePerItem = 5000;
    return remainingCount * avgTimePerItem;
  }, [totalCases, playback.currentIndex]);

  const runTest = useCallback(async (runId) => {
    if (playableAudios.length === 0) {
      alert('当前模块暂无可测试音频，请先生成测试音频或切换模块');
      return;
    }

    const queue = buildQueue(playableAudios, testOptions.loopCount);
    const shouldStop = () => !isPlayingRef.current || runIdRef.current !== runId;

    const reportRunId = createReportRunId();
    reportRunIdRef.current = reportRunId;
    wakeFailCountRef.current = 0;
    rebootCountRef.current = 0;
    abortControllerRef.current = new AbortController();
    dispatch(actions.clearProcessLogs());
    logWake('run.start', {
      runId: reportRunId,
      autonomousWake: testOptions.autonomousWake || {},
      autonomousResponse: testOptions.autonomousResponse || {},
      queueLength: queue.length
    });

    const ensureSpeakerWakeup = async (item, cursor) => {
      const config = testOptions.autonomousWake || {};
      const autonomousWakeEnabled = Boolean(config.enabled);
      const wakeKeywords = parseWakeKeywords(config.keywords);
      const caseRebootCountRef = { current: 0 };
      let lastRebootResult = '';

      while (!shouldStop()) {
        const wakeAudioPlayStartTime = Date.now();
        let wakeAudioPlayEndTime = null;
        let wakeAudioPlayStatus = 'playing';
        let failReason = '';
        let detectPromise = null;

        dispatch(actions.setPlaybackState({
          currentIndex: cursor,
          currentListIndex: item.listIndex,
          currentAudioId: item.audio.id,
          currentType: 'wake'
        }));
        setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · 唤醒词: ${wakeWord.text}`);
        logWake('attempt.start', {
          cursor,
          round: item.round,
          audioId: item.audio.id,
          autonomousWakeEnabled,
          bridgeUrl: config.bridgeUrl,
          deviceId: config.deviceId || '<default>',
          detectionTimeoutMs: config.detectionTimeoutMs,
          keywords: wakeKeywords,
          wakeFailCount: wakeFailCountRef.current
        });

        if (autonomousWakeEnabled) {
          dispatch(actions.setPlaybackState({ currentType: 'wake-detect' }));
          logWake('detect.start.before_audio', {
            cursor,
            timeoutMs: (Number(config.detectionTimeoutMs) || 5000) + 3000
          });
          detectPromise = adbWakeService.detectWakeup({
            bridgeUrl: config.bridgeUrl,
            deviceId: config.deviceId,
            keywords: wakeKeywords.length ? wakeKeywords : undefined,
            timeoutMs: (Number(config.detectionTimeoutMs) || 5000) + 3000,
            signal: abortControllerRef.current?.signal
          }).catch((err) => ({ __error: err }));
          dispatch(actions.setPlaybackState({ currentType: 'wake' }));
        } else {
          logWake('detect.skipped.disabled', { cursor });
        }

        try {
          logWake('wake_audio.play.start', {
            cursor,
            text: wakeWord.text
          });
          await ttsService.speak(wakeWord.text, {
            voiceName: defaultVoiceConfig.voiceName,
            lang: defaultVoiceConfig.lang,
            volume: 200,
            rate: defaultVoiceConfig.rate
          });
          wakeAudioPlayStatus = 'completed';
          wakeAudioPlayEndTime = Date.now();
          logWake('wake_audio.play.completed', {
            cursor,
            durationMs: wakeAudioPlayEndTime - wakeAudioPlayStartTime
          });
        } catch (err) {
          wakeAudioPlayStatus = 'error';
          wakeAudioPlayEndTime = Date.now();
          failReason = err?.message || '唤醒音频播放失败';
          console.error('Wake word playback failed:', err);
          logWake('wake_audio.play.error', {
            cursor,
            message: failReason
          });
        }

        if (shouldStop()) return null;

        if (!autonomousWakeEnabled) {
          logWake('attempt.finish.fixed_delay_mode', {
            cursor,
            wakeAudioPlayStatus
          });
          return {
            wake_audio_play_status: wakeAudioPlayStatus,
            wake_audio_play_start_time: wakeAudioPlayStartTime,
            wake_audio_play_end_time: wakeAudioPlayEndTime,
            speaker_wake_status: 'not_detected',
            wake_event_time: null,
            wake_fail_count: wakeFailCountRef.current,
            adb_reboot_triggered: false,
            adb_reboot_result: '',
            fail_stage: wakeAudioPlayStatus === 'error' ? 'wake_audio_play' : '',
            fail_reason: failReason
          };
        }

        if (wakeAudioPlayStatus === 'error') {
          wakeFailCountRef.current += 1;
          logWake('detect.skip.audio_error', {
            cursor,
            wakeFailCount: wakeFailCountRef.current
          });
        } else {
          dispatch(actions.setPlaybackState({ currentType: 'wake-detect' }));
          setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · 正在检测 WakeupSuccess`);

          try {
            const detectResult = await detectPromise;
            if (detectResult?.__error) {
              throw detectResult.__error;
            }
            logWake('detect.result', {
              cursor,
              success: detectResult.success,
              matchedKeyword: detectResult.matchedKeyword,
              matchedLine: detectResult.matchedLine,
              sampleLines: detectResult.sampleLines
            });

            if (detectResult.success) {
              wakeFailCountRef.current = 0;
              logWake('attempt.success', {
                cursor,
                wakeEventTime: detectResult.eventTime,
                matchedKeyword: detectResult.matchedKeyword,
                matchedLine: detectResult.matchedLine
              });
              return {
                wake_audio_play_status: wakeAudioPlayStatus,
                wake_audio_play_start_time: wakeAudioPlayStartTime,
                wake_audio_play_end_time: wakeAudioPlayEndTime,
                speaker_wake_status: 'success',
                wake_event_time: detectResult.eventTime,
                wake_fail_count: 0,
                adb_reboot_triggered: caseRebootCountRef.current > 0,
                adb_reboot_result: lastRebootResult,
                fail_stage: '',
                fail_reason: '',
                wake_matched_keyword: detectResult.matchedKeyword,
                wake_matched_line: detectResult.matchedLine
              };
            }

            wakeFailCountRef.current += 1;
            const sampleHint = detectResult.sampleLines?.length
              ? `；ADB实时日志采样: ${detectResult.sampleLines.slice(-3).join(' | ')}`
              : '';
            failReason = `检测超时，未发现 WakeupSuccess 日志${sampleHint}`;
            logWake('attempt.failed.no_match', {
              cursor,
              wakeFailCount: wakeFailCountRef.current,
              failReason
            });
          } catch (err) {
            wakeFailCountRef.current += 1;
            failReason = err?.message || 'WakeupSuccess 检测失败';
            console.error('Wakeup detection failed:', err);
            logWake('detect.error', {
              cursor,
              wakeFailCount: wakeFailCountRef.current,
              message: failReason
            });
          }
        }

        const failureThreshold = 5;
        if (wakeFailCountRef.current < failureThreshold) {
          logWake('attempt.retry', {
            cursor,
            wakeFailCount: wakeFailCountRef.current,
            failureThreshold
          });
          setCurrentAudioText(
            `唤醒失败 ${wakeFailCountRef.current}/${failureThreshold}，准备重试当前用例`
          );
          await wait(500);
          continue;
        }

        const maxRebootsPerCase = Math.max(0, Number(config.maxRebootsPerCase) || 0);
        const maxRebootsPerRun = Math.max(0, Number(config.maxRebootsPerRun) || 0);
        if (caseRebootCountRef.current >= maxRebootsPerCase || rebootCountRef.current >= maxRebootsPerRun) {
          const wakeFailureMessage = `唤醒失败 ${wakeFailCountRef.current}/${failureThreshold}，已达到 ADB 重启上限：${failReason}`;
          dispatch(actions.setPlaybackState({
            currentType: 'wake-failed',
            status: 'failed',
            isPlaying: false,
            isPaused: false
          }));
          setCurrentAudioText(wakeFailureMessage);
          logWake('attempt.failed.reboot_limit', {
            cursor,
            wakeFailCount: wakeFailCountRef.current,
            failureThreshold,
            caseRebootCount: caseRebootCountRef.current,
            runRebootCount: rebootCountRef.current,
            failReason
          });
          const error = new Error(wakeFailureMessage);
          error.stage = 'WAKE_FAILED';
          throw error;
        }

        dispatch(actions.setPlaybackState({ currentType: 'reboot' }));
        setCurrentAudioText(`唤醒失败 ${wakeFailCountRef.current}/${failureThreshold}，正在重启 Speaker`);
        logWake('reboot.start', {
          cursor,
          wakeFailCount: wakeFailCountRef.current,
          failureThreshold,
          caseRebootCount: caseRebootCountRef.current,
          runRebootCount: rebootCountRef.current
        });

        let rebootResult;
        try {
          rebootResult = await adbWakeService.rebootSpeaker({
            bridgeUrl: config.bridgeUrl,
            deviceId: config.deviceId,
            recoveryTimeoutMs: config.recoveryTimeoutMs,
            signal: abortControllerRef.current?.signal
          });
        } catch (err) {
          const rebootFailReason = `ADB 重启失败：${err?.message || err}`;
          dispatch(actions.setPlaybackState({
            currentType: 'wake-failed',
            status: 'failed',
            isPlaying: false,
            isPaused: false
          }));
          setCurrentAudioText(rebootFailReason);
          logWake('reboot.failed', {
            cursor,
            message: rebootFailReason
          });
          const error = new Error(rebootFailReason);
          error.stage = 'WAKE_FAILED';
          throw error;
        }

        rebootCountRef.current += 1;
        caseRebootCountRef.current += 1;
        wakeFailCountRef.current = 0;

        if (!rebootResult.success || !rebootResult.bootCompleted) {
          const rebootFailReason = rebootResult.message || 'Speaker 重启后未恢复';
          dispatch(actions.setPlaybackState({
            currentType: 'wake-failed',
            status: 'failed',
            isPlaying: false,
            isPaused: false
          }));
          setCurrentAudioText(rebootFailReason);
          logWake('reboot.failed', {
            cursor,
            rebootResult
          });
          const error = new Error(rebootFailReason);
          error.stage = 'WAKE_FAILED';
          throw error;
        }

        lastRebootResult = rebootResult.message || 'reboot_recovered';
        logWake('reboot.recovered', {
          cursor,
          rebootResult,
          nextWakeRetryDelayMs: POST_REBOOT_WAKE_RETRY_DELAY_MS
        });
        dispatch(actions.setPlaybackState({ currentType: 'reboot-wait' }));
        setCurrentAudioText('Speaker 已重启恢复，等待 2 分钟后重新唤醒当前用例');
        logWake('reboot.wait_before_retry.start', {
          cursor,
          delayMs: POST_REBOOT_WAKE_RETRY_DELAY_MS
        });
        await wait(POST_REBOOT_WAKE_RETRY_DELAY_MS);
        logWake('reboot.wait_before_retry.end', {
          cursor
        });
        continue;
      }

      return null;
    };

    dispatch(actions.startPlayback(reportRunId));
    isPlayingRef.current = true;
    isPausedRef.current = false;
    startTimeRef.current = Date.now();
    firstTestAudioTimeRef.current = null;
    lastTestAudioTimeRef.current = null;

    try {
      for (let cursor = 0; cursor < queue.length; cursor++) {
        if (shouldStop()) return;

        while (isPausedRef.current) {
          await wait(100);
          if (shouldStop()) return;
        }

        const item = queue[cursor];

        const wakeResult = await ensureSpeakerWakeup(item, cursor);

        if (shouldStop()) return;

        // 自主监测开启时，监听到唤醒成功后直接播放测试音频。
        const autonomousWakeEnabled = Boolean(testOptions.autonomousWake?.enabled);
        logWake('post_wake.route', {
          cursor,
          autonomousWakeEnabled,
          speakerWakeStatus: wakeResult?.speaker_wake_status,
          fixedDelayMs: wakeWord.wakeAfterDelay,
          willUseFixedDelay: !autonomousWakeEnabled
        });
        if (!autonomousWakeEnabled) {
          dispatch(actions.setPlaybackState({ currentType: 'delay' }));
          await wait(wakeWord.wakeAfterDelay);
        } else {
          dispatch(actions.setPlaybackState({ currentType: 'test-ready' }));
          setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · Speaker 已唤醒，播放测试音频`);
          logWake('post_wake.ready_to_play_test_audio', {
            cursor,
            wakeAudioPlayStatus: wakeResult?.wake_audio_play_status,
            wakeAudioPlayEndTime: wakeResult?.wake_audio_play_end_time,
            wakeEventTime: wakeResult?.wake_event_time,
            testAudioGapMs: POST_WAKE_TEST_AUDIO_GAP_MS
          });
          await wait(POST_WAKE_TEST_AUDIO_GAP_MS);
        }

        if (shouldStop()) return;

        // 播放测试音频
        ttsService.stopAudio();
        logInput('test_audio.prepare.after_wake', {
          cursor,
          audioId: item.audio.id,
          targetText: item.audio.text,
          resetDelayMs: POST_WAKE_TTS_QUEUE_RESET_MS
        });
        await wait(POST_WAKE_TTS_QUEUE_RESET_MS);

        if (shouldStop()) return;

        dispatch(actions.setPlaybackState({
          currentIndex: cursor,
          currentListIndex: item.listIndex,
          currentAudioId: item.audio.id,
          currentType: 'test'
        }));
        setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · ${item.audio.text}`);

        if (!firstTestAudioTimeRef.current) {
          firstTestAudioTimeRef.current = Date.now();
          dispatch(actions.setReport({ firstTestAudioTime: firstTestAudioTimeRef.current }));
        }

        if (testOptions.debugSequence) {
          console.log(
            `[VoiceAuto][SEQ] ${item.round}-${item.listIndex + 1} | ${cursor + 1}/${queue.length} | ${item.audio.text}`
          );
        }

        let success = true;
        let failStage = '';
        let failReason = '';
        let asrResult = null;
        let asrMatchResult = 'not_checked';
        let asrSimilarity = null;
        let inputChainPassed = null;
        let responseResult = null;
        let responseLogResult = null;
        let responseChainPassed = null;
        let responseTextSimilarity = null;
        let testAudioStarted = false;
        const autonomousInputConfig = testOptions.autonomousInput || {};
        const autonomousInputEnabled = Boolean(autonomousInputConfig.enabled);
        const autonomousResponseConfig = testOptions.autonomousResponse || {};
        const autonomousResponseEnabled = Boolean(autonomousResponseConfig.enabled);
        const asrKeywords = parseListConfig(autonomousInputConfig.asrKeywords);
        const asrStartKeywords = parseListConfig(autonomousInputConfig.asrStartKeywords);
        const asrEndKeywords = parseListConfig(autonomousInputConfig.asrEndKeywords || autonomousInputConfig.asrKeywords);
        const asrFailureKeywords = parseListConfig(autonomousInputConfig.asrFailureKeywords);
        const asrPatterns = parseListConfig(autonomousInputConfig.asrPatterns);
        const caseId = resolveAudioCaseId(item.audio, item.listIndex);
        const playStartTime = Date.now();
        let asrDetectPromise = null;
        let responseDetectPromise = null;
        let responseLogDetectPromise = null;

        if (autonomousInputEnabled) {
          dispatch(actions.setPlaybackState({ currentType: 'asr-detect' }));
          logInput('asr.detect.start.before_audio', {
            cursor,
            caseId,
            targetText: item.audio.text,
            timeoutMs: Number(autonomousInputConfig.asrDetectionTimeoutMs) || 8000,
            startKeywords: asrStartKeywords,
            endKeywords: asrEndKeywords.length ? asrEndKeywords : asrKeywords,
            failureKeywords: asrFailureKeywords,
            patterns: asrPatterns
          });
          asrDetectPromise = adbWakeService.detectAsr({
            bridgeUrl: testOptions.autonomousWake?.bridgeUrl,
            deviceId: testOptions.autonomousWake?.deviceId,
            timeoutMs: Number(autonomousInputConfig.asrDetectionTimeoutMs) || 8000,
            keywords: asrKeywords.length ? asrKeywords : undefined,
            startKeywords: asrStartKeywords.length ? asrStartKeywords : undefined,
            endKeywords: asrEndKeywords.length ? asrEndKeywords : undefined,
            failureKeywords: asrFailureKeywords.length ? asrFailureKeywords : undefined,
            patterns: asrPatterns,
            signal: abortControllerRef.current?.signal
          });
          dispatch(actions.setPlaybackState({ currentType: 'test' }));
        }

        try {
          logInput('test_audio.play.start', {
            cursor,
            caseId,
            audioId: item.audio.id,
            text: item.audio.text,
            source: item.audio.source,
            hasAudioUrl: Boolean(item.audio.audioUrl),
            autonomousInputEnabled,
            startTimeoutMs: TEST_AUDIO_START_TIMEOUT_MS
          });
          const playPromise = playAudioItem(item.audio, ttsService, defaultVoiceConfig, {
            onStart: () => {
              if (testAudioStarted) return;
              testAudioStarted = true;
              logInput('test_audio.play.started', {
                cursor,
                caseId,
                audioId: item.audio.id,
                targetText: item.audio.text,
                source: item.audio.source
              });
            }
          });
          await Promise.race([
            playPromise,
            waitForAudioStart(() => testAudioStarted, TEST_AUDIO_START_TIMEOUT_MS)
          ]);
        } catch (err) {
          success = false;
          failStage = 'TEST_AUDIO_PLAY';
          failReason = err?.message || '测试音频播放失败';
          dispatch(actions.setPlaybackState({ currentType: 'test-failed' }));
          setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · 测试音频播放失败：${failReason}`);
          console.error('Audio playback failed:', err);
          logInput('test_audio.play.error', {
            cursor,
            caseId,
            targetText: item.audio.text,
            message: failReason,
            testAudioStarted
          });
          ttsService.stopAudio();
          throw createStageError('TEST_AUDIO_FAILED', failReason);
        }
        const playEndTime = Date.now();
        logInput('test_audio.play.completed', {
          cursor,
          caseId,
          targetText: item.audio.text,
          success,
          durationMs: playEndTime - playStartTime
        });

        if (autonomousResponseEnabled && success) {
          dispatch(actions.setPlaybackState({ currentType: 'response-detect' }));
          setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · 正在采集 Speaker 响应`);
          // Normalize once per case so audio VAD, ADB VAD, and the final wake guard share one policy.
          const responseRuntimeConfig = buildResponseRuntimeConfig(autonomousResponseConfig, item);
          const { monitorOptions, responseMaxWaitMs, afterFinishCooldownMs } = responseRuntimeConfig;
          logResponse('response.detect.start.after_test_audio', {
            cursor,
            caseId,
            targetText: item.audio.text,
            testAudioPlayEndTime: playEndTime,
            startImmediately: true,
            responseWindowMs: monitorOptions.responseWindowMs,
            responseMaxWaitMs,
            silenceMs: monitorOptions.silenceMs,
            minDurationMs: monitorOptions.minDurationMs,
            noiseThreshold: monitorOptions.noiseThreshold,
            preRollMs: monitorOptions.preRollMs,
            postRollMs: monitorOptions.postRollMs,
            replyStartTimeoutMs: monitorOptions.replyStartTimeoutMs,
            charsPerSecond: monitorOptions.charsPerSecond,
            minProtectMs: monitorOptions.minProtectMs,
            maxRecordMs: monitorOptions.maxRecordMs,
            longTextSilenceEndMs: monitorOptions.longTextSilenceEndMs,
            afterFinishCooldownMs,
            language: monitorOptions.language
          });

          responseDetectPromise = responseMonitorService.detectSpeakerResponse({
            ...monitorOptions,
            signal: abortControllerRef.current?.signal,
            onLog: (stage, payload = {}) => logResponse(stage, {
              cursor,
              caseId,
              targetText: item.audio.text,
              ...payload
            })
          }).catch((err) => ({ __error: err }));

          responseLogDetectPromise = adbWakeService.detectSpeakerResponseLog({
            bridgeUrl: testOptions.autonomousWake?.bridgeUrl,
            deviceId: testOptions.autonomousWake?.deviceId,
            timeoutMs: monitorOptions.responseWindowMs,
            maxWaitMs: responseMaxWaitMs,
            signal: abortControllerRef.current?.signal
          }).catch((err) => ({ __error: err }));
        }

        if (autonomousInputEnabled) {
          dispatch(actions.setPlaybackState({ currentType: 'asr-detect' }));
          setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · 正在检测 Speaker ASR 输入`);
          try {
            asrResult = await asrDetectPromise;
            const actualAsrText = asrResult.actualAsrText || '';
            asrSimilarity = actualAsrText ? textSimilarity(actualAsrText, item.audio.text) : 0;
            const threshold = Math.max(0, Math.min(1, Number(autonomousInputConfig.asrSimilarityThreshold) || 0.8));
            if (!asrResult.success) {
              success = false;
              failStage = failStage || 'ADB_ASR';
              failReason = failReason || asrResult.message || '未检测到 ASR 开始/结束成功标识，或检测到 ASR 失败标识';
            }
            asrMatchResult = actualAsrText
              ? (asrSimilarity >= threshold ? 'matched' : 'not_matched')
              : (asrResult.success ? 'marker_success_no_text' : 'marker_failed');
            inputChainPassed = Boolean(success && asrResult.success);

            logInput('asr.detect.result', {
              cursor,
              caseId,
              success: asrResult.success,
              status: asrResult.status,
              actualAsrText,
              targetText: item.audio.text,
              similarity: asrSimilarity,
              threshold,
              asrMatchResult,
              matchedKeyword: asrResult.matchedKeyword,
              matchedLine: asrResult.matchedLine,
              startDetected: asrResult.startDetected,
              startMatchedKeyword: asrResult.startMatchedKeyword,
              startMatchedLine: asrResult.startMatchedLine,
              startEventTime: asrResult.startEventTime,
              endMatchedKeyword: asrResult.endMatchedKeyword,
              endMatchedLine: asrResult.endMatchedLine,
              endEventTime: asrResult.endEventTime,
              failureMatchedKeyword: asrResult.failureMatchedKeyword,
              failureMatchedLine: asrResult.failureMatchedLine,
              message: asrResult.message,
              sampleLines: asrResult.sampleLines
            });
          } catch (err) {
            success = false;
            inputChainPassed = false;
            asrMatchResult = 'error';
            failStage = failStage || 'ADB_ASR';
            failReason = failReason || (err?.message || 'ADB ASR 检测失败');
            logInput('asr.detect.error', {
              cursor,
              caseId,
              targetText: item.audio.text,
              message: failReason
            });
          }
        } else {
          inputChainPassed = success;
        }

        if (responseDetectPromise) {
          dispatch(actions.setPlaybackState({ currentType: 'response-detect' }));
          setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · 正在汇总 Speaker 响应结果`);
          const responseOutcome = await responseDetectPromise;
          if (responseOutcome?.__error) {
            const err = responseOutcome.__error;
            success = false;
            responseChainPassed = false;
            failStage = failStage || 'RESPONSE_AUDIO_RECORD';
            failReason = failReason || (err?.message || 'Speaker 响应监测失败');
            logResponse('response.detect.error', {
              cursor,
              caseId,
              targetText: item.audio.text,
              message: failReason
            });
          } else {
            responseResult = responseOutcome;
            logResponse('response.detect.result', {
              cursor,
              caseId,
              targetText: item.audio.text,
              success: responseResult.success,
              responseAudioDetected: responseResult.responseAudioDetected,
              responseAudioFile: responseResult.responseAudioFile,
              responseTtsAudioFile: responseResult.responseTtsAudioFile || responseResult.responseAudioFile,
              responseAudioStartTime: responseResult.responseAudioStartTime,
              responseAudioEndTime: responseResult.responseAudioEndTime,
              responseAudioDuration: responseResult.responseAudioDuration,
              responseAudioSegmentStartTime: responseResult.responseAudioSegmentStartTime,
              responseAudioSegmentEndTime: responseResult.responseAudioSegmentEndTime,
              responseAudioSegmentDuration: responseResult.responseAudioSegmentDuration,
              responseAsrStatus: responseResult.responseAsrStatus,
              responseAsrText: responseResult.responseAsrText,
              speakerOutputStatus: responseResult.speakerOutputStatus,
              responseFailStage: responseResult.responseFailStage,
              responseFailReason: responseResult.responseFailReason,
              peakRms: responseResult.peakRms,
              noiseFloor: responseResult.noiseFloor,
              dynamicThreshold: responseResult.dynamicThreshold,
              sampleRate: responseResult.sampleRate,
              speakerState: responseResult.speakerState,
              finishReason: responseResult.finishReason,
              ttsTextLength: responseResult.ttsTextLength,
              estimatedTtsDurationMs: responseResult.estimatedTtsDurationMs,
              minProtectMs: responseResult.minProtectMs,
              maxRecordMs: responseResult.maxRecordMs,
              silenceEndMs: responseResult.silenceEndMs,
              finalSilenceMs: responseResult.finalSilenceMs,
              suspectedTruncated: responseResult.suspectedTruncated,
              speechRecognitionSupported: responseResult.speechRecognitionSupported
            });
          }

          if (responseLogDetectPromise) {
            const logOutcome = await responseLogDetectPromise;
            if (logOutcome?.__error) {
              logResponse('response.adb.detect.error', {
                cursor,
                caseId,
                targetText: item.audio.text,
                message: logOutcome.__error?.message || 'ADB 响应日志监听失败'
              });
            } else {
              responseLogResult = logOutcome;
              logResponse('response.adb.detect.result', {
                cursor,
                caseId,
                targetText: item.audio.text,
                success: responseLogResult.success,
                status: responseLogResult.status,
                vadStarted: responseLogResult.vadStarted,
                vadEnded: responseLogResult.vadEnded,
                vadStartTime: responseLogResult.vadStartTime,
                vadEndTime: responseLogResult.vadEndTime,
                speakerResponseText: responseLogResult.speakerResponseText,
                ttsMatchedLine: responseLogResult.ttsMatchedLine,
                message: responseLogResult.message,
                sampleLines: responseLogResult.sampleLines
              });
            }
          }

          const speakerResponseText = responseLogResult?.speakerResponseText || '';
          responseTextSimilarity = responseResult?.responseAsrText && speakerResponseText
            ? textSimilarity(responseResult.responseAsrText, speakerResponseText)
            : null;
          const responseAudioPassed = Boolean(responseResult?.success);
          const responseLogPassed = Boolean(
            responseLogResult?.vadStarted
            && responseLogResult?.vadEnded
            && speakerResponseText
          );
          responseChainPassed = Boolean(
            responseAudioPassed
            && responseLogPassed
          );
          if (!responseChainPassed) {
            success = false;
            failStage = failStage || responseResult?.responseFailStage || 'SPEAKER_OUTPUT';
            failReason = failReason
              || (responseAudioPassed ? '' : responseResult?.responseFailReason)
              || responseLogResult?.message
              || responseResult?.responseFailReason
              || '未等待到 Speaker 回复播放结束（缺少 VAD stop 或 TTS 文本）';
          }
        } else {
          responseChainPassed = autonomousResponseEnabled ? false : null;
          if (autonomousResponseEnabled) {
            logResponse('response.detect.skipped', {
              cursor,
              caseId,
              targetText: item.audio.text,
              reason: success ? '响应监听未启动' : '测试音频播放失败，跳过 Speaker 响应检测',
              autonomousInputEnabled,
              inputChainPassed
            });
          }
        }

        lastTestAudioTimeRef.current = playEndTime;
        dispatch(actions.setReport({ lastTestAudioTime: lastTestAudioTimeRef.current }));

        // 记录结果
        dispatch(actions.addReportCase({
          index: cursor,
          listIndex: item.listIndex,
          round: item.round,
          runId: reportRunIdRef.current,
          caseId,
          playIndex: cursor + 1,
          audioId: item.audio.id,
          audioFile: `${reportRunIdRef.current}_${caseId}.wav`,
          text: item.audio.text,
          targetText: item.audio.text,
          targetAgent: item.audio.targetAgent || item.audio.expectedAgent || '',
          tapdCaseId: item.audio.tapdCaseId || '',
          humanIndex: item.audio.humanIndex || '',
          playStartTime,
          playEndTime,
          success,
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
          adbRebootTriggered: Boolean(wakeResult?.adb_reboot_triggered),
          adbRebootResult: wakeResult?.adb_reboot_result || '',
          wakeFailStage: wakeResult?.fail_stage || '',
          wakeFailReason: wakeResult?.fail_reason || '',
          wakeMatchedKeyword: wakeResult?.wake_matched_keyword || '',
          wakeMatchedLine: wakeResult?.wake_matched_line || '',
          humanAudioText: item.audio.text,
          testAudioFile: item.audio.audioUrl || item.audio.audioFile || '',
          testAudioPlayStatus: playEndTime && success ? 'completed' : (failStage === 'TEST_AUDIO_PLAY' ? 'error' : 'completed'),
          testAudioPlayStartTime: playStartTime,
          testAudioPlayEndTime: playEndTime,
          testAudioActualDuration: playEndTime - playStartTime,
          testAudioExpectedDuration: item.audio.duration || 0,
          actualAsrText: asrResult?.actualAsrText || '',
          asrMatchResult,
          asrSimilarity,
          asrFailReason: autonomousInputEnabled && asrMatchResult !== 'matched' ? failReason : '',
          asrMatchedKeyword: asrResult?.matchedKeyword || '',
          asrMatchedLine: asrResult?.matchedLine || '',
          asrStatus: asrResult?.status || '',
          asrStartMatchedKeyword: asrResult?.startMatchedKeyword || '',
          asrStartMatchedLine: asrResult?.startMatchedLine || '',
          asrEndMatchedKeyword: asrResult?.endMatchedKeyword || '',
          asrEndMatchedLine: asrResult?.endMatchedLine || '',
          asrFailureMatchedKeyword: asrResult?.failureMatchedKeyword || '',
          asrFailureMatchedLine: asrResult?.failureMatchedLine || '',
          inputChainPassed,
          responseDetectStartTime: responseResult?.responseDetectStartTime || null,
          responseDetectEndTime: responseResult?.responseDetectEndTime || null,
          responseAudioDetected: Boolean(responseResult?.responseAudioDetected),
          responseAudioFile: responseResult?.responseAudioFile || '',
          responseAudioUrl: responseResult?.responseAudioUrl || '',
          responseAudioMimeType: responseResult?.responseAudioMimeType || '',
          responseAudioSize: responseResult?.responseAudioSize || 0,
          responseTtsText: responseLogResult?.speakerResponseText || '',
          responseTtsAudioFile: responseResult?.responseTtsAudioFile || responseResult?.responseAudioFile || '',
          responseTtsAudioUrl: responseResult?.responseTtsAudioUrl || responseResult?.responseAudioUrl || '',
          responseTtsAudioMimeType: responseResult?.responseTtsAudioMimeType || responseResult?.responseAudioMimeType || '',
          responseTtsAudioSize: responseResult?.responseTtsAudioSize || responseResult?.responseAudioSize || 0,
          responseAudioStartTime: responseResult?.responseAudioStartTime || null,
          responseAudioEndTime: responseResult?.responseAudioEndTime || null,
          responseAudioDuration: responseResult?.responseAudioDuration || 0,
          responseAudioSegmentStartTime: responseResult?.responseAudioSegmentStartTime || null,
          responseAudioSegmentEndTime: responseResult?.responseAudioSegmentEndTime || null,
          responseAudioSegmentDuration: responseResult?.responseAudioSegmentDuration || 0,
          responseAsrStatus: responseResult?.responseAsrStatus || '',
          responseAsrText: responseResult?.responseAsrText || '',
          responseTextSimilarity,
          speakerResponseText: responseLogResult?.speakerResponseText || '',
          responseTtsStatus: responseLogResult?.status || '',
          responseVadStarted: Boolean(responseLogResult?.vadStarted),
          responseVadEnded: Boolean(responseLogResult?.vadEnded),
          responseVadStartTime: responseLogResult?.vadStartTime || null,
          responseVadEndTime: responseLogResult?.vadEndTime || null,
          responseTtsMatchedLine: responseLogResult?.ttsMatchedLine || '',
          speakerOutputStatus: responseResult?.speakerOutputStatus || '',
          responseFailStage: responseResult?.responseFailStage || '',
          responseFailReason: responseResult?.responseFailReason || '',
          responsePeakRms: responseResult?.peakRms || 0,
          responseNoiseFloor: responseResult?.noiseFloor || 0,
          responseDynamicThreshold: responseResult?.dynamicThreshold || 0,
          responseSampleRate: responseResult?.sampleRate || 0,
          responseMicDeviceId: responseResult?.micDeviceId || autonomousResponseConfig.microphoneDeviceId || '',
          responseSpeakerState: responseResult?.speakerState || '',
          responseFinishReason: responseResult?.finishReason || '',
          responseTtsTextLength: responseResult?.ttsTextLength || 0,
          responseEstimatedTtsDurationMs: responseResult?.estimatedTtsDurationMs || 0,
          responseMinProtectMs: responseResult?.minProtectMs || 0,
          responseMaxRecordMs: responseResult?.maxRecordMs || 0,
          responseSilenceEndMs: responseResult?.silenceEndMs || 0,
          responseFinalSilenceMs: responseResult?.finalSilenceMs || 0,
          responseSuspectedTruncated: Boolean(responseResult?.suspectedTruncated),
          responseChainPassed
        }));

        const isLastCase = cursor === queue.length - 1;
        if (!isLastCase && autonomousResponseEnabled) {
          const { afterFinishCooldownMs } = buildResponseRuntimeConfig(autonomousResponseConfig, item);
          // Use the latest known end signal to prevent the next wake word from overlapping Speaker tail audio.
          const responseEndTime = Math.max(
            Number(responseLogResult?.vadEndTime) || 0,
            Number(responseResult?.responseAudioEndTime) || 0,
            Date.now()
          );
          const wakeGuardDelayMs = Math.max(0, (responseEndTime + afterFinishCooldownMs) - Date.now());
          if (wakeGuardDelayMs > 0) {
            dispatch(actions.setPlaybackState({ currentType: 'response-end-wait' }));
            setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · Speaker 播报结束，等待 ${Math.ceil(wakeGuardDelayMs / 1000)}s 后再唤醒`);
            logResponse('response.end.guard.before_next_wake.start', {
              cursor,
              caseId,
              targetText: item.audio.text,
              responseEndTime,
              afterFinishCooldownMs,
              guardDelayMs: wakeGuardDelayMs
            });
            await wait(wakeGuardDelayMs);
            logResponse('response.end.guard.before_next_wake.end', {
              cursor,
              caseId,
              targetText: item.audio.text,
              afterFinishCooldownMs,
              guardDelayMs: wakeGuardDelayMs
            });
          }
        }

        // 自主监听开启后不再使用固定唤醒间隔，下一条用例直接进入唤醒监听。
        const autonomousMonitoringEnabled = Boolean(
          testOptions.autonomousWake?.enabled
          || testOptions.autonomousInput?.enabled
          || testOptions.autonomousResponse?.enabled
        );
        if (!isLastCase && !autonomousMonitoringEnabled) {
          dispatch(actions.setPlaybackState({ currentType: 'interval' }));
          await wait(wakeWord.wakeIntervalDelay);
        } else if (!isLastCase) {
          logWake('interval.skipped.autonomous_monitoring', {
            cursor,
            wakeIntervalDelayMs: wakeWord.wakeIntervalDelay,
            autonomousWakeEnabled: Boolean(testOptions.autonomousWake?.enabled),
            autonomousInputEnabled: Boolean(testOptions.autonomousInput?.enabled),
            autonomousResponseEnabled: Boolean(testOptions.autonomousResponse?.enabled)
          });
        }

        if (startTimeRef.current) {
          dispatch(actions.updateElapsedTime(Date.now() - startTimeRef.current));
        }
      }

      if (shouldStop()) return;
      dispatch(actions.completeReport());
      isPlayingRef.current = false;
      isPausedRef.current = false;

      if (testOptions.debugSequence) {
        console.log(`[VoiceAuto][SEQ] complete | total=${queue.length}`);
      }

      onTestComplete?.();
    } catch (error) {
      console.error('Test error:', error);
      isPlayingRef.current = false;
      isPausedRef.current = false;
      if (error?.stage === 'WAKE_FAILED') {
        dispatch(actions.setPlaybackState({
          isPlaying: false,
          isPaused: false,
          status: 'failed',
          currentType: 'wake-failed'
        }));
      } else if (error?.stage === 'TEST_AUDIO_FAILED') {
        dispatch(actions.setPlaybackState({
          isPlaying: false,
          isPaused: false,
          status: 'failed',
          currentType: 'test-failed'
        }));
      } else {
        alert(error?.message || '测试异常中断');
        dispatch(actions.stopPlayback());
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [
    playableAudios,
    wakeWord,
    defaultVoiceConfig,
    dispatch,
    onTestComplete,
    testOptions.loopCount,
    testOptions.debugSequence,
    testOptions.selectedTestModule,
    testOptions.autonomousWake,
    testOptions.autonomousInput,
    testOptions.autonomousResponse
  ]);

  const start = useCallback(() => {
    if (isPlayingRef.current || isPausedRef.current) {
      return;
    }

    runIdRef.current += 1;
    runTest(runIdRef.current);
  }, [runTest]);

  const pause = useCallback(() => {
    isPausedRef.current = true;
    ttsService.stopAudio();
    dispatch(actions.pausePlayback());
  }, [dispatch]);

  const resume = useCallback(() => {
    isPausedRef.current = false;
    dispatch(actions.setPlaybackState({ isPlaying: true }));
  }, [dispatch]);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    isPlayingRef.current = false;
    isPausedRef.current = false;
    abortControllerRef.current?.abort();
    if (lastTestAudioTimeRef.current) {
      dispatch(actions.setReport({ lastTestAudioTime: lastTestAudioTimeRef.current }));
    }
    ttsService.stopAudio();
    dispatch(actions.stopPlayback());
    setCurrentAudioText('');
  }, [dispatch]);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    isPlayingRef.current = false;
    isPausedRef.current = false;
    abortControllerRef.current?.abort();
    firstTestAudioTimeRef.current = null;
    lastTestAudioTimeRef.current = null;
    dispatch(actions.resetTest());
    setCurrentAudioText('');
  }, [dispatch]);

  const progressPercent = playableAudios.length > 0
    ? ((playback.currentIndex + 1) / Math.max(1, totalCases)) * 100
    : 0;

  return {
    // 状态
    currentAudioText,
    isPlayingRef,
    isPausedRef,
    playback,
    testAudios: playableAudios,
    totalCases,
    loopCount: testOptions.loopCount,
    progressPercent,
    estimateRemainingTime,
    // 操作
    start,
    pause,
    resume,
    stop,
    reset
  };
}
