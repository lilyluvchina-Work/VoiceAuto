/**
 * 播放控制台组件
 */
import React, { useEffect } from 'react';
import useTestRunner from '../hooks/useTestRunner';
import { formatTime } from '../utils/formatters';
import { useTest, actions } from '../stores/testStore';
import { ENVIRONMENTS } from '../modules/langfuse/services/langfuseService';

export default function PlaybackConsole({ onTestComplete }) {
  const { state, dispatch } = useTest();
  const loopCount = state.testOptions?.loopCount || 1;
  const debugSequence = Boolean(state.testOptions?.debugSequence);
  const autoFetchLangfuseLogs = Boolean(state.testOptions?.autoFetchLangfuseLogs ?? true);
  const selectedLangfuseEnv = state.testOptions?.selectedLangfuseEnv || 'UAT';
  const selectedTestModule = state.testOptions?.selectedTestModule || 'all';

  const moduleOptions = React.useMemo(() => {
    const modules = Array.from(new Set((state.testAudios || []).map((audio) => audio.module || '未分类')));
    return ['all', ...modules];
  }, [state.testAudios]);

  const {
    currentAudioText,
    isPlayingRef,
    isPausedRef,
    playback,
    testAudios,
    totalCases,
    progressPercent,
    estimateRemainingTime,
    start: handleStart,
    pause: handlePause,
    resume: handleResume,
    stop: handleStop,
    reset: handleReset
  } = useTestRunner({ onTestComplete });

  const handleLoopCountChange = (e) => {
    dispatch(actions.setLoopCount(parseInt(e.target.value, 10) || 1));
  };

  const handleDebugSequenceChange = (e) => {
    dispatch(actions.setDebugSequence(e.target.checked));
  };

  const handleAutoFetchLangfuseLogsChange = (e) => {
    dispatch(actions.setAutoFetchLangfuseLogs(e.target.checked));
  };

  const handleSelectedLangfuseEnvChange = (e) => {
    dispatch(actions.setSelectedLangfuseEnv(e.target.value));
  };

  const handleSelectedModuleChange = (e) => {
    dispatch(actions.setSelectedTestModule(e.target.value));
  };

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

      <div className="mb-6 p-4 bg-gray-800/40 rounded-lg border border-gray-700">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm text-gray-300">循环播放次数</label>
          <select
            value={loopCount}
            onChange={handleLoopCountChange}
            disabled={isPlayingRef.current || isPausedRef.current}
            className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
          >
            <option value={1}>1 次（默认）</option>
            <option value={2}>2 次</option>
            <option value={3}>3 次</option>
            <option value={5}>5 次</option>
            <option value={10}>10 次</option>
            <option value={20}>20 次</option>
            <option value={50}>50 次</option>
          </select>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          总播放条数 = 测试音频条数 x 循环次数（当前 {testAudios.length} x {loopCount} = {totalCases}）
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="text-sm text-gray-300">测试模块</label>
          <select
            value={selectedTestModule}
            onChange={handleSelectedModuleChange}
            disabled={isPlayingRef.current || isPausedRef.current}
            className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
          >
            <option value="all">全部模块</option>
            {moduleOptions
              .filter((moduleName) => moduleName !== 'all')
              .map((moduleName) => (
                <option key={moduleName} value={moduleName}>{moduleName}</option>
              ))}
          </select>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          支持按单独功能模块执行测试。
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="text-sm text-gray-300">日志环境</label>
          <select
            value={selectedLangfuseEnv}
            onChange={handleSelectedLangfuseEnvChange}
            disabled={isPlayingRef.current || isPausedRef.current}
            className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
          >
            {Object.entries(ENVIRONMENTS).map(([key, env]) => (
              <option key={key} value={key}>{env.label}</option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          测试结束后自动拉取该环境的 Langfuse 日志。
        </p>
        <label className="mt-3 inline-flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={debugSequence}
            onChange={handleDebugSequenceChange}
            disabled={isPlayingRef.current || isPausedRef.current}
            className="w-4 h-4 rounded bg-gray-800 border-gray-600 disabled:opacity-50"
          />
          输出播放序列调试日志（控制台）
        </label>
        <div className="mt-3 p-3 rounded-lg border border-primary/40 bg-primary/10">
          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoFetchLangfuseLogs}
                onChange={handleAutoFetchLangfuseLogsChange}
                disabled={isPlayingRef.current || isPausedRef.current}
                className="w-4 h-4 rounded bg-gray-800 border-gray-600 disabled:opacity-50"
              />
              是否自动拉取langfuse日志
            </label>
            <span className={`text-xs px-2 py-1 rounded-full ${
              autoFetchLangfuseLogs
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-gray-700 text-gray-300 border border-gray-600'
            }`}>
              {autoFetchLangfuseLogs ? '已开启：结束后停留 2 分钟再拉日志' : '已关闭：测试结束停留语音测试'}
            </span>
          </div>
        </div>
      </div>

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
               `${playback.currentIndex + 1} / ${totalCases}`}
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
