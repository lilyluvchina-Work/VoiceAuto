/**
 * 音频播放 Hook - 统一管理试听播放逻辑
 */
import { useState, useCallback } from 'react';
import ttsService from '../services/ttsService.jsx';
import { playAudioItem } from '../utils/audioHelpers';

export default function useAudioPlayer() {
  const [playingId, setPlayingId] = useState(null);

  const play = useCallback(async (audio) => {
    // 点击正在播放的项 → 停止
    if (playingId === audio.id) {
      ttsService.stopAudio();
      setPlayingId(null);
      return;
    }

    ttsService.stopAudio();
    setPlayingId(audio.id);

    try {
      await playAudioItem(audio, ttsService);
    } catch (err) {
      console.error('Playback failed:', err);
    } finally {
      setPlayingId(null);
    }
  }, [playingId]);

  const stop = useCallback(() => {
    ttsService.stopAudio();
    setPlayingId(null);
  }, []);

  return { playingId, play, stop };
}
