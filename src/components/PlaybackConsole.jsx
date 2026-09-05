/**
 * 播放控制台组件
 */
import React, { useEffect, useState } from 'react';
import useTestRunner from '../hooks/useTestRunner';
import { formatTime } from '../utils/formatters';
import { useTest, actions } from '../stores/testStore';
import {
  ENVIRONMENTS,
  LANGFUSE_ENVIRONMENTS_UPDATED_EVENT,
  getDefaultLangfuseEnvironmentKey,
  getLangfuseEnvironmentEntries,
} from '../modules/langfuse/services/langfuseService';
import responseMonitorService from '../services/responseMonitorService';
import adbWakeService from '../services/adbWakeService';
import ttsService from '../services/ttsService.jsx';
import { notifyDingTalk } from '../services/dingTalkService';
import { resolveTestCaseDirectory } from '../utils/testCaseOrdering';
import {
  AGENT_EVALUATION_METRIC_GROUPS,
  selectAgentEvaluationPlan,
} from '../utils/agentEvaluation';
import {
  DEVICE_TYPES,
  LOG_SOURCES,
  resolveDeviceRuntimeOptions,
} from '../config/deviceProfiles';
import { selectSerialPortCandidate } from '../utils/serialPortSelection';

function formatUsbDiagnostics(usbDiagnostics = []) {
  const diagnostics = (Array.isArray(usbDiagnostics) ? usbDiagnostics : [])
    .filter((item) => item?.friendlyName || item?.status || item?.instanceId);
  if (!diagnostics.length) return '';

  const failedDevice = diagnostics.find((item) => (
    item?.status && item.status !== 'OK'
  ) || /未知 USB 设备|设备描述符请求失败/i.test(String(item?.friendlyName || '')));
  const target = failedDevice || diagnostics[0];
  const name = target.friendlyName || target.instanceId || 'USB 设备';
  const status = target.status && target.status !== 'OK' ? `，状态：${target.status}` : '';
  return `系统已识别到 USB 异常设备：${name}${status}；请重新插拔 AI玩具、确认数据线/供电，并检查串口驱动或设备 USB 模式`;
}

