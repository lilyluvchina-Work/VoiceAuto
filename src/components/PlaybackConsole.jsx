/**
 * 播放控制台组件
 */
import React, { useEffect, useState } from 'react';
import useTestRunner from '../hooks/useTestRunner';
import { formatTime } from '../utils/formatters';
import { useTest, actions } from '../stores/testStore';
import { ENVIRONMENTS } from '../modules/langfuse/services/langfuseService';
import responseMonitorService from '../services/responseMonitorService';
import adbWakeService from '../services/adbWakeService';

export default function PlaybackConsole({ onTestComplete }) {
  const { state, dispatch } = useTest();
  const loopCount = state.testOptions?.loopCount || 1;
  const debugSequence = Boolean(state.testOptions?.debugSequence);
  const autoFetchLangfuseLogs = Boolean(state.testOptions?.autoFetchLangfuseLogs ?? true);
  const selectedLangfuseEnv = state.testOptions?.selectedLangfuseEnv || 'UAT';
  const selectedTestModule = state.testOptions?.selectedTestModule || 'all';
  const autonomousWake = state.testOptions?.autonomousWake || {};
  const autonomousInput = state.testOptions?.autonomousInput || {};
  const autonomousResponse = state.testOptions?.autonomousResponse || {};
  const [microphones, setMicrophones] = useState([]);
  const [microphoneStatus, setMicrophoneStatus] = useState('');
  const [speakers, setSpeakers] = useState([]);
  const [speakerStatus, setSpeakerStatus] = useState('');
  const [adbDevices, setAdbDevices] = useState([]);
  const [adbDeviceStatus, setAdbDeviceStatus] = useState('');
  const [listenerHealth, setListenerHealth] = useState(null);
  const [listenerHealthStatus, setListenerHealthStatus] = useState('');
  const [listenerRecovering, setListenerRecovering] = useState(false);

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

  const handleAutonomousWakeChange = (patch) => {
    dispatch(actions.setAutonomousWake(patch));
  };

  const handleAutonomousInputChange = (patch) => {
    dispatch(actions.setAutonomousInput(patch));
  };

  const handleAutonomousResponseChange = (patch) => {
    dispatch(actions.setAutonomousResponse(patch));
  };

  const refreshMicrophones = async () => {
    setMicrophoneStatus('正在读取麦克风列表...');
    try {
      const list = await responseMonitorService.listMicrophones();
      setMicrophones(list);
      setMicrophoneStatus(list.length ? `已发现 ${list.length} 个输入设备` : '未发现麦克风输入设备');
    } catch (err) {
      setMicrophoneStatus(err?.message || '读取麦克风列表失败');
    }
  };

  const refreshSpeakers = async () => {
    setSpeakerStatus('正在检测 Speaker 输出设备...');
    try {
      const list = await responseMonitorService.listSpeakers();
      setSpeakers(list);
      setSpeakerStatus(list.length ? `已发现 ${list.length} 个 Speaker 输出设备` : '未检测到 Speaker 输出设备，请检查系统输出设备或浏览器权限');
    } catch (err) {
      setSpeakers([]);
      setSpeakerStatus(err?.message || '读取 Speaker 输出设备失败');
    }
  };

  const refreshAudioDevices = async () => {
    await Promise.all([refreshMicrophones(), refreshSpeakers()]);
  };

  const refreshAdbDevices = async () => {
    setAdbDeviceStatus('正在检测 ADB Speaker 设备...');
    try {
      const result = await adbWakeService.listDevices({
        bridgeUrl: autonomousWake.bridgeUrl
      });
      const devices = (result.devices || []).filter((device) => device.state === 'device');
      setAdbDevices(devices);

      if (!devices.length) {
        setAdbDeviceStatus('未检测到 ADB Speaker 设备');
        if (autonomousWake.deviceId) {
          handleAutonomousWakeChange({ deviceId: '' });
        }
        return;
      }

      setAdbDeviceStatus(`已检测到 ${devices.length} 个 ADB Speaker 设备`);
      const currentDeviceMatched = devices.some((device) => device.id === autonomousWake.deviceId);
      if (!autonomousWake.deviceId || !currentDeviceMatched) {
        handleAutonomousWakeChange({ deviceId: devices[0].id });
      }
    } catch (err) {
      setAdbDevices([]);
      setAdbDeviceStatus(err?.message || 'ADB Speaker 设备检测失败');
    }
  };

  const refreshListenerHealth = async () => {
    setListenerHealthStatus('正在自检 Speaker 监听链路...');
    try {
      const result = await adbWakeService.checkListenerHealth({
        bridgeUrl: autonomousWake.bridgeUrl,
        deviceId: autonomousWake.deviceId
      });
      setListenerHealth(result);
      setListenerHealthStatus(result.message || (result.success ? '监听链路正常' : '监听链路异常'));
      const devices = (result.devices || []).filter((device) => device.state === 'device');
      if (devices.length) {
        setAdbDevices(devices);
      }
      if (result.selectedDeviceId && result.selectedDeviceId !== autonomousWake.deviceId) {
        handleAutonomousWakeChange({ deviceId: result.selectedDeviceId });
      }
    } catch (err) {
      setListenerHealth(null);
      setListenerHealthStatus(err?.message || 'Speaker 监听链路自检失败');
    }
  };

  const recoverListenerLink = async () => {
    setListenerRecovering(true);
    setListenerHealthStatus('正在恢复 ADB / logcat 监听链路...');
    try {
      const result = await adbWakeService.recoverListenerLink({
        bridgeUrl: autonomousWake.bridgeUrl,
        deviceId: autonomousWake.deviceId
      });
      setListenerHealth(result.health || null);
      setListenerHealthStatus(result.message || (result.success ? '监听链路已恢复' : '监听链路恢复失败'));
      if (result.recoveredDeviceId && result.recoveredDeviceId !== autonomousWake.deviceId) {
        handleAutonomousWakeChange({ deviceId: result.recoveredDeviceId });
      }
      await refreshAdbDevices();
    } catch (err) {
      setListenerHealthStatus(err?.message || '监听链路恢复失败');
    } finally {
      setListenerRecovering(false);
    }
  };

  const isLocked = isPlayingRef.current || isPausedRef.current;
  const selectedAdbDeviceId = autonomousWake.deviceId || (adbDevices.length === 1 ? adbDevices[0].id : '');
  const listenerChecks = listenerHealth?.checks || {};
  const listenerOk = Boolean(listenerHealth?.success);

  // 键盘快捷键
  useEffect(() => {
    refreshAudioDevices();
    refreshListenerHealth();

    const handleDeviceChange = () => {
      refreshAudioDevices();
    };

    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
  }, []);

  useEffect(() => {
    if (!autonomousWake.enabled || isLocked) return;
    refreshAdbDevices();
  }, [autonomousWake.enabled, autonomousWake.bridgeUrl]);

  useEffect(() => {
    if (isLocked) return;
    refreshListenerHealth();
  }, [autonomousWake.bridgeUrl, autonomousWake.deviceId]);

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

      <div className={`mb-6 rounded-lg border p-4 ${
        listenerOk
          ? 'border-emerald-500/30 bg-emerald-500/10'
          : 'border-amber-500/30 bg-amber-500/10'
      }`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${listenerOk ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <p className="text-sm font-medium text-gray-100">Speaker 监听链路自检</p>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${
                listenerOk
                  ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200'
                  : 'border-amber-500/30 bg-amber-500/15 text-amber-200'
              }`}>
                {listenerOk ? '正常' : '待确认'}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-300">
              {listenerHealthStatus || '启动后自动检查 ADB、Speaker 设备与 logcat 可读状态。'}
            </p>
            <div className="mt-3 grid gap-2 text-xs text-gray-400 sm:grid-cols-2 lg:grid-cols-4">
              <span>ADB：{listenerChecks.adbConnected ? '正常' : '异常/未检查'}</span>
              <span>Speaker：{listenerChecks.speakerOnline ? '在线' : '离线/未检查'}</span>
              <span>logcat：{listenerChecks.logcatReadable ? '可读' : '不可读/未检查'}</span>
              <span>最近检查：{listenerHealth?.checkedAtText || '-'}</span>
            </div>
            {listenerHealth?.selectedDeviceId && (
              <p className="mt-2 text-[11px] text-gray-500">
                当前设备：{listenerHealth.selectedDeviceId}
                {listenerChecks.bootCompleted ? ' · boot_completed=1' : ''}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={refreshListenerHealth}
              disabled={isLocked || listenerRecovering}
              className="rounded-lg bg-gray-700 px-3 py-2 text-sm text-gray-100 transition-colors hover:bg-gray-600 disabled:opacity-50"
            >
              重新自检
            </button>
            <button
              type="button"
              onClick={recoverListenerLink}
              disabled={isLocked || listenerRecovering}
              className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
            >
              {listenerRecovering ? '恢复中...' : '一键恢复'}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 p-4 bg-gray-800/40 rounded-lg border border-gray-700">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm text-gray-300">循环播放次数</label>
          <select
            value={loopCount}
            onChange={handleLoopCountChange}
            disabled={isLocked}
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
            disabled={isLocked}
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
            disabled={isLocked}
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
            disabled={isLocked}
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
                disabled={isLocked}
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
        <div className={`mt-3 p-3 rounded-lg border ${
          speakers.length
            ? 'border-gray-600 bg-gray-800/40'
            : 'border-red-500/40 bg-red-500/10'
        }`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={`text-sm font-medium ${speakers.length ? 'text-gray-200' : 'text-red-200'}`}>
                Speaker 输出设备
              </p>
              <p className={`mt-1 text-xs ${speakers.length ? 'text-gray-400' : 'text-red-100'}`}>
                {speakerStatus || '尚未检测 Speaker 输出设备'}
              </p>
              {speakers.length > 0 && (
                <p className="mt-1 text-[11px] text-gray-500 truncate">
                  {speakers.map((device) => device.label).join('、')}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={refreshSpeakers}
              disabled={isLocked}
              className="px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg"
            >
              刷新 Speaker
            </button>
          </div>
          {!speakers.length && (
            <p className="mt-2 text-xs text-red-100">
              未监测到可用的 Speaker 设备时，播放测试可能无法正确输出声音；请连接扬声器或耳机后刷新。
            </p>
          )}
        </div>
        <div className="mt-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(autonomousWake.enabled)}
                onChange={(e) => handleAutonomousWakeChange({ enabled: e.target.checked })}
                disabled={isLocked}
                className="w-4 h-4 rounded bg-gray-800 border-gray-600 disabled:opacity-50"
              />
              自主监测唤醒是否成功
            </label>
            <span className={`text-xs px-2 py-1 rounded-full ${
              autonomousWake.enabled
                ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                : 'bg-gray-700 text-gray-300 border border-gray-600'
            }`}>
              {autonomousWake.enabled ? '启用：检测 WakeupSuccess' : '关闭：使用固定等待'}
            </span>
          </div>

          {autonomousWake.enabled && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-gray-400">
                ADB Bridge
                <input
                  type="text"
                  value={autonomousWake.bridgeUrl || ''}
                  onChange={(e) => handleAutonomousWakeChange({ bridgeUrl: e.target.value })}
                  disabled={isLocked}
                  placeholder="http://127.0.0.1:17321"
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-gray-400">
                ADB Speaker SN
                <div className="mt-1 flex gap-2">
                  {adbDevices.length > 1 ? (
                    <select
                      value={selectedAdbDeviceId}
                      onChange={(e) => handleAutonomousWakeChange({ deviceId: e.target.value })}
                      disabled={isLocked}
                      className="min-w-0 flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                    >
                      {adbDevices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label || device.sn || device.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={selectedAdbDeviceId}
                      readOnly
                      disabled={isLocked}
                      placeholder="未检测到设备"
                      className="min-w-0 flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                    />
                  )}
                  <button
                    type="button"
                    onClick={refreshAdbDevices}
                    disabled={isLocked}
                    className="shrink-0 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg"
                  >
                    刷新
                  </button>
                </div>
                <p className={`mt-1 text-[11px] ${adbDevices.length ? 'text-gray-500' : 'text-amber-200'}`}>
                  {adbDeviceStatus || '开启后自动检测 ADB Speaker SN'}
                </p>
              </label>
              <label className="text-xs text-gray-400">
                检测超时
                <select
                  value={autonomousWake.detectionTimeoutMs || 5000}
                  onChange={(e) => handleAutonomousWakeChange({ detectionTimeoutMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={3000}>3s</option>
                  <option value={5000}>5s</option>
                  <option value={8000}>8s</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                失败重启阈值
                <select
                  value={5}
                  onChange={(e) => handleAutonomousWakeChange({ failureThreshold: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={5}>连续 5 次</option>
                </select>
              </label>
              <label className="text-xs text-gray-400 md:col-span-2">
                唤醒成功日志关键词
                <textarea
                  value={autonomousWake.keywords || ''}
                  onChange={(e) => handleAutonomousWakeChange({ keywords: e.target.value })}
                  disabled={isLocked}
                  rows={4}
                  placeholder={'WakeupSuccess\nonCedarWakeup\n/your wake regex/i'}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                />
              </label>
            </div>
          )}
        </div>
        <div className="mt-3 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10">
          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(autonomousInput.enabled)}
                onChange={(e) => handleAutonomousInputChange({ enabled: e.target.checked })}
                disabled={isLocked}
                className="w-4 h-4 rounded bg-gray-800 border-gray-600 disabled:opacity-50"
              />
              自主监测测试音频与 ASR 输入
            </label>
            <span className={`text-xs px-2 py-1 rounded-full ${
              autonomousInput.enabled
                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/30'
                : 'bg-gray-700 text-gray-300 border border-gray-600'
            }`}>
              {autonomousInput.enabled ? '启用：检测 ADB ASR' : '关闭：仅记录播放结果'}
            </span>
          </div>

          {autonomousInput.enabled && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-gray-400">
                ASR 检测超时
                <select
                  value={autonomousInput.asrDetectionTimeoutMs || 8000}
                  onChange={(e) => handleAutonomousInputChange({ asrDetectionTimeoutMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={5000}>5s</option>
                  <option value={8000}>8s</option>
                  <option value={12000}>12s</option>
                  <option value={20000}>20s</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                ASR 相似度阈值
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={autonomousInput.asrSimilarityThreshold ?? 0.8}
                  onChange={(e) => handleAutonomousInputChange({ asrSimilarityThreshold: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-gray-400">
                ASR 开始标识
                <textarea
                  value={autonomousInput.asrStartKeywords || ''}
                  onChange={(e) => handleAutonomousInputChange({ asrStartKeywords: e.target.value })}
                  disabled={isLocked}
                  rows={4}
                  placeholder={'/asr_status[^\\n]*(partial)/i'}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-gray-400">
                ASR 结束标识
                <textarea
                  value={autonomousInput.asrEndKeywords || autonomousInput.asrKeywords || ''}
                  onChange={(e) => handleAutonomousInputChange({ asrEndKeywords: e.target.value })}
                  disabled={isLocked}
                  rows={4}
                  placeholder={'/asr_status[^\\n]*(final)/i'}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-gray-400 md:col-span-2">
                ASR 失败标识
                <textarea
                  value={autonomousInput.asrFailureKeywords || ''}
                  onChange={(e) => handleAutonomousInputChange({ asrFailureKeywords: e.target.value })}
                  disabled={isLocked}
                  rows={3}
                  placeholder={'/asr_status[^\\n]*(unidentified)/i'}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-gray-400 md:col-span-2">
                ASR 文本提取正则
                <textarea
                  value={autonomousInput.asrPatterns || ''}
                  onChange={(e) => handleAutonomousInputChange({ asrPatterns: e.target.value })}
                  disabled={isLocked}
                  rows={3}
                  placeholder={'/(?:asrText|recognizedText)\\s*[:=]\\s*"([^"]+)"/i'}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                />
              </label>
            </div>
          )}
        </div>
        <div className="mt-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(autonomousResponse.enabled)}
                onChange={(e) => handleAutonomousResponseChange({ enabled: e.target.checked })}
                disabled={isLocked}
                className="w-4 h-4 rounded bg-gray-800 border-gray-600 disabled:opacity-50"
              />
              自主监测 Speaker 响应内容
            </label>
            <span className={`text-xs px-2 py-1 rounded-full ${
              autonomousResponse.enabled
                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
                : 'bg-gray-700 text-gray-300 border border-gray-600'
            }`}>
              {autonomousResponse.enabled ? '启用：麦克风 VAD + 响应 ASR' : '关闭：不采集响应'}
            </span>
          </div>

          {autonomousResponse.enabled && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-gray-400 md:col-span-2">
                外部麦克风
                <div className="mt-1 flex gap-2">
                  <select
                    value={autonomousResponse.microphoneDeviceId || ''}
                    onChange={(e) => handleAutonomousResponseChange({ microphoneDeviceId: e.target.value })}
                    disabled={isLocked}
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                  >
                    <option value="">默认麦克风</option>
                    {microphones.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={refreshMicrophones}
                    disabled={isLocked}
                    className="px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg"
                  >
                    刷新
                  </button>
                </div>
                {microphoneStatus && <p className="mt-1 text-[11px] text-gray-500">{microphoneStatus}</p>}
              </label>
              <label className="text-xs text-gray-400">
                响应检测窗口
                <select
                  value={autonomousResponse.responseWindowMs || 15000}
                  onChange={(e) => handleAutonomousResponseChange({ responseWindowMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={8000}>8s</option>
                  <option value={15000}>15s</option>
                  <option value={30000}>30s</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                最大等待/录制
                <select
                  value={autonomousResponse.maxRecordMs || autonomousResponse.responseMaxWaitMs || 120000}
                  onChange={(e) => handleAutonomousResponseChange({
                    maxRecordMs: Number(e.target.value),
                    responseMaxWaitMs: Number(e.target.value)
                  })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={60000}>60s</option>
                  <option value={120000}>120s</option>
                  <option value={180000}>180s</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                静音确认时长
                <select
                  value={autonomousResponse.silenceMs || 1200}
                  onChange={(e) => handleAutonomousResponseChange({ silenceMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={800}>800ms</option>
                  <option value={1200}>1200ms</option>
                  <option value={1500}>1500ms</option>
                  <option value={2000}>2000ms</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                长文本静音结束
                <select
                  value={autonomousResponse.longTextSilenceEndMs || 3500}
                  onChange={(e) => handleAutonomousResponseChange({ longTextSilenceEndMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={2500}>2500ms</option>
                  <option value={3500}>3500ms</option>
                  <option value={5000}>5000ms</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                最短响应时长
                <input
                  type="number"
                  min="100"
                  step="100"
                  value={autonomousResponse.minDurationMs || 500}
                  onChange={(e) => handleAutonomousResponseChange({ minDurationMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-gray-400">
                最短保护时长
                <input
                  type="number"
                  min="3000"
                  step="1000"
                  value={autonomousResponse.minProtectMs || 10000}
                  onChange={(e) => handleAutonomousResponseChange({ minProtectMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-gray-400">
                噪声阈值
                <input
                  type="number"
                  min="0.001"
                  max="1"
                  step="0.005"
                  value={autonomousResponse.noiseThreshold ?? 0.02}
                  onChange={(e) => handleAutonomousResponseChange({ noiseThreshold: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-gray-400">
                前置缓存
                <select
                  value={autonomousResponse.preRollMs || 1500}
                  onChange={(e) => handleAutonomousResponseChange({ preRollMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={800}>800ms</option>
                  <option value={1000}>1000ms</option>
                  <option value={1500}>1500ms</option>
                  <option value={2000}>2000ms</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                后置缓存
                <select
                  value={autonomousResponse.postRollMs || 1000}
                  onChange={(e) => handleAutonomousResponseChange({ postRollMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={500}>500ms</option>
                  <option value={1000}>1000ms</option>
                  <option value={1500}>1500ms</option>
                  <option value={2000}>2000ms</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                响应 ASR 语言
                <select
                  value={autonomousResponse.language || 'zh-CN'}
                  onChange={(e) => handleAutonomousResponseChange({ language: e.target.value })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value="zh-CN">中文 zh-CN</option>
                  <option value="en-US">英文 en-US</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                回复开始超时
                <select
                  value={autonomousResponse.replyStartTimeoutMs || 20000}
                  onChange={(e) => handleAutonomousResponseChange({ replyStartTimeoutMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={10000}>10s</option>
                  <option value={20000}>20s</option>
                  <option value={30000}>30s</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                下一轮唤醒冷却
                <select
                  value={autonomousResponse.afterFinishCooldownMs || 3000}
                  onChange={(e) => handleAutonomousResponseChange({ afterFinishCooldownMs: Number(e.target.value) })}
                  disabled={isLocked}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={1000}>1s</option>
                  <option value={3000}>3s</option>
                  <option value={5000}>5s</option>
                </select>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* 状态显示 */}
      <div className="mb-6 p-4 bg-gray-800/50 rounded-lg">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">当前状态</p>
            <p className={`font-medium ${
              playback.status === 'failed' ? 'text-red-400' :
              isPlayingRef.current && !isPausedRef.current ? 'text-accent' :
              isPausedRef.current ? 'text-amber-400' :
              playback.status === 'completed' ? 'text-primary' : 'text-gray-400'
            }`}>
              {playback.status === 'failed' && playback.currentType === 'test-failed' ? '测试音频失败' :
               playback.status === 'failed' ? '唤醒失败' :
               !isPlayingRef.current && !isPausedRef.current ? '等待中' :
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
      {(isPlayingRef.current || isPausedRef.current || playback.status === 'failed') && (
        <div className={`mb-6 p-4 rounded-lg ${
          playback.status === 'failed'
            ? 'bg-red-500/10 border border-red-500/30'
            : 'bg-primary/10 border border-primary/30'
        }`}>
          <div className="flex items-center gap-3 mb-2">
            <span className={`w-3 h-3 rounded-full ${
              playback.currentType === 'wake-failed' ? 'bg-red-400' :
              playback.currentType === 'wake' ? 'bg-primary' :
              playback.currentType === 'wake-detect' ? 'bg-amber-400' :
              playback.currentType === 'reboot' ? 'bg-red-400' :
              playback.currentType === 'reboot-wait' ? 'bg-orange-400' :
              playback.currentType === 'asr-detect' ? 'bg-cyan-400' :
              playback.currentType === 'response-detect' ? 'bg-emerald-400' :
              playback.currentType === 'response-end-wait' ? 'bg-emerald-300' :
              playback.currentType === 'test-ready' ? 'bg-accent' :
              playback.currentType === 'test-failed' ? 'bg-red-400' :
              playback.currentType === 'test' ? 'bg-accent' :
              playback.currentType === 'delay' ? 'bg-blue-400' :
              playback.currentType === 'interval' ? 'bg-amber-400' : 'bg-gray-400'
            }`}></span>
            <span className="text-sm text-gray-400">
              {playback.currentType === 'wake-failed' ? '唤醒失败' :
               playback.currentType === 'wake' ? '🔔 唤醒词' :
               playback.currentType === 'wake-detect' ? '🔎 唤醒检测' :
               playback.currentType === 'reboot' ? '♻ ADB 重启' :
               playback.currentType === 'reboot-wait' ? '⏳ 重启后等待' :
               playback.currentType === 'asr-detect' ? '📝 ASR 检测' :
               playback.currentType === 'response-detect' ? '🎙️ 响应检测' :
               playback.currentType === 'response-end-wait' ? '响应播报结束等待' :
               playback.currentType === 'test-ready' ? '准备播放测试音频' :
               playback.currentType === 'test-failed' ? '测试音频播放失败' :
               playback.currentType === 'test' ? '🎵 测试音频' :
               playback.currentType === 'delay' ? '⏳ 唤醒后延迟' :
               playback.currentType === 'interval' ? '⏳ 唤醒间延迟' : ''}
            </span>
          </div>
          <p className={`${playback.status === 'failed' ? 'text-red-100' : 'text-white'} truncate`}>
            {currentAudioText}
          </p>
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
