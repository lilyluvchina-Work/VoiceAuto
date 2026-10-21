import React, { useEffect, useRef, useState } from 'react';
import BridgeRestartButton from '../../components/BridgeRestartButton';
import { exportRun, getRecording, request, resetRun, upload } from './service.js';
import { formatMs, STATUS_LABELS, summarize, caseResults, stageLabel, AUDIO_LABELS } from './report.js';
import { getRobotConfig } from '../../services/dingTalkService.js';
import { useTest } from '../../stores/testStore';
import { buildGeneratedAudioConfig } from '../../utils/testCaseAudioConfig.js';
import { synthesizeTestAudioBlob } from '../../services/testAudioApi.js';
import { DEVICE_TYPES as TYPES, deviceWakeConfig, selectTestAudios, resolveAudioFile, selectAudioDevices, migrateWakeResponse } from './audioSource.js';

const DEFAULTS = { taskName: '音箱黑盒测试', deviceType: 'xiaomi', deviceName: '', inputDeviceId: '', outputDeviceId: '',
  wakeTimeoutMs: 5000, replyTimeoutMs: 15000, extraRetries: 5, retrySilenceMs: 2000, minVoiceMs: 200,
  silenceMs: 800, maxReplyMs: 60000, repeatCount: 1, sampleRate: 16000, noiseMultiplier: 4,
  minimumRms: .008, templateThreshold: .82, tailGuardMs: 300, trimTrailingSilence: false,
  inputCompensationMs: 0, outputCompensationMs: 0, baselineMs: 1500, templateKind: 'speech', language: 'zh', wakeWord: '小爱同学' };
const FIELDS = [
  ['wakeTimeoutMs', '唤醒回应超时 (ms)', 100, 120000, 100], ['replyTimeoutMs', '语音回复超时 (ms)', 100, 120000, 100],
  ['extraRetries', '超时额外重试次数', 0, 5, 1], ['retrySilenceMs', '重试前静音 (ms)', 0, 60000, 100],
  ['wakeMinVoiceMs', '最短唤醒语音 (ms)', 40, 1000, 20],
  ['minVoiceMs', '最短连续语音 (ms)', 40, 3000, 20], ['silenceMs', '回复结束静音 (ms)', 100, 10000, 20],
  ['maxReplyMs', '最长回复录制 (ms)', 1000, 300000, 1000], ['repeatCount', '每条测试重复次数', 1, 100, 1],
  ['tailGuardMs', '播放后残响屏蔽 (ms)', 0, 3000, 20], ['noiseMultiplier', '底噪倍数', 1.5, 20, .5],
  ['minimumRms', '最小音量阈值 (RMS)', .0001, .5, .001], ['templateThreshold', '唤醒样本相似度', .5, 1, .01],
  ['inputCompensationMs', '输入校准补偿 (ms)', -2000, 2000, .1], ['outputCompensationMs', '输出校准补偿 (ms)', -2000, 2000, .1],
];
const ACTIVE = new Set(['running', 'calibrating', 'pausing', 'paused', 'resuming', 'stopping']);
const inputClass = 'mt-1 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-gray-100 disabled:opacity-50';
const buttonClass = 'rounded-lg border border-gray-600 px-4 py-2 text-sm hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed';
function readStored(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function writeStored(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Native results remain on disk if browser quota is full. */ } }
const profileKey = type => `speaker-blackbox-profile-v1-${type}`;
function Recording({ bridge, runId, file, onError }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url ? <div><audio aria-label="完整用例录音" controls preload="none" src={url} className="max-w-56" /><a href={url} download={file.split('/').pop()} className="text-blue-300 underline">下载 WAV</a></div>
    : <button className={buttonClass} disabled={loading} onClick={async () => {
      setLoading(true);
      try { setUrl(URL.createObjectURL(await getRecording(bridge, runId, file))); }
      catch (error) { onError(error.message); } finally { setLoading(false); }
    }}>{loading ? '加载中…' : '回放完整 WAV'}</button>;
}

