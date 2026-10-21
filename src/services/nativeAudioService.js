import { buildRecordTimingPlan } from './responseMonitorService.js';

async function request(bridgeUrl, body, signal) {
  const url = (bridgeUrl || 'http://127.0.0.1:17321').replace(/\/+$/, '');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetch(`${url}/api/audio/native`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message === 'not found'
      ? '请更新并重启本机桥接服务，当前版本不支持外接音频采集'
      : data.message || '本地音频采集请求失败');
    return data;
  } catch (error) {
    if (error instanceof TypeError) throw new Error('无法连接本地采集服务，请在连接外接设备的电脑启动 npm run adb:bridge');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function listNativeInputs(bridgeUrl) {
  return (await request(bridgeUrl, { action: 'devices' })).devices;
}

export async function detectSpeakerResponse(options = {}) {
  const { bridgeUrl, signal, onLog, isPlaybackComplete, ...config } = options;
  if (signal?.aborted) throw new Error('本地采集已取消');
  const timing = config.preview ? {} : buildRecordTimingPlan(config);
  const started = await request(bridgeUrl, { action: 'start', options: {
    ...config, ...timing, silenceMs: timing.silenceEndMs || config.silenceMs
  } });
  const sessionId = started.sessionId;
  let finished = false, stopped = false;
  const cancel = () => request(bridgeUrl, { action: 'cancel', sessionId }).catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    onLog?.('response.audio.recording.start', { ...started, recordingMode: 'native_external_device' });
    while (true) {
      if (signal?.aborted) throw new Error('本地采集已取消');
      const status = await request(bridgeUrl, { action: 'status', sessionId }, signal);
      if (status.error) throw new Error(status.error);
      onLog?.('response.audio.level', { rms: status.rms, durationMs: status.durationMs });
      if (status.status === 'completed') break;
      if (!stopped && isPlaybackComplete?.()) {
        stopped = true;
        await request(bridgeUrl, { action: 'stop', sessionId }, signal);
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const result = await request(bridgeUrl, { action: 'result', sessionId }, signal);
    finished = true;
    const bytes = Uint8Array.from(atob(result.audioBase64), char => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const filename = `speaker_${sessionId}.wav`;
    return {
      success: result.success, responseAudioDetected: result.audioDetected,
      responseDetectStartTime: result.startedAt, responseDetectEndTime: result.endedAt,
      responseAudioFile: filename, responseAudioUrl: url, responseAudioBlob: blob,
      responseAudioMimeType: 'audio/wav', responseAudioSize: blob.size,
      responseTtsAudioFile: filename, responseTtsAudioUrl: url, responseTtsAudioBlob: blob,
      responseTtsAudioMimeType: 'audio/wav', responseTtsAudioSize: blob.size,
      responseAudioStartTime: result.startedAt, responseAudioEndTime: result.endedAt,
      responseAudioDuration: result.durationMs, responseAudioSegmentDuration: result.durationMs,
      responseAudioSegmentStartTime: result.startedAt, responseAudioSegmentEndTime: result.endedAt,
      responseAsrStatus: 'unsupported', responseAsrText: '', speechRecognitionSupported: false,
      speakerOutputStatus: result.success ? 'detected' : 'not_detected',
      responseFailStage: result.success ? '' : 'SPEAKER_OUTPUT', responseFailReason: result.message,
      micDeviceId: result.inputDeviceId, inputDeviceLabel: result.inputDeviceLabel,
      localAudioPath: result.localPath, peakRms: result.peakRms, sampleRate: result.sampleRate,
      recorderStarted: true, finishReason: result.finishReason, speakerState: 'FINISHED',
      minProtectMs: timing.minProtectMs, maxRecordMs: timing.maxRecordMs,
      silenceEndMs: timing.silenceEndMs, estimatedTtsDurationMs: timing.estimatedMs,
    };
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!finished) await cancel();
  }
}

export default { listNativeInputs, detectSpeakerResponse };