export default function PlaybackConsole({ onTestComplete }) {
  const { state, dispatch } = useTest();
  const { wakeWord, defaultVoiceConfig } = state;
  const loopCount = state.testOptions?.loopCount || 1;
  const dingTalkEnabled = Boolean(state.testOptions?.dingTalkEnabled);
  const autoFetchLangfuseLogs = Boolean(state.testOptions?.autoFetchLangfuseLogs ?? true);
  const selectedLangfuseEnv = state.testOptions?.selectedLangfuseEnv || getDefaultLangfuseEnvironmentKey();
  const selectedTestModule = state.testOptions?.selectedTestModule || 'all';
  const autonomousWake = state.testOptions?.autonomousWake || {};
  const autonomousInput = state.testOptions?.autonomousInput || {};
  const autonomousResponse = state.testOptions?.autonomousResponse || {};
  const deviceOptions = state.testOptions?.device || {};
  const deviceRuntime = resolveDeviceRuntimeOptions(state.testOptions || {});
  const deviceLabel = deviceRuntime.profile.label;
  const isAiToy = deviceRuntime.deviceType === DEVICE_TYPES.AI_TOY;
  const speakerContinuousDialogueEnabled = deviceRuntime.deviceType === DEVICE_TYPES.SPEAKER
    && Boolean(deviceRuntime.speakerContinuousDialogue);
  const autonomousMonitoringEnabled = Boolean(
    autonomousWake.enabled
    || autonomousInput.enabled
    || autonomousResponse.enabled
  );
  const wakeIntervalDelayUsed = !isAiToy && !speakerContinuousDialogueEnabled && !autonomousMonitoringEnabled;
  const selectedEvaluationMetrics = state.testOptions?.agentEvaluation?.selectedMetrics || [];
  const evaluationPlan = React.useMemo(
    () => selectAgentEvaluationPlan(selectedEvaluationMetrics),
    [selectedEvaluationMetrics]
  );
  const [microphones, setMicrophones] = useState([]);
  const [microphoneStatus, setMicrophoneStatus] = useState('');
  const [speakers, setSpeakers] = useState([]);
  const [speakerStatus, setSpeakerStatus] = useState('');
  const [adbDevices, setAdbDevices] = useState([]);
  const [adbDeviceStatus, setAdbDeviceStatus] = useState('');
  const [listenerHealth, setListenerHealth] = useState(null);
  const [listenerHealthStatus, setListenerHealthStatus] = useState('');
  const [listenerRecovering, setListenerRecovering] = useState(false);
  const [wakePreviewPlaying, setWakePreviewPlaying] = useState(false);
  const [langfuseEnvVersion, setLangfuseEnvVersion] = useState(0);

  const moduleOptions = React.useMemo(() => {
    const modules = Array.from(new Set((state.testAudios || []).map((audio) => resolveTestCaseDirectory(audio))));
    return ['all', ...modules];
  }, [state.testAudios]);
  const langfuseEnvironmentEntries = React.useMemo(
    () => getLangfuseEnvironmentEntries(),
    [langfuseEnvVersion]
  );

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

  const handleDingTalkEnabledChange = (e) => {
    dispatch(actions.setDingTalkEnabled(e.target.checked));
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

  const handleDeviceOptionsChange = (patch) => {
    dispatch(actions.setDeviceOptions(patch));
  };

  const handleDeviceTypeChange = (type) => {
    handleDeviceOptionsChange({
      type,
      logSource: type === DEVICE_TYPES.AI_TOY ? LOG_SOURCES.SERIAL : LOG_SOURCES.ADB,
    });
  };

  const handleEvaluationMetricChange = (metricId, checked) => {
    const next = checked
      ? [...selectedEvaluationMetrics, metricId]
      : selectedEvaluationMetrics.filter((item) => item !== metricId);
    dispatch(actions.setAgentEvaluationMetrics(next));
  };

  const handleWakeTextChange = (e) => {
    dispatch(actions.setWakeWord(e.target.value));
  };

  const handleWakeAfterDelayChange = (e) => {
    dispatch(actions.setWakeDelay(parseInt(e.target.value, 10) || 0));
  };

  const handleWakeIntervalDelayChange = (e) => {
    dispatch(actions.setWakeIntervalDelay(parseInt(e.target.value, 10) || 0));
  };

  const handleWakePreview = async () => {
    if (!wakeWord.text.trim()) {
      alert('请输入唤醒词');
      return;
    }

    if (wakePreviewPlaying) {
      ttsService.stopAudio();
      setWakePreviewPlaying(false);
      return;
    }

    setWakePreviewPlaying(true);
    try {
      await ttsService.speak(wakeWord.text, {
        voice: defaultVoiceConfig.voice,
        voiceType: defaultVoiceConfig.voiceType,
        voiceName: defaultVoiceConfig.voiceName,
        provider: defaultVoiceConfig.provider,
        lang: defaultVoiceConfig.lang,
        volume: 200,
        rate: defaultVoiceConfig.rate
      });
    } catch (error) {
      console.error('Wake word preview failed:', error);
      alert('播放失败：' + error.message);
    } finally {
      setWakePreviewPlaying(false);
    }
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
    setSpeakerStatus('正在检测 音频输出设备...');
    try {
      const list = await responseMonitorService.listSpeakers();
      setSpeakers(list);
      setSpeakerStatus(list.length ? `已发现 ${list.length} 个 音频输出设备` : '未检测到 音频输出设备，请检查系统输出设备或浏览器权限');
    } catch (err) {
      setSpeakers([]);
      setSpeakerStatus(err?.message || '读取 音频输出设备失败');
    }
  };

  const refreshAudioDevices = async () => {
    await Promise.all([refreshMicrophones(), refreshSpeakers()]);
  };

  const refreshAdbDevices = async () => {
    setAdbDeviceStatus(`正在检测 ${deviceLabel} ${deviceRuntime.logSource === LOG_SOURCES.SERIAL ? 'USB串口' : 'ADB'} 设备...`);
    try {
      const result = await adbWakeService.listDevices({
        bridgeUrl: autonomousWake.bridgeUrl,
        deviceType: deviceRuntime.deviceType,
        logSource: deviceRuntime.logSource,
        serialPort: deviceRuntime.serialPort,
        baudrate: deviceRuntime.baudrate
      });
      const devices = (result.devices || []).filter((device) => device.state === 'device');
      setAdbDevices(devices);

      if (!devices.length) {
        const usbHint = deviceRuntime.logSource === LOG_SOURCES.SERIAL
          ? formatUsbDiagnostics(result.usbDiagnostics)
          : '';
        setAdbDeviceStatus(usbHint || `未检测到 ${deviceLabel} ${deviceRuntime.logSource === LOG_SOURCES.SERIAL ? 'USB串口' : 'ADB'} 设备`);
        if (autonomousWake.deviceId) {
          handleAutonomousWakeChange({ deviceId: '' });
        }
        return;
      }

      if (deviceRuntime.logSource === LOG_SOURCES.SERIAL) {
        const selectedSerialPort = selectSerialPortCandidate(devices, deviceRuntime.serialPort);
        if (selectedSerialPort) {
          if (selectedSerialPort.id !== deviceRuntime.serialPort) {
            handleDeviceOptionsChange({ serialPort: selectedSerialPort.id });
          }
          if (selectedSerialPort.id !== autonomousWake.deviceId) {
            handleAutonomousWakeChange({ deviceId: selectedSerialPort.id });
          }
          setAdbDeviceStatus(`已自动填充 ${deviceLabel} USB串口：${selectedSerialPort.id}`);
          return;
        }

        setAdbDeviceStatus(`检测到 ${devices.length} 个 USB串口，请选择 ${deviceLabel} 对应串口`);
        return;
      }

      setAdbDeviceStatus(`已检测到 ${devices.length} 个 ${deviceLabel} ${deviceRuntime.logSource === LOG_SOURCES.SERIAL ? 'USB串口' : 'ADB'} 设备`);
      const currentDeviceMatched = devices.some((device) => device.id === autonomousWake.deviceId);
      if (!autonomousWake.deviceId || !currentDeviceMatched) {
        handleAutonomousWakeChange({ deviceId: devices[0].id });
      }
    } catch (err) {
      setAdbDevices([]);
      setAdbDeviceStatus(err?.message || `${deviceLabel} 设备检测失败`);
    }
  };

  const refreshListenerHealth = async () => {
    setListenerHealthStatus(`正在自检 ${deviceLabel} 监听链路...`);
    try {
      const result = await adbWakeService.checkListenerHealth({
        bridgeUrl: autonomousWake.bridgeUrl,
        deviceId: autonomousWake.deviceId,
        deviceType: deviceRuntime.deviceType,
        logSource: deviceRuntime.logSource,
        serialPort: deviceRuntime.serialPort,
        baudrate: deviceRuntime.baudrate
      });
      setListenerHealth(result);
      const usbHint = deviceRuntime.logSource === LOG_SOURCES.SERIAL && !result.success
        ? formatUsbDiagnostics(result.usbDiagnostics)
        : '';
      setListenerHealthStatus(usbHint || result.message || (result.success ? '监听链路正常' : '监听链路异常'));
      const devices = (result.devices || []).filter((device) => device.state === 'device');
      if (devices.length) {
        setAdbDevices(devices);
      }
      if (result.selectedDeviceId && result.selectedDeviceId !== autonomousWake.deviceId) {
        handleAutonomousWakeChange({ deviceId: result.selectedDeviceId });
      }
      const checks = result.checks || {};
      notifyDingTalk(result.success ? 'SPEAKER_LISTENER_HEALTH_CHECK' : 'SPEAKER_LISTENER_HEALTH_FAILED', {
        state,
        details: [
          `自检结果：${result.success ? '正常' : '异常'}`,
          `ADB：${checks.adbConnected ? '正常' : '异常/未检查'}`,
          `${deviceLabel}：${checks.speakerOnline ? '在线' : '离线/未检查'}`,
          `logcat：${checks.logcatReadable ? '可读' : '不可读/未检查'}`,
          `boot_completed：${checks.bootCompleted ? '1' : '/'}`,
          `当前设备：${result.selectedDeviceId || autonomousWake.deviceId || '/'}`,
          `ADB Bridge：${autonomousWake.bridgeUrl || '/'}`,
          `检查时间：${result.checkedAtText || '/'}`,
          `结果说明：${result.message || (result.success ? '监听链路正常' : '监听链路异常')}`,
        ],
      });
    } catch (err) {
      setListenerHealth(null);
      setListenerHealthStatus(err?.message || `${deviceLabel} 监听链路自检失败`);
      notifyDingTalk('SPEAKER_LISTENER_HEALTH_FAILED', {
        state,
        details: [
          '自检结果：异常',
          `ADB Bridge：${autonomousWake.bridgeUrl || '/'}`,
          `当前设备：${autonomousWake.deviceId || '/'}`,
          `失败原因：${err?.message || `${deviceLabel} 监听链路自检失败`}`,
        ],
      });
    }
  };

  const recoverListenerLink = async () => {
    setListenerRecovering(true);
    setListenerHealthStatus('正在恢复 ADB / logcat 监听链路...');
    try {
      const result = await adbWakeService.recoverListenerLink({
        bridgeUrl: autonomousWake.bridgeUrl,
        deviceId: autonomousWake.deviceId,
        deviceType: deviceRuntime.deviceType,
        logSource: deviceRuntime.logSource,
        serialPort: deviceRuntime.serialPort,
        baudrate: deviceRuntime.baudrate
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
  const stageLabel = playback.currentType === 'wake-failed' ? '唤醒失败'
    : playback.currentType === 'wake' ? '播放唤醒音频'
    : playback.currentType === 'wake-detect' ? '监听唤醒结果'
    : playback.currentType === 'reboot' ? 'ADB 重启'
    : playback.currentType === 'reboot-wait' ? '重启后等待'
    : playback.currentType === 'asr-detect' ? '监听 ASR 输入'
    : playback.currentType === 'response-detect' ? 'Speaker 播报音频收录'
    : playback.currentType === 'langfuse-response-detect' ? 'Langfuse response 确认'
    : playback.currentType === 'response-end-wait' ? '播报结束冷却'
    : playback.currentType === 'test-ready' ? '准备播放测试音频'
    : playback.currentType === 'test-failed' ? '测试音频播放失败'
    : playback.currentType === 'test' ? '播放测试音频'
    : playback.currentType === 'delay' ? '唤醒后延迟'
    : playback.currentType === 'interval' ? '轮次间隔'
    : '等待开始';
  const runStatusLabel = playback.status === 'failed' ? '执行失败'
    : isPausedRef.current ? '已暂停'
    : isPlayingRef.current ? '测试中'
    : playback.status === 'completed' ? '已完成'
    : '等待开始';
  const processToneClass = playback.status === 'failed'
    ? 'border-red-500/40 bg-red-500/10'
    : isPlayingRef.current
    ? 'border-accent/40 bg-accent/10'
    : playback.status === 'completed'
    ? 'border-primary/40 bg-primary/10'
    : 'border-gray-700 bg-gray-800/45';

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
    if (isLocked || deviceRuntime.logSource !== LOG_SOURCES.SERIAL) return;
    refreshAdbDevices();
  }, [deviceRuntime.deviceType, deviceRuntime.logSource, autonomousWake.bridgeUrl]);

  useEffect(() => {
    if (isLocked) return;
    refreshListenerHealth();
  }, [
    autonomousWake.bridgeUrl,
    autonomousWake.deviceId,
    deviceRuntime.deviceType,
    deviceRuntime.logSource,
    deviceRuntime.serialPort,
    deviceRuntime.baudrate,
  ]);

  useEffect(() => {
    const handleLangfuseEnvironmentUpdate = () => {
      setLangfuseEnvVersion((value) => value + 1);
    };
    window.addEventListener(LANGFUSE_ENVIRONMENTS_UPDATED_EVENT, handleLangfuseEnvironmentUpdate);
    return () => window.removeEventListener(LANGFUSE_ENVIRONMENTS_UPDATED_EVENT, handleLangfuseEnvironmentUpdate);
  }, []);

  useEffect(() => {
    const keys = langfuseEnvironmentEntries.map(([key]) => key);
    if (keys.length > 0 && !keys.includes(selectedLangfuseEnv)) {
      dispatch(actions.setSelectedLangfuseEnv(keys[0]));
    }
  }, [dispatch, langfuseEnvironmentEntries, selectedLangfuseEnv]);

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
        语音控制台
        <span className="ml-2 px-2 py-0.5 bg-primary/20 text-primary text-xs rounded-full">
          自动闭环
        </span>
      </h2>

      <p className="mb-5 text-sm text-gray-400">
        {isAiToy ? '自动唤醒、收音和测试；中断后自动恢复，启动完成再继续。' : '自动完成唤醒、输入检测、响应采集和结果记录。'}
      </p>

      <section className={`mb-6 rounded-xl border p-5 ${processToneClass}`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${
                playback.status === 'failed' ? 'bg-red-400' :
                isPausedRef.current ? 'bg-amber-400' :
                isPlayingRef.current ? 'bg-accent animate-pulse' :
                playback.status === 'completed' ? 'bg-primary' : 'bg-gray-500'
              }`} />
              <p className="text-sm font-medium text-gray-300">测试过程</p>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-sm font-semibold text-white">
                {runStatusLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-sm text-gray-100">
                {stageLabel}
              </span>
            </div>

            <p className={`mt-4 min-h-[56px] whitespace-pre-wrap break-words text-lg font-semibold leading-relaxed [overflow-wrap:anywhere] ${
              playback.status === 'failed' ? 'text-red-100' : 'text-white'
            }`}>
              {currentAudioText || `唤醒词：${wakeWord.text || '-'}`}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg bg-black/20 p-3">
                <p className="text-xs text-gray-400">进度</p>
                <p className="mt-1 font-mono text-base text-white">
                  {isPlayingRef.current || isPausedRef.current ? `${playback.currentIndex + 1} / ${totalCases}` : `0 / ${totalCases}`}
                </p>
              </div>
              <div className="rounded-lg bg-black/20 p-3">
                <p className="text-xs text-gray-400">完成率</p>
                <p className="mt-1 font-mono text-base text-white">{progressPercent.toFixed(0)}%</p>
              </div>
              <div className="rounded-lg bg-black/20 p-3">
                <p className="text-xs text-gray-400">已用时间</p>
                <p className="mt-1 font-mono text-base text-white">{formatTime(playback.elapsedTime / 1000)}</p>
              </div>
              <div className="rounded-lg bg-black/20 p-3">
                <p className="text-xs text-gray-400">预计剩余</p>
                <p className="mt-1 font-mono text-base text-white">
                  {isPlayingRef.current ? formatTime(estimateRemainingTime() / 1000) : '-'}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex justify-between text-xs text-gray-400">
                <span>执行进度</span>
                <span>{progressPercent.toFixed(0)}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-black/30">
                <div
                  className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              {!isPlayingRef.current && !isPausedRef.current ? (
                <button
                  onClick={handleStart}
                  disabled={testAudios.length === 0}
                  className="flex items-center gap-2 rounded-lg bg-accent px-6 py-3 font-medium text-white transition-colors hover:bg-emerald-600 disabled:bg-gray-600"
                >
                  <span>▶</span>
                  开始测试
                </button>
              ) : isPausedRef.current ? (
                <button
                  onClick={handleResume}
                  className="flex items-center gap-2 rounded-lg bg-accent px-6 py-3 font-medium text-white transition-colors hover:bg-emerald-600"
                >
                  <span>▶</span>
                  继续
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  className="flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 font-medium text-white transition-colors hover:bg-amber-600"
                >
                  <span>⏸</span>
                  暂停
                </button>
              )}

              <button
                onClick={handleStop}
                disabled={!isPlayingRef.current && !isPausedRef.current}
                className="flex items-center gap-2 rounded-lg bg-red-500 px-6 py-3 font-medium text-white transition-colors hover:bg-red-600 disabled:bg-gray-600"
              >
                <span>⏹</span>
                停止
              </button>

              <button
                onClick={handleReset}
                className="flex items-center gap-2 rounded-lg bg-gray-600 px-6 py-3 font-medium text-white transition-colors hover:bg-gray-500"
              >
                <span>🔄</span>
                重置
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className={`mb-6 rounded-lg border p-4 ${
        listenerOk
          ? 'border-emerald-500/30 bg-emerald-500/10'
          : 'border-amber-500/30 bg-amber-500/10'
      }`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${listenerOk ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <p className="text-sm font-medium text-gray-100">{deviceLabel} 监听链路自检</p>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${
                listenerOk
                  ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200'
                  : 'border-amber-500/30 bg-amber-500/15 text-amber-200'
              }`}>
                {listenerOk ? '正常' : '待确认'}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-300">
              {listenerHealthStatus || `启动后自动检查 ${deviceLabel} 设备与 ${deviceRuntime.logSource === LOG_SOURCES.SERIAL ? 'USB串口' : 'ADB logcat'} 可读状态。`}
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs text-gray-400">
                设备类型
                <select
                  value={deviceRuntime.deviceType}
                  onChange={(e) => handleDeviceTypeChange(e.target.value)}
                  disabled={isLocked}
                  className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={DEVICE_TYPES.SPEAKER}>Speaker</option>
                  <option value={DEVICE_TYPES.AI_TOY}>AI玩具</option>
                </select>
              </label>

              {deviceRuntime.logSource === LOG_SOURCES.SERIAL && (
                <>
                  <label className="text-xs text-gray-400">
                    串口号
                    <input
                      type="text"
                      value={deviceOptions.serialPort || ''}
                      onChange={(e) => handleDeviceOptionsChange({ serialPort: e.target.value })}
                      disabled={isLocked}
                      list="serial-port-candidates"
                      placeholder="例如 COM7 或 /dev/cu.usbmodem3101"
                      className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-primary disabled:opacity-50"
                    />
                    <datalist id="serial-port-candidates">
                      {adbDevices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label || device.id}
                        </option>
                      ))}
                    </datalist>
                  </label>
                  <details className="self-start rounded-lg border border-gray-700 p-2">
                    <summary className="cursor-pointer text-xs text-gray-400">高级连接设置</summary>
                    <div className="mt-3 space-y-3">
                  <label className="text-xs text-gray-400">
                    波特率
                    <input
                      type="number"
                      min="1200"
                      step="1200"
                      value={deviceOptions.baudrate || deviceRuntime.baudrate}
                      onChange={(e) => handleDeviceOptionsChange({ baudrate: Number(e.target.value) || 115200 })}
                      disabled={isLocked}
                      className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white focus:border-primary disabled:opacity-50"
                    />
                  </label>
                      <label className="block text-xs text-gray-400">桥接服务地址
                        <input type="text" value={autonomousWake.bridgeUrl || ''}
                          onChange={e => handleAutonomousWakeChange({ bridgeUrl: e.target.value })}
                          disabled={isLocked} placeholder="http://127.0.0.1:17321"
                          className="mt-1 w-full rounded border border-gray-600 bg-gray-800 px-3 py-2" />
                      </label>
                    </div>
                  </details>
                </>
              )}
              {deviceRuntime.deviceType === DEVICE_TYPES.SPEAKER && (
                <label className="flex items-center gap-2 self-end rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs text-gray-200">
                  <input
                    type="checkbox"
                    checked={Boolean(deviceOptions.speakerContinuousDialogue)}
                    onChange={(e) => handleDeviceOptionsChange({ speakerContinuousDialogue: e.target.checked })}
                    disabled={isLocked}
                    className="h-4 w-4 accent-primary"
                  />
                  Speaker 连续对话
                </label>
              )}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-gray-400 sm:grid-cols-2 lg:grid-cols-4">
              {!isAiToy && <span>ADB：{listenerChecks.adbConnected ? '正常' : '异常/未检查'}</span>}
              <span>{deviceLabel}：{listenerChecks.speakerOnline ? '在线' : '离线/未检查'}</span>
              <span>{deviceRuntime.logSource === LOG_SOURCES.SERIAL ? 'USB串口' : 'logcat'}：{listenerChecks.logcatReadable || listenerChecks.serialConnected ? '可读' : '不可读/未检查'}</span>
              <span>最近检查：{listenerHealth?.checkedAtText || '-'}</span>
            </div>
            {listenerHealth?.selectedDeviceId && (
              <p className="mt-2 text-[11px] text-gray-500">
                当前设备：{listenerHealth.selectedDeviceId}
                {!isAiToy && listenerChecks.bootCompleted ? ' · boot_completed=1' : ''}
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

      <div className="mb-6 rounded-lg border border-primary/30 bg-primary/10 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-blue-100">唤醒词配置</h3>
          <button
            type="button"
            onClick={handleWakePreview}
            disabled={isLocked || !wakeWord.text.trim()}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-600 disabled:bg-gray-600 disabled:opacity-60"
          >
            {wakePreviewPlaying ? '停止试听' : '试听唤醒词'}
          </button>
        </div>

        <div className={`grid gap-3 ${wakeIntervalDelayUsed ? 'lg:grid-cols-[minmax(0,1fr)_150px_150px]' : 'lg:grid-cols-[minmax(0,1fr)_150px]'}`}>
          <label className="text-xs text-gray-400">
            唤醒词文本
            <input
              type="text"
              value={wakeWord.text}
              onChange={handleWakeTextChange}
              disabled={isLocked}
              placeholder="输入唤醒词，如：Hey, Cedar"
              className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-primary disabled:opacity-50"
            />
          </label>
          {!isAiToy && (
          <label className="text-xs text-gray-400">
            唤醒后延迟
            <select
              value={wakeWord.wakeAfterDelay}
              onChange={handleWakeAfterDelayChange}
              disabled={isLocked}
              className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm font-mono text-primary focus:border-primary disabled:opacity-50"
            >
              <option value="300">300ms</option>
              <option value="500">500ms</option>
              <option value="1000">1000ms</option>
              <option value="1500">1500ms</option>
            </select>
          </label>
          )}
          {wakeIntervalDelayUsed && (
            <label className="text-xs text-gray-400">
              唤醒间延迟
              <select
                value={wakeWord.wakeIntervalDelay}
                onChange={handleWakeIntervalDelayChange}
                disabled={isLocked}
                className="mt-1 w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm font-mono text-primary focus:border-primary disabled:opacity-50"
              >
                <option value="3000">3000ms</option>
                <option value="5000">5000ms</option>
                <option value="10000">10000ms</option>
                <option value="20000">20000ms</option>
              </select>
            </label>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span className="shrink-0 rounded bg-primary/20 px-3 py-2 text-primary">唤醒词</span>
          <span className="text-gray-500">→</span>
          <span className="shrink-0 rounded bg-blue-500/20 px-3 py-2 text-blue-300">{isAiToy ? '等待开始收音' : `等待 ${wakeWord.wakeAfterDelay}ms`}</span>
          <span className="text-gray-500">→</span>
          <span className="shrink-0 rounded bg-accent/20 px-3 py-2 text-accent">测试音频</span>
          {wakeIntervalDelayUsed && (
            <>
              <span className="text-gray-500">→</span>
              <span className="shrink-0 rounded bg-blue-500/20 px-3 py-2 text-blue-300">等待 {wakeWord.wakeIntervalDelay}ms</span>
              <span className="text-gray-500">→</span>
              <span className="shrink-0 rounded bg-primary/20 px-3 py-2 text-primary">下一轮唤醒</span>
            </>
          )}
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
            {langfuseEnvironmentEntries.map(([key, env]) => (
              <option key={key} value={key}>{env.label}</option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          测试结束后自动拉取该环境的 Langfuse 日志。
        </p>

        <div className="mt-3 p-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10">
          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-gray-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dingTalkEnabled}
                onChange={handleDingTalkEnabledChange}
                disabled={isLocked}
                className="w-4 h-4 rounded bg-gray-800 border-gray-600 disabled:opacity-50"
              />
              发送钉钉群消息
            </label>
            <span className={`text-xs px-2 py-1 rounded-full ${
              dingTalkEnabled
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-gray-700 text-gray-300 border border-gray-600'
            }`}>
              {dingTalkEnabled ? '已开启：测试节点发送通知' : '已关闭：不发送群消息'}
            </span>
          </div>
        </div>
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
        <details className="mt-3 rounded-lg border border-gray-700 p-3">
          <summary className="cursor-pointer text-sm text-gray-300">评测项设置 · {selectedEvaluationMetrics.length} 项已选</summary>
        <div className="mt-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-200">智能体评测项</p>
              <p className="mt-1 text-xs text-gray-400">按勾选项自动选择唯一评测方案。</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-emerald-100">
              <span className="text-gray-400">推荐方案：</span>
              <span className="font-semibold">{evaluationPlan.planName}</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-400">{evaluationPlan.reason}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            {AGENT_EVALUATION_METRIC_GROUPS.map((group) => (
              <div key={group.id} className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                <p className="mb-2 text-xs font-semibold text-gray-300">{group.label}</p>
                <div className="space-y-2">
                  {group.metrics.map((metric) => (
                    <label key={metric.id} className="flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={selectedEvaluationMetrics.includes(metric.id)}
                        onChange={(event) => handleEvaluationMetricChange(metric.id, event.target.checked)}
                        disabled={isLocked}
                        className="h-4 w-4 rounded bg-gray-800 border-gray-600 disabled:opacity-50"
                      />
                      <span>{metric.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        </details>
        <div className={`mt-3 p-3 rounded-lg border ${
          speakers.length
            ? 'border-gray-600 bg-gray-800/40'
            : 'border-red-500/40 bg-red-500/10'
        }`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={`text-sm font-medium ${speakers.length ? 'text-gray-200' : 'text-red-200'}`}>
                音频输出设备
              </p>
              <p className={`mt-1 text-xs ${speakers.length ? 'text-gray-400' : 'text-red-100'}`}>
                {speakerStatus || '尚未检测 音频输出设备'}
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
              刷新输出设备
            </button>
          </div>
          {!speakers.length && (
            <p className="mt-2 text-xs text-red-100">
              未监测到可用的 Speaker 设备时，播放测试可能无法正确输出声音；请连接扬声器或耳机后刷新。
            </p>
          )}
        </div>
        {isAiToy ? (
          <label className="mt-4 flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={Boolean(autonomousInput.enabled)}
              onChange={e => handleAutonomousInputChange({ enabled: e.target.checked })}
              disabled={isLocked} className="accent-primary" />
            校验设备是否识别到测试语音
          </label>
        ) : (
          <details className="mt-4 rounded-lg border border-gray-700 p-3">
            <summary className="cursor-pointer text-sm text-gray-300">高级设置 · Speaker 监测与录音</summary>
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
              {autonomousWake.enabled
                ? `启用：检测 ${deviceRuntime.deviceType === DEVICE_TYPES.AI_TOY ? 'Cedar 唤醒' : 'WakeupSuccess'}`
                : '关闭：使用固定等待'}
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
              {autonomousResponse.enabled ? '启用：Langfuse response 确认' : '关闭：不采集响应'}
            </span>
          </div>

          {autonomousResponse.enabled && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm text-gray-100">
                    <span className="block font-medium">方案1：沿用当前 Speaker 响应采集逻辑</span>
                    <span className="block mt-1 text-xs text-emerald-100/80">
                      使用麦克风响应采集与当前播报结束保护逻辑，再进入下一轮唤醒。
                    </span>
                  </div>
                  <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-100 border border-emerald-500/30">
                    默认
                  </span>
                </div>
              </div>
              <div className="md:col-span-2 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10">
                <div className="flex items-start justify-between gap-3">
                  <label className="inline-flex items-start gap-2 text-sm text-gray-100 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autonomousResponse.langfuseResponseGateEnabled !== false}
                      onChange={(e) => handleAutonomousResponseChange({ langfuseResponseGateEnabled: e.target.checked })}
                      disabled={isLocked}
                      className="mt-0.5 w-4 h-4 rounded bg-gray-800 border-gray-600 disabled:opacity-50"
                    />
                    <span>
                      <span className="block font-medium">方案2：Langfuse response_complete 确认后进入下一轮</span>
                      <span className="block mt-1 text-xs text-cyan-100/80">
                        实时轮询 Langfuse 日志，命中 response_complete 且解析到非空 TTS/response 内容后触发下一轮唤醒；未命中会标记本轮失败，并继续进入下一轮唤醒。
                      </span>
                    </span>
                  </label>
                  <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-cyan-500/20 text-cyan-100 border border-cyan-500/30">
                    新方案
                  </span>
                </div>
              </div>
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
                Langfuse 确认超时
                <select
                  value={autonomousResponse.langfuseResponseTimeoutMs || 120000}
                  onChange={(e) => handleAutonomousResponseChange({ langfuseResponseTimeoutMs: Number(e.target.value) })}
                  disabled={isLocked || autonomousResponse.langfuseResponseGateEnabled === false}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={60000}>60s</option>
                  <option value={120000}>120s</option>
                  <option value={180000}>180s</option>
                </select>
              </label>
              <label className="text-xs text-gray-400">
                Langfuse 轮询间隔
                <select
                  value={autonomousResponse.langfuseResponsePollIntervalMs || 3000}
                  onChange={(e) => handleAutonomousResponseChange({ langfuseResponsePollIntervalMs: Number(e.target.value) })}
                  disabled={isLocked || autonomousResponse.langfuseResponseGateEnabled === false}
                  className="mt-1 w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary disabled:opacity-50"
                >
                  <option value={1000}>1s</option>
                  <option value={3000}>3s</option>
                  <option value={5000}>5s</option>
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
          </details>
        )}
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