export default function SpeakerBlackbox({ otherTesting = false, onActivityChange, onOpenAudios, visible = true, bridgeRestarting = false, onBridgeRestartingChange }) {
  const { state } = useTest();
  const initial = useRef(readStored(profileKey('xiaomi'), {})).current;
  const [config, setConfig] = useState({ ...DEFAULTS, ...deviceWakeConfig(initial.config?.deviceType || 'xiaomi'), ...migrateWakeResponse(initial.config) });
  const [templates, setTemplates] = useState(initial.templates || []);
  const [calibration, setCalibration] = useState(initial.calibration || null);
  const [bridge, setBridge] = useState(readStored('speaker-blackbox-bridge', 'http://127.0.0.1:17321'));
  const [devices, setDevices] = useState([]);
  const [wake, setWake] = useState(null);
  const cases = selectTestAudios(state.testAudios, state.testOptions?.selectedTestModule || 'all');
  const wakeCache = useRef(null);
  const [run, setRun] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pollVersion, setPollVersion] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [googleChime, setGoogleChime] = useState(false);
  const [wakePreview, setWakePreview] = useState('');
  const assets = useRef(new Map());
  const autoStart = useRef(false);
  const resetInProgress = useRef(false);
  const generation = useRef(0);
  const pollController = useRef(null);
  const active = ACTIVE.has(run?.status);
  const awaitingNotification = Object.values(run?.notifications || {}).some(item => item.status === 'pending');
  const locked = busy || active || bridgeRestarting;
  const stats = summarize(run?.attempts);
  const change = (key, value) => setConfig(previous => ({ ...previous, [key]: value }));
  function clearCurrentRun(id) {
    autoStart.current = false; generation.current++;
    pollController.current?.abort();
    setRun(null); setTemplates([]); setCalibration(null);
    setWake(null); wakeCache.current = null; assets.current.clear();
    setHistory(previous => previous.filter(item => item.id !== id));
    writeStored('speaker-blackbox-last-run', null);
    writeStored(profileKey(config.deviceType), { config, templates: [], calibration: null });
    setError('');
    setMessage('任务已结束，测试数据及录音已清空，可重新开始测试。');
  }
  function restoreRun(result) {
    if (result.status === 'missing') { clearCurrentRun(result.id); return; }
    setConfig({ ...DEFAULTS, ...deviceWakeConfig(result.config?.deviceType || 'xiaomi'), ...migrateWakeResponse(result.config) });
    setWake(null); wakeCache.current = null;
    setTemplates(result.templates || []); setCalibration(result.calibration || null);
    setGoogleChime(Boolean(result.config?.googleWakeChimeConfirmed));
    setRun(result); writeStored('speaker-blackbox-last-run', result.id);
  }
  useEffect(() => { onActivityChange?.(busy || active); }, [busy, active, onActivityChange]);
  useEffect(() => {
    writeStored(profileKey(config.deviceType), { config, templates, calibration });
  }, [config, templates, calibration]);
  useEffect(() => { writeStored('speaker-blackbox-bridge', bridge); }, [bridge]);
  useEffect(() => {
    if (!visible || active) return;
    const controller = new AbortController();
    request(bridge, { action: 'devices' }, controller.signal).then(result => {
      if (!controller.signal.aborted) {
        setDevices(result.devices);
        setConfig(previous => ({ ...previous, ...selectAudioDevices(result.devices, previous) }));
      }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [visible, bridge]);
  useEffect(() => {
    setWake(null); wakeCache.current = null;
  }, [config.wakeWord, config.language, state.defaultVoiceConfig]);
  useEffect(() => {
    if (!wake) { setWakePreview(''); return; }
    const url = URL.createObjectURL(wake); setWakePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [wake]);
  useEffect(() => {
    if (resetInProgress.current) return;
    if (run?.status === 'calibrated') {
      setTemplates(run.templates || []); setCalibration(run.calibration || null);
      setMessage('校准已保存，请回放实际采集的回应样本，确认不含电脑播放及环境噪声。');
      if (autoStart.current) {
        autoStart.current = false;
        operate(() => prepare(false, run));
      }
    }
    if (['error', 'aborted', 'interrupted'].includes(run?.status)) autoStart.current = false;
  }, [run?.status, run?.id]);
  useEffect(() => {
    let disposed = false;
    const version = generation.current;
    const id = readStored('speaker-blackbox-last-run', null);
    if (id) request(bridge, { action: 'status', id }).then(result => { if (!disposed && generation.current === version) restoreRun(result); }).catch(() => {});
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if ((!active && !awaitingNotification) || !run?.id) return;
    const controller = new AbortController();
    pollController.current = controller;
    const version = generation.current;
    let timer;
    const poll = async () => {
      try {
        const next = await request(bridge, { action: 'status', id: run.id }, controller.signal);
        if (!controller.signal.aborted && generation.current === version) {
          if (next.status === 'missing') clearCurrentRun(next.id);
          else { setRun(next); if (next.error) setError(next.error); }
        }
      } catch (failure) { if (!controller.signal.aborted) setError(`状态读取失败，任务仍在本机执行：${failure.message}`); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 500);
    };
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, awaitingNotification, run?.id, bridge, pollVersion]);

  async function resetTesting() {
    if (!run?.id || resetInProgress.current) return;
    const id = run.id;
    resetInProgress.current = true; setResetting(true);
    autoStart.current = false; generation.current++;
    pollController.current?.abort();
    setMessage('正在结束任务并清空测试数据…');
    try {
      await resetRun(bridge, id, { onProgress: setMessage });
      clearCurrentRun(id);
    } finally {
      resetInProgress.current = false; setResetting(false);
      setPollVersion(previous => previous + 1);
    }
  }

  async function operate(operation) {
    setError(''); setBusy(true);
    try { await operation(); } catch (failure) { autoStart.current = false; setError(failure.message); }
    finally { setBusy(false); }
  }
  async function draft() {
    if (run && ['draft', 'calibrated'].includes(run.status)) return run;
    const created = await request(bridge, { action: 'create', config });
    writeStored('speaker-blackbox-last-run', created.id); setRun(created); return created;
  }
  async function putAsset(id, file) {
    if (!assets.current.has(id)) assets.current.set(id, new WeakMap());
    const cache = assets.current.get(id);
    if (cache.has(file)) return cache.get(file);
    setMessage(`上传 ${file.name}`);
    const assetId = await upload(bridge, id, file, percent => setMessage(`上传 ${file.name}：${percent}%`));
    cache.set(file, assetId); return assetId;
  }
  async function prepare(calibrating, calibratedRun) {
    const currentTemplates = calibratedRun?.templates || templates;
    const currentCalibration = calibratedRun?.calibration || calibration;
    if (otherTesting) throw new Error('请先停止其他语音测试，避免共享音频设备');
    if (!config.inputDeviceId || !config.outputDeviceId) throw new Error('请检测并选择输入和输出设备');
    if (!config.wakeWord?.trim()) throw new Error('请输入唤醒词');
    if (config.deviceType === 'google' && !googleChime) throw new Error('请先在 Google 音箱设置中开启唤醒提示音并勾选确认');
    for (const [key, label, min, max] of FIELDS) if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max) throw new Error(`${label}超出有效范围`);
    if (!calibrating && (!cases.length || !currentTemplates.length)) throw new Error('请在测试用例管理生成测试音频，并校准或导入唤醒回应样本');
    const current = await draft();
    const wakeAsset = await putAsset(current.id, await generateWake());
    const testCases = [];
    if (!calibrating) for (const audio of cases) {
      const file = await resolveAudioFile(audio);
      testCases.push({ id: await putAsset(current.id, file), sourceId: audio.id, name: audio.caseTitle || audio.name || file.name,
        text: audio.text || audio.caseTitle || audio.name || file.name, language: audio.config?.lang || config.language });
    }
    const next = await request(bridge, { action: 'configure', id: current.id, config: { ...config, googleWakeChimeConfirmed: googleChime },
      wakeAsset, cases: testCases, templates: currentTemplates, calibration: currentCalibration });
    setRun(next);
    setRun(await request(bridge, { action: calibrating ? 'calibrate' : 'start', id: current.id,
      ...(!calibrating ? { notificationConfig: getRobotConfig() } : {}) }));
    setMessage(calibrating ? '正在校准，请保持安静，音箱需能够回应唤醒词。' : '测试已在本机开始；切换菜单或刷新页面后可恢复查看。');
  }
  function switchType(type) {
    const profile = readStored(profileKey(type), {});
    setConfig(previous => {
      const next = { ...DEFAULTS, inputDeviceId: previous.inputDeviceId, outputDeviceId: previous.outputDeviceId, ...deviceWakeConfig(type, profile.config) };
      return devices.length ? { ...next, ...selectAudioDevices(devices, next) } : next;
    });
    setTemplates(profile.templates || []); setCalibration(profile.calibration || null);
    autoStart.current = false;
    setWake(null); wakeCache.current = null; setRun(null); setGoogleChime(false); setMessage('');
  }
  async function startTesting() {
    if (!cases.length) throw new Error('请先在测试用例管理生成测试音频');
    autoStart.current = !templates.length;
    await prepare(!templates.length);
  }
  async function generateWake() {
    const text = config.wakeWord?.trim();
    if (!text) throw new Error('请输入唤醒词');
    const voice = buildGeneratedAudioConfig({ voiceValue: state.defaultVoiceConfig.voiceType || state.defaultVoiceConfig.voice,
      lang: config.language === 'en' ? 'en-US' : 'zh-CN', volume: state.defaultVoiceConfig.volume, rate: state.defaultVoiceConfig.rate });
    const key = JSON.stringify({ text, voice });
    if (wakeCache.current?.key === key) return wakeCache.current.file;
    setMessage(`生成唤醒音频：${text}`);
    const blob = await synthesizeTestAudioBlob({ text, ...voice });
    const file = new File([blob], `wake-${text}.mp3`, { type: blob.type });
    wakeCache.current = { key, file }; setWake(file); return file;
  }
  async function importSamples(files) {
    const current = await draft();
    const added = [];
    for (const file of files) {
      const assetId = await putAsset(current.id, file);
      const result = await request(bridge, { action: 'template', id: current.id, assetId, kind: config.templateKind, name: file.name });
      added.push(result.template);
    }
    if (templates.length + added.length > 20) throw new Error('最多保存 20 个回应样本');
    setTemplates(previous => [...previous, ...added]); setMessage('回应样本已导入，请确保仅包含被测音箱的实际回应。');
  }
  return <section className="mx-auto max-w-7xl space-y-5 text-gray-200">
    <div><h2 className="text-2xl font-semibold">音箱黑盒测试</h2><p className="mt-2 text-sm text-gray-400">选择设备后开始测试，音频使用“测试音频”菜单中的当前列表。</p></div>
    {error && <div role="alert" className="rounded-lg border border-red-700 bg-red-950/40 p-3 text-red-200">{error}</div>}
    {message && <p role="status" className="text-sm text-blue-200">{message}</p>}
    <fieldset disabled={locked} className="rounded-xl border border-gray-700 bg-gray-800/60 p-5 space-y-4">
      <legend className="px-2 font-semibold">测试设置</legend>
      <div className="grid gap-4 md:grid-cols-3">
        <label>设备类型<select className={inputClass} value={config.deviceType} onChange={event => switchType(event.target.value)}>{Object.entries(TYPES).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>唤醒词<input className={inputClass} value={config.wakeWord} onChange={event => change('wakeWord', event.target.value)} /></label>
        <label>唤醒应答（参考）<input className={inputClass} value={config.wakeResponse || ''} onChange={event => change('wakeResponse', event.target.value)} /></label>
      </div>
      <div className="grid items-end gap-4 md:grid-cols-3">{[['input', 'inputDeviceId', '输入麦克风'], ['output', 'outputDeviceId', '输出扬声器']].map(([kind, key, label]) => <label key={key}>{label}<select className={inputClass} value={config[key]} onChange={event => change(key, event.target.value)}><option value="">请选择</option>{config[key] && !devices.some(d => d.deviceId === config[key]) && <option value={config[key]}>已保存设备（请检测确认）</option>}{devices.filter(d => d.kind === kind).map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}</select></label>)}
        <button type="button" className={buttonClass} onClick={() => operate(async () => { const result = await request(bridge, { action: 'devices' }); setDevices(result.devices); setConfig(previous => ({ ...previous, ...selectAudioDevices(result.devices, previous) })); setMessage('音频设备已更新。'); })}>重新检测设备</button></div>
      {config.deviceType === 'google' && <label className="block text-sm text-amber-200"><input type="checkbox" checked={googleChime} onChange={event => setGoogleChime(event.target.checked)} className="mr-2" />已在 Google 音箱设置中开启唤醒提示音（Hey Google）</label>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-gray-300">测试音频：{cases.length} 条 · {state.testOptions?.selectedTestModule === 'all' || !state.testOptions?.selectedTestModule ? '全部模块' : state.testOptions.selectedTestModule}</p><button className={buttonClass} onClick={onOpenAudios}>前往测试音频</button></div>
      <p className="text-sm text-gray-400">{!cases.length && '请在“测试音频”菜单准备音频。'}{templates.length ? `${templates.length} 个应答样本` : '首次自动采集应答'}</p>
    </fieldset>
    <div className="flex flex-wrap gap-3"><button disabled={locked || otherTesting} className={`${buttonClass} bg-blue-600 text-white`} onClick={() => operate(startTesting)}>开始测试</button>
      <button disabled={busy || !['running', 'paused'].includes(run?.status)} className={buttonClass} onClick={() => operate(async () => {
        const action = run.status === 'paused' ? 'resume' : 'pause';
        setRun(await request(bridge, { action, id: run.id }));
        setMessage(action === 'pause' ? '正在暂停并保存当前录音；继续时重新执行当前用例。' : '正在继续测试，重新唤醒后执行当前用例。');
      })}>{run?.status === 'paused' ? '继续测试' : run?.status === 'pausing' ? '暂停中…' : run?.status === 'resuming' ? '继续中…' : '暂停测试'}</button>
      <button disabled={busy || !active || run?.status === 'stopping'} className={`${buttonClass} text-red-200`} onClick={() => { autoStart.current = false; operate(async () => { await request(bridge, { action: 'stop', id: run.id }); setRun(previous => ({ ...previous, status: 'stopping' })); }); }}>停止并保存</button>
      <button disabled={busy || bridgeRestarting || !run} className={buttonClass} title="结束当前任务并清空本任务的测试数据和录音" onClick={() => operate(resetTesting)}>{resetting ? '重置中…' : '重置测试'}</button>
      <button disabled={locked || !run} className={buttonClass} onClick={() => operate(async () => { await exportRun(bridge, run.id, setMessage); setMessage('报告及录音已导出。'); })}>导出报告</button>
      <BridgeRestartButton bridgeUrl={bridge} disabled={locked || otherTesting || awaitingNotification} onRestartingChange={onBridgeRestartingChange} onRestarted={async () => {
        const result = await request(bridge, { action: 'devices' }); setDevices(result.devices);
        setConfig(previous => ({ ...previous, ...selectAudioDevices(result.devices, previous) })); setError('');
      }} />
    </div>
    <details className="rounded-xl border border-gray-700 bg-gray-800/60 p-5"><summary className="cursor-pointer font-semibold">更多设置与应答样本</summary><fieldset disabled={locked} className="mt-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-3"><label>设备名称<input className={inputClass} value={config.deviceName} onChange={event => change('deviceName', event.target.value)} placeholder="可选" /></label><label>任务名称<input className={inputClass} value={config.taskName} onChange={event => change('taskName', event.target.value)} /></label><label>测试音频语言<select className={inputClass} value={config.language} onChange={event => change('language', event.target.value)}><option value="zh">中文</option><option value="en">英文</option></select></label></div>
      <p className="text-xs text-gray-400">无回声消除模式：请保持环境安静，快速或重叠回复可能漏检。</p><label className="block">本机音频桥接地址<input className={inputClass} value={bridge} onChange={event => setBridge(event.target.value)} /></label>
      <button className={buttonClass} onClick={() => operate(async () => { await generateWake(); setMessage('唤醒音频已生成，可在下方试听。'); })}>生成唤醒音频 / 试听</button>
      {wakePreview && <div className="space-y-2"><span className="text-sm">唤醒音频试听（浏览器默认输出；正式测试使用上方选定输出）</span><audio className="max-w-full" controls src={wakePreview} /></div>}
      <div className="flex flex-wrap items-end gap-3"><label>回应样本类型<select className={inputClass} value={config.templateKind} onChange={event => { const kind = event.target.value; setConfig(previous => ({ ...previous, templateKind: kind, wakeDetectionMode: kind === 'tone' || previous.deviceType === 'google' ? 'template_only' : 'speech_or_template' })); }}><option value="speech">唤醒语音</option><option value="tone">唤醒提示音</option></select></label>
        <label>唤醒判定<select className={inputClass} value={config.wakeDetectionMode} disabled={config.deviceType === 'google' || config.templateKind === 'tone'} onChange={event => change('wakeDetectionMode', event.target.value)}><option value="speech_or_template">兼容模式：样本或有效语音</option><option value="template_only">严格模式：仅匹配样本</option></select></label>
        <button className={buttonClass} onClick={() => { autoStart.current = false; operate(() => prepare(true)); }}>重新采集应答样本</button>
        <label className={buttonClass}>导入回应样本<input type="file" multiple accept="audio/*" className="mt-2 block max-w-64 text-xs" onChange={event => { const files = [...event.target.files]; event.target.value = ''; operate(() => importSamples(files)); }} /></label></div>
      <ul className="space-y-2 text-sm">{templates.map((template, index) => <li key={`${template.name}-${index}`} className="flex items-center justify-between gap-4"><span>{template.kind === 'tone' ? '提示音' : '语音'} · {template.name} · {formatMs(template.frames.length * 20)}</span><button className={buttonClass} onClick={() => setTemplates(previous => previous.filter((_, n) => n !== index))}>删除样本</button></li>)}</ul>
      {calibration?.clipping && <p className="text-xs text-amber-200">输入音量过高，请降低增益后重新采集。</p>}
    </fieldset></details>
    <details className="rounded-xl border border-gray-700 bg-gray-800/60 p-5"><summary className="cursor-pointer font-semibold">超时、重试与检测参数</summary><fieldset disabled={locked} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{FIELDS.map(([key, label, min, max, step]) => <label key={key} className="text-sm">{label}<input className={inputClass} type="number" min={min} max={max} step={step} value={config[key]} onChange={event => change(key, event.target.value === '' ? '' : Number(event.target.value))} /></label>)}<label className="text-sm">采样率<select className={inputClass} value={config.sampleRate} onChange={event => change('sampleRate', Number(event.target.value))}>{[16000, 32000, 48000].map(rate => <option key={rate} value={rate}>{rate} Hz</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.trimTrailingSilence} onChange={event => change('trimTrailingSilence', event.target.checked)} />裁剪文件尾部静音</label></fieldset></details>
    <details className="text-sm text-gray-400"><summary className="cursor-pointer">历史任务</summary><div className="mt-3 space-y-3"><div className="flex flex-wrap gap-3"><button disabled={locked} className={buttonClass} onClick={() => { autoStart.current = false; setRun(null); assets.current.clear(); writeStored('speaker-blackbox-last-run', null); setMessage('下一次开始将创建新任务，保留历史数据。'); }}>新建任务</button><button disabled={busy} className={buttonClass} onClick={() => operate(async () => setHistory((await request(bridge, { action: 'history' })).runs))}>刷新历史任务</button></div></div></details>
    {history.length > 0 && <label className="block text-sm">恢复查看本机历史任务<select disabled={locked} className={inputClass} value={run?.id || ''} onChange={event => { const id = event.target.value; if (id) operate(async () => restoreRun(await request(bridge, { action: 'status', id }))); }}><option value="">选择任务</option>{history.map(item => <option key={item.id} value={item.id}>{item.startedAt || '未开始'} · {item.taskName} · {item.status} · {item.attempts} 次尝试</option>)}</select></label>}
    {run && <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-5 space-y-4">
      <div role="status" className="flex flex-wrap justify-between gap-3"><span>{run.config?.taskName} · {run.status} · {active ? run.phase || '正在打开设备' : run.error || '已保存'}</span><span>{run.currentCase || ''} {run.currentAttempt ? `第 ${run.currentAttempt} 次尝试` : ''} · {stats.attempts} 次尝试</span></div>
      <div className="flex items-center gap-3 text-sm"><label htmlFor="blackbox-level">输入音量</label><meter id="blackbox-level" min="0" max="0.3" value={run.level || 0} className="h-5 flex-1" /><span>{run.recording ? '● 录音中' : '未录音'}{run.clipping ? ' · 削波，请降低输入增益' : ''}</span></div>
      <progress aria-label="已完成用例" value={stats.completedCases} max={run.totalCases || 1} className="h-2 w-full" />
      <p className="text-sm">已完成用例 {stats.completedCases} / {run.totalCases || 0} · 最终成功 {stats.finalSuccessCount} · 平均耗时 {formatMs(stats.latency.mean)} · 首次唤醒 {stats.firstWakeCount}/{stats.firstDenominator} · 首次回复 {stats.firstReplyCount}/{stats.firstDenominator}</p>
      {run.localPath && <p className="break-all text-xs text-gray-400">本机保存目录：{run.localPath}</p>}
      <p className="text-xs text-gray-400">钉钉通知：{Object.entries(run.notifications || {}).map(([event, result]) => `${event === 'started' ? '开始' : '结束'}${({ pending: '发送中', sent: '已发送', skipped: '未发送', failed: '发送失败' })[result.status] || result.status}${result.message ? `（${result.message}）` : ''}`).join('；') || '尚未开始测试'}。使用配置中心已启用的钉钉机器人。</p>
      <p className="text-xs text-gray-400">新任务每条用例的完整录音包含全部重试：左声道为麦克风，右声道为电脑播放。语音回复不包含音乐；混合或不确定的声音标记为需复核。</p>
      <div className="overflow-x-auto"><table className="min-w-[1000px] w-full text-left text-sm"><thead><tr>{['用例', '测试音频内容', '唤醒结果（播放）', '应答', '测试音频播放', '回复', '声音类型', '响应时间', '结果 / 备注', '完整录音'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{caseResults(run).map(result => <tr key={`${run.id}-${result.caseId}`} className="border-t border-gray-700"><td className="p-3">{result.caseId}<br />{result.attempt} 次尝试</td><td className="p-3 max-w-72 whitespace-pre-wrap break-words">{result.text}</td>{['wakePlayback', 'wakeResponse', 'testPlayback', 'reply'].map(key => <td key={key} className="p-3">{stageLabel(result, key)}</td>)}<td className="p-3">{AUDIO_LABELS[result.audioKind] || '—'}</td><td className="p-3 whitespace-nowrap">{formatMs(result.responseMs)}</td><td className="p-3 max-w-64 break-words">{STATUS_LABELS[result.status] || result.status}<p className="text-xs text-amber-200">{result.error || result.flags?.join('；')}</p></td><td className="p-3">{result.recording && <Recording key={`${run.id}-${result.caseId}`} bridge={bridge} runId={run.id} file={result.recording} onError={setError} />}</td></tr>)}</tbody></table></div>
      {run.calibration?.sampleRecording && <div className="flex flex-wrap items-center gap-3 text-sm"><span>校准实际唤醒样本：</span><Recording key={`${run.id}-sample`} bridge={bridge} runId={run.id} file={run.calibration.sampleRecording} onError={setError} /><span>完整校准录音：</span><Recording key={`${run.id}-calibration`} bridge={bridge} runId={run.id} file="recordings/calibration_raw.wav" onError={setError} /></div>}
      <details><summary className="cursor-pointer text-sm text-gray-300">逐次尝试与人工复核</summary><div className="overflow-x-auto"><table className="min-w-[850px] w-full text-left text-sm"><thead><tr className="border-b border-gray-600">{['用例 / 音频', '尝试', '唤醒', '结果', '响应耗时', '录音 / 人工复核'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{(run.attempts || []).map(attempt => <tr key={`${run.id}-${attempt.caseId}-${attempt.attempt}`} className="border-b border-gray-700"><td className="p-3 max-w-56 break-words">{attempt.caseId}<br />{attempt.text || attempt.name}</td><td className="p-3">{attempt.attempt === 1 ? '首次' : `重试 ${attempt.attempt - 1}`}</td><td className="p-3">{attempt.wakeDetected ? '检测到回应' : '未检测到回应'}</td><td className="p-3">{STATUS_LABELS[attempt.status] || attempt.status}<p className="mt-1 text-xs text-amber-200">{attempt.error || attempt.flags?.join('；')}</p></td><td className="p-3 whitespace-nowrap">{formatMs(attempt.responseMs)}{attempt.overlap && '（重叠）'}</td><td className="space-y-2 p-3">{attempt.recording && <Recording bridge={bridge} runId={run.id} file={attempt.recording} onError={setError} />}<select aria-label={`${attempt.caseId} 第 ${attempt.attempt} 次人工复核`} className={inputClass} value={attempt.review || ''} onChange={event => { const review = event.target.value; operate(async () => setRun(await request(bridge, { action: 'review', id: run.id, caseId: attempt.caseId, attempt: attempt.attempt, review }))); }}><option value="">未复核</option>{['已人工复核', '疑似干扰', '需复核'].map(value => <option key={value}>{value}</option>)}</select></td></tr>)}</tbody></table></div>
      </details>
    </div>}
  </section>;
}
