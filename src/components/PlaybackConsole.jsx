/**
 * 播放控制台组件
 */
import React, { useEffect } from 'react';
import useTestRunner from '../hooks/useTestRunner';
import { formatTime } from '../utils/formatters';

export default function PlaybackConsole({ onTestComplete }) {
  const {
    currentAudioText,
    isPlayingRef,
    isPausedRef,
    playback,
    testAudios,
    progressPercent,
    estimateRemainingTime,
    start: handleStart,
    pause: handlePause,
    resume: handleResume,
    stop: handleStop,
    reset: handleReset
  } = useTestRunner({ onTestComplete });

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter' && !isPlayingRef.current && !isPausedRef.current) {
        handleStart();
      } else if (e.key === ' ' && isPlayingRef.current && !isPausedRef.current) {
        e.preventDefault();
        handlePause();
      } else if (e.key === ' ' && isPausedRef.current) {
        e.preventDefault();
        handleResume();
      } else if (e.key === 'Escape') {
        handleStop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="bg-dark rounded-xl p-6 border border-gray-700">
      <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
        <span className="text-2xl">🎛️</span>
        播放控制台
        <span className="ml-2 px-2 py-0.5 bg-primary/20 text-primary text-xs rounded-full">
          Web Speech API
        </span>
      </h2>

      {/* 状态显示 */}
      <div className="mb-6 p-4 bg-gray-800/50 rounded-lg">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">当前状态</p>
            <p className={`font-medium ${
              isPlayingRef.current && !isPausedRef.current ? 'text-accent' :
              isPausedRef.current ? 'text-amber-400' :
              playback.status === 'completed' ? 'text-primary' : 'text-gray-400'
            }`}>
              {!isPlayingRef.current && !isPausedRef.current ? '等待中' :
               isPlayingRef.current && !isPausedRef.current ? '测试中' :
               isPausedRef.current ? '已暂停' :
               playback.status === 'completed' ? '已完成' : '等待中'}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1">当前进度</p>
            <p className="font-medium text-white">
              {!isPlayingRef.current && !isPausedRef.current ? '-' :
               `${playback.currentIndex + 1} / ${testAudios.length}`}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1">已用时间</p>
            <p className="font-medium text-white font-mono">
              {formatTime(playback.elapsedTime / 1000)}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1">预计剩余</p>
            <p className="font-medium text-gray-400 font-mono">
              {!isPlayingRef.current ? '-' :
               formatTime(estimateRemainingTime() / 1000)}
            </p>
          </div>
        </div>
      </div>

      {/* 当前播放内容 */}
      {(isPlayingRef.current || isPausedRef.current) && (
        <div className="mb-6 p-4 bg-primary/10 border border-primary/30 rounded-lg">
          <div className="flex items-center gap-3 mb-2">
            <span className={`w-3 h-3 rounded-full ${
              playback.currentType === 'wake' ? 'bg-primary' :
              playback.currentType === 'test' ? 'bg-accent' :
              playback.currentType === 'delay' ? 'bg-blue-400' :
              playback.currentType === 'interval' ? 'bg-amber-400' : 'bg-gray-400'
            }`}></span>
            <span className="text-sm text-gray-400">
              {playback.currentType === 'wake' ? '🔔 唤醒词' :
               playback.currentType === 'test' ? '🎵 测试音频' :
               playback.currentType === 'delay' ? '⏳ 唤醒后延迟' :
               playback.currentType === 'interval' ? '⏳ 唤醒间延迟' : ''}
            </span>
          </div>
          <p className="text-white truncate">{currentAudioText}</p>
        </div>
      )}

      {/* 进度条 */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-gray-400 mb-2">
          <span>进度</span>
          <span>{progressPercent.toFixed(0)}%</span>
        </div>
        <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          ></div>
        </div>
      </div>

      {/* 控制按钮 */}
      <div className="flex flex-wrap gap-3">
        {!isPlayingRef.current && !isPausedRef.current ? (
          <button
            onClick={handleStart}
            disabled={testAudios.length === 0}
            className="px-6 py-3 bg-accent hover:bg-emerald-600 disabled:bg-gray-600
                     rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <span>▶</span>
            开始测试
          </button>
        ) : isPausedRef.current ? (
          <button
            onClick={handleResume}
            className="px-6 py-3 bg-accent hover:bg-emerald-600 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <span>▶</span>
            继续
          </button>
        ) : (
          <button
            onClick={handlePause}
            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <span>⏸</span>
            暂停
          </button>
        )}

        <button
          onClick={handleStop}
          disabled={!isPlayingRef.current && !isPausedRef.current}
          className="px-6 py-3 bg-red-500 hover:bg-red-600 disabled:bg-gray-600
                   rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <span>⏹</span>
          停止
        </button>

        <button
          onClick={handleReset}
          className="px-6 py-3 bg-gray-600 hover:bg-gray-500 rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <span>🔄</span>
          重置
        </button>
      </div>

      {/* 快捷键提示 */}
      <div className="mt-4 text-xs text-gray-500">
        快捷键: <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">Enter</kbd> 开始 |
        <kbd className="px-1.5 py-0.5 bg-gray-700 rounded mx-1">Space</kbd> 暂停/继续 |
        <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">Esc</kbd> 停止
      </div>
    </div>
  );
}