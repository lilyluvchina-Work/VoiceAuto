/**
 * 测试执行 Hook - 从 PlaybackConsole 抽离测试编排逻辑
 */
import { useState, useRef, useCallback } from 'react';
import { useTest, actions } from '../stores/testStore';
import ttsService from '../services/ttsService.jsx';
import { playAudioItem } from '../utils/audioHelpers';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default function useTestRunner({ onTestComplete } = {}) {
  const { state, dispatch } = useTest();
  const { wakeWord, testAudios, playback, defaultVoiceConfig } = state;

  const [currentAudioText, setCurrentAudioText] = useState('');
  const startTimeRef = useRef(null);
  const isPlayingRef = useRef(false);
  const isPausedRef = useRef(false);

  const estimateRemainingTime = useCallback(() => {
    if (testAudios.length === 0 || playback.currentIndex < 0) return 0;
    const remainingCount = testAudios.length - playback.currentIndex;
    const avgTimePerItem = 5000;
    return remainingCount * avgTimePerItem;
  }, [testAudios.length, playback.currentIndex]);

  const runTest = useCallback(async () => {
    if (testAudios.length === 0) {
      alert('请先添加测试音频');
      return;
    }

    dispatch(actions.startPlayback());
    isPlayingRef.current = true;
    isPausedRef.current = false;
    startTimeRef.current = Date.now();

    try {
      for (let i = 0; i < testAudios.length; i++) {
        if (!isPlayingRef.current) break;

        while (isPausedRef.current) {
          await wait(100);
          if (!isPlayingRef.current) return;
        }

        const audio = testAudios[i];

        // 播放唤醒词
        dispatch(actions.setPlaybackState({ currentIndex: i, currentType: 'wake' }));
        setCurrentAudioText(`唤醒词: ${wakeWord.text}`);

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

        if (!isPlayingRef.current) break;

        // 唤醒后延迟
        dispatch(actions.setPlaybackState({ currentType: 'delay' }));
        await wait(wakeWord.wakeAfterDelay);

        if (!isPlayingRef.current) break;

        // 播放测试音频
        dispatch(actions.setPlaybackState({ currentIndex: i, currentType: 'test' }));
        setCurrentAudioText(audio.text);

        try {
          await playAudioItem(audio, ttsService);
        } catch (err) {
          console.error('Audio playback failed:', err);
        }

        // 记录结果
        dispatch(actions.addReportCase({
          index: i,
          text: audio.text,
          success: true,
          duration: audio.duration || 0
        }));

        // 唤醒间延迟
        if (i < testAudios.length - 1) {
          dispatch(actions.setPlaybackState({ currentType: 'interval' }));
          await wait(wakeWord.wakeIntervalDelay);
        }

        if (startTimeRef.current) {
          dispatch(actions.updateElapsedTime(Date.now() - startTimeRef.current));
        }
      }

      dispatch(actions.completeReport());
      onTestComplete?.();
    } catch (error) {
      console.error('Test error:', error);
      dispatch(actions.stopPlayback());
      isPlayingRef.current = false;
    }
  }, [testAudios, wakeWord, defaultVoiceConfig, dispatch, onTestComplete]);

  const start = useCallback(() => {
    isPlayingRef.current = true;
    isPausedRef.current = false;
    dispatch(actions.setPlaybackState({ isPlaying: true }));
    runTest();
  }, [runTest, dispatch]);

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
    isPlayingRef.current = false;
    isPausedRef.current = false;
    ttsService.stopAudio();
    dispatch(actions.stopPlayback());
    setCurrentAudioText('');
  }, [dispatch]);

  const reset = useCallback(() => {
    isPlayingRef.current = false;
    isPausedRef.current = false;
    dispatch(actions.resetTest());
    setCurrentAudioText('');
  }, [dispatch]);

  const progressPercent = testAudios.length > 0
    ? ((playback.currentIndex + 1) / testAudios.length) * 100
    : 0;

  return {
    // 状态
    currentAudioText,
    isPlayingRef,
    isPausedRef,
    playback,
    testAudios,
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
