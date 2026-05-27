/**
 * 测试执行 Hook - 从 PlaybackConsole 抽离测试编排逻辑
 */
import { useState, useRef, useCallback } from 'react';
import { useTest, actions } from '../stores/testStore';
import ttsService from '../services/ttsService.jsx';
import { playAudioItem } from '../utils/audioHelpers';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

        // 播放唤醒词
        dispatch(actions.setPlaybackState({
          currentIndex: cursor,
          currentListIndex: item.listIndex,
          currentAudioId: item.audio.id,
          currentType: 'wake'
        }));
        setCurrentAudioText(`第 ${item.round}/${item.totalRounds} 轮 · 唤醒词: ${wakeWord.text}`);

        try {
          await ttsService.speak(wakeWord.text, {
            voiceName: defaultVoiceConfig.voiceName,
            lang: defaultVoiceConfig.lang,
            volume: 200,
            rate: defaultVoiceConfig.rate
          });
        } catch (err) {
          console.error('Wake word playback failed:', err);
        }

        if (shouldStop()) return;

        // 唤醒后延迟
        dispatch(actions.setPlaybackState({ currentType: 'delay' }));
        await wait(wakeWord.wakeAfterDelay);

        if (shouldStop()) return;

        // 播放测试音频
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
        const caseId = resolveAudioCaseId(item.audio, item.listIndex);
        const playStartTime = Date.now();
        try {
          await playAudioItem(item.audio, ttsService);
        } catch (err) {
          success = false;
          console.error('Audio playback failed:', err);
        }
        const playEndTime = Date.now();

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
          duration: item.audio.duration || 0
        }));

        // 唤醒间延迟（最后一条不等待）
        const isLastCase = cursor === queue.length - 1;
        if (!isLastCase) {
          dispatch(actions.setPlaybackState({ currentType: 'interval' }));
          await wait(wakeWord.wakeIntervalDelay);
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
      dispatch(actions.stopPlayback());
      isPlayingRef.current = false;
    }
  }, [
    playableAudios,
    wakeWord,
    defaultVoiceConfig,
    dispatch,
    onTestComplete,
    testOptions.loopCount,
    testOptions.debugSequence,
    testOptions.selectedTestModule
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
