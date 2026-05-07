/**
 * 测试执行 Hook - 从 PlaybackConsole 抽离测试编排逻辑
 */
import { useState, useRef, useCallback } from 'react';
import { useTest, actions } from '../stores/testStore';
import ttsService from '../services/ttsService.jsx';
import { playAudioItem } from '../utils/audioHelpers';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

  const totalCases = testAudios.length * (testOptions.loopCount || 1);

  const [currentAudioText, setCurrentAudioText] = useState('');
  const startTimeRef = useRef(null);
  const firstTestAudioTimeRef = useRef(null);
  const lastTestAudioTimeRef = useRef(null);
  const isPlayingRef = useRef(false);
  const isPausedRef = useRef(false);
  const runIdRef = useRef(0);

  const estimateRemainingTime = useCallback(() => {
    if (totalCases === 0 || playback.currentIndex < 0) return 0;
    const remainingCount = Math.max(0, totalCases - (playback.currentIndex + 1));
    const avgTimePerItem = 5000;
    return remainingCount * avgTimePerItem;
  }, [totalCases, playback.currentIndex]);

  const runTest = useCallback(async (runId) => {
    if (testAudios.length === 0) {
      alert('请先添加测试音频');
      return;
    }

    const queue = buildQueue(testAudios, testOptions.loopCount);
    const shouldStop = () => !isPlayingRef.current || runIdRef.current !== runId;

    dispatch(actions.startPlayback());
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
        try {
          await playAudioItem(item.audio, ttsService);
        } catch (err) {
          success = false;
          console.error('Audio playback failed:', err);
        }

        lastTestAudioTimeRef.current = Date.now();
        dispatch(actions.setReport({ lastTestAudioTime: lastTestAudioTimeRef.current }));

        // 记录结果
        dispatch(actions.addReportCase({
          index: cursor,
          round: item.round,
          text: item.audio.text,
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
    testAudios,
    wakeWord,
    defaultVoiceConfig,
    dispatch,
    onTestComplete,
    testOptions.loopCount,
    testOptions.debugSequence
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

  const progressPercent = testAudios.length > 0
    ? ((playback.currentIndex + 1) / Math.max(1, totalCases)) * 100
    : 0;

  return {
    // 状态
    currentAudioText,
    isPlayingRef,
    isPausedRef,
    playback,
    testAudios,
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
