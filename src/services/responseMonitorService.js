const DEFAULT_OPTIONS = {
  deviceId: '',
  responseWindowMs: 15000,
  silenceMs: 1200,
  minDurationMs: 500,
  noiseThreshold: 0.02,
  language: 'zh-CN',
  preRollMs: 1500,
  postRollMs: 1000,
  replyStartTimeoutMs: 20000,
  charsPerSecond: 4.2,
  durationBufferRatio: 0.35,
  minProtectRatio: 0.75,
  minProtectMs: 10000,
  maxRecordMs: 120000,
  shortTextSilenceEndMs: 2000,
  longTextSilenceEndMs: 3500,
  veryLongTextSilenceEndMs: 5000,
  afterFinishCooldownMs: 3000
};

function now() {
  return Date.now();
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('响应监测已取消'));
      return;
    }

    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener?.('abort', abort);
    };
    const finalize = (handler) => {
      if (settled) return;
      settled = true;
      clearTimeout(id);
      cleanup();
      handler();
    };

    const id = setTimeout(() => finalize(resolve), ms);
    const abort = () => finalize(() => reject(new Error('响应监测已取消')));
    signal?.addEventListener?.('abort', abort, { once: true });
  });
}

function createSpeechRecognition(language) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = language || 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;
  return recognition;
}

async function getAudioStream(config) {
  const tunedAudioConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 16000,
    ...(config.deviceId ? { deviceId: { exact: config.deviceId } } : {})
  };

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: tunedAudioConstraints });
  } catch (err) {
    if (config.deviceId) {
      return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: config.deviceId } } });
    }
    throw err;
  }
}

function calculateByteRms(analyser, buffer) {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = (buffer[i] - 128) / 128;
    sum += value * value;
  }
  return Math.sqrt(sum / buffer.length);
}

function calculateFloatRms(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

function mergePcmChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk.data, offset);
    offset += chunk.data.length;
  });
  return merged;
}

function slicePcmChunks(chunks, startMs, endMs) {
  return chunks.filter((chunk) => chunk.endTime >= startMs && chunk.startTime <= endMs);
}

function encodeWav(floatSamples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + floatSamples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + floatSamples.length * bytesPerSample, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, floatSamples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < floatSamples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, floatSamples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([view], { type: 'audio/wav' });
}

function getTextLengthForEstimate(text) {
  const value = String(text || '').trim();
  const explicitLength = value.match(/(\d{2,4})\s*(?:字|个字|字符|words?)/i);
  if (explicitLength) {
    return Math.max(0, Number(explicitLength[1]) || 0);
  }
  return value.replace(/\s+/g, '').length;
}

function estimateTtsDurationMs(text, config) {
  const textLength = getTextLengthForEstimate(text);
  if (!textLength) {
    return 0;
  }

  const charsPerSecond = Math.max(1, Number(config.charsPerSecond) || DEFAULT_OPTIONS.charsPerSecond);
  const estimatedSeconds = textLength / charsPerSecond;
  const bufferRatio = Math.max(0, Number(config.durationBufferRatio) || DEFAULT_OPTIONS.durationBufferRatio);
  const bufferSeconds = Math.max(5, estimatedSeconds * bufferRatio);
  return Math.ceil((estimatedSeconds + bufferSeconds) * 1000);
}

function buildRecordTimingPlan(config) {
  const referenceText = config.expectedTtsText || config.ttsText || config.promptText || config.targetText || '';
  const textLength = getTextLengthForEstimate(referenceText);
  const estimatedMs = estimateTtsDurationMs(referenceText, config);
  // Long replies must not be cut by a short silence gap; derive protection windows from the requested text.
  const minProtectBase = estimatedMs
    ? estimatedMs * (Number(config.minProtectRatio) || DEFAULT_OPTIONS.minProtectRatio)
    : 0;
  const shortReplyProtectMs = textLength > 0 && textLength <= 30 ? 3000 : 0;
  const minProtectMs = Math.max(
    shortReplyProtectMs,
    Number(config.minProtectMs) || DEFAULT_OPTIONS.minProtectMs,
    minProtectBase
  );
  const maxRecordMs = Math.max(
    minProtectMs + 3000,
    Math.min(
      Number(config.maxRecordMs) || DEFAULT_OPTIONS.maxRecordMs,
      estimatedMs ? estimatedMs * 1.8 : Number(config.maxRecordMs) || DEFAULT_OPTIONS.maxRecordMs
    )
  );
  const silenceEndMs = textLength > 300
    ? Number(config.veryLongTextSilenceEndMs) || DEFAULT_OPTIONS.veryLongTextSilenceEndMs
    : textLength > 100
      ? Number(config.longTextSilenceEndMs) || DEFAULT_OPTIONS.longTextSilenceEndMs
      : textLength > 30
        ? 2500
        : Number(config.shortTextSilenceEndMs) || DEFAULT_OPTIONS.shortTextSilenceEndMs;

  return {
    referenceText,
    textLength,
    estimatedMs,
    minProtectMs: Math.round(minProtectMs),
    maxRecordMs: Math.round(maxRecordMs),
    silenceEndMs: Math.round(silenceEndMs),
    replyStartTimeoutMs: Number(config.replyStartTimeoutMs) || DEFAULT_OPTIONS.replyStartTimeoutMs
  };
}

function startRecognition({ language, onText }) {
  const recognition = createSpeechRecognition(language);
  if (!recognition) {
    return {
      supported: false,
      stop: () => {},
      getText: () => '',
      getStatus: () => 'unsupported',
      getError: () => '当前浏览器不支持 Web Speech Recognition'
    };
  }

  let finalText = '';
  let interimText = '';
  let status = 'listening';
  let error = '';

  recognition.onresult = (event) => {
    interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const text = event.results[i]?.[0]?.transcript || '';
      if (event.results[i].isFinal) {
        finalText += text;
      } else {
        interimText += text;
      }
    }
    onText?.((finalText || interimText).trim());
  };

  recognition.onerror = (event) => {
    status = 'error';
    error = event?.error || '响应 ASR 识别失败';
  };

  recognition.onend = () => {
    if (status === 'listening') status = 'stopped';
  };

  try {
    recognition.start();
  } catch (err) {
    status = 'error';
    error = err?.message || '响应 ASR 启动失败';
  }

  return {
    supported: true,
    stop: () => {
      try {
        recognition.stop();
      } catch (err) {
        // Recognition may already be stopped.
      }
    },
    getText: () => (finalText || interimText).trim(),
    getStatus: () => status,
    getError: () => error
  };
}

export async function listMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `麦克风 ${index + 1}`
    }));
}

export async function listSpeakers() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Speaker 输出设备 ${index + 1}`
    }));
}

export async function detectSpeakerResponse(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const { signal, onLog } = config;
  const timingPlan = buildRecordTimingPlan(config);
  const preRollMs = Math.max(0, Number(config.preRollMs) || DEFAULT_OPTIONS.preRollMs);
  const postRollMs = Math.max(0, Number(config.postRollMs) || DEFAULT_OPTIONS.postRollMs);
  const baseThreshold = Math.max(0.001, Number(config.noiseThreshold) || DEFAULT_OPTIONS.noiseThreshold);
  const responseWindowMs = Math.max(
    Number(config.responseWindowMs) || DEFAULT_OPTIONS.responseWindowMs,
    timingPlan.maxRecordMs,
    timingPlan.replyStartTimeoutMs
  );
  const maxBufferMs = responseWindowMs + preRollMs + postRollMs + 3000;

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前浏览器不支持麦克风采集');
  }
  if (!window.AudioContext && !window.webkitAudioContext) {
    throw new Error('当前浏览器不支持响应音频采样');
  }

  const detectStartTime = now();
  const stream = await getAudioStream(config);
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextCtor();
  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => {});
  }

  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const processor = audioContext.createScriptProcessor(2048, 1, 1);
  const mutedOutput = audioContext.createGain();
  mutedOutput.gain.value = 0;
  source.connect(processor);
  processor.connect(mutedOutput);
  mutedOutput.connect(audioContext.destination);

  const sampleRate = audioContext.sampleRate || 48000;
  const analyserBuffer = new Uint8Array(analyser.fftSize);
  const pcmChunks = [];
  const recognition = startRecognition({
    language: config.language,
    onText: (text) => onLog?.('response.asr.interim', { responseAsrText: text })
  });

  let audioDetected = false;
  let audioStartTime = null;
  let audioEndTime = null;
  let lastVoiceTime = null;
  let peakRms = 0;
  let noiseFloor = 0;
  let noiseSampleCount = 0;
  let latestDynamicThreshold = Number(config.noiseThreshold) || DEFAULT_OPTIONS.noiseThreshold;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const data = new Float32Array(input);
    const durationMs = (data.length / sampleRate) * 1000;
    const endTime = now();
    const startTime = endTime - durationMs;
    const rms = calculateFloatRms(data);
    pcmChunks.push({ startTime, endTime, data, rms });

    // Keep enough PCM history for long TTS replies while still bounding memory usage.
    while (pcmChunks.length && endTime - pcmChunks[0].endTime > maxBufferMs) {
      pcmChunks.shift();
    }

    if (!audioDetected && endTime - detectStartTime <= 800) {
      noiseFloor = ((noiseFloor * noiseSampleCount) + rms) / (noiseSampleCount + 1);
      noiseSampleCount += 1;
    }
  };

  const cleanup = async () => {
    recognition.stop();
    processor.onaudioprocess = null;
    processor.disconnect();
    mutedOutput.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => {});
  };

  try {
    let minProtectReachedLogged = false;
    let finishReason = '';
    let speakerState = 'WAITING_REPLY';
    let finalSilenceMs = 0;

    onLog?.('response.detect.window.start', {
      responseDetectStartTime: detectStartTime,
      responseWindowMs,
      silenceMs: timingPlan.silenceEndMs,
      minDurationMs: config.minDurationMs,
      noiseThreshold: baseThreshold,
      preRollMs,
      postRollMs,
      speakerState,
      ttsTextLength: timingPlan.textLength,
      estimatedTtsDurationMs: timingPlan.estimatedMs,
      minProtectMs: timingPlan.minProtectMs,
      maxRecordMs: timingPlan.maxRecordMs,
      replyStartTimeoutMs: timingPlan.replyStartTimeoutMs,
      speechRecognitionSupported: recognition.supported,
      recordingMode: 'continuous_pcm_vad_slice',
      audioConstraints: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        requestedSampleRate: 16000,
        actualSampleRate: sampleRate
      }
    });

    onLog?.('response.audio.recording.start', {
      responseAudioRecordingStartTime: detectStartTime,
      recordingMode: 'continuous_pcm_vad_slice',
      sampleRate,
      preRollMs,
      postRollMs
    });

    const deadline = detectStartTime + responseWindowMs;
    while (now() < deadline) {
      if (signal?.aborted) throw new Error('响应监测已取消');
      const currentTime = now();
      if (config.isPlaybackComplete?.() === true) {
        audioEndTime = currentTime;
        finishReason = '设备已确认播报结束，立即释放连续收音窗口';
        speakerState = 'FINISHED';
        break;
      }
      const rms = calculateByteRms(analyser, analyserBuffer);
      peakRms = Math.max(peakRms, rms);
      latestDynamicThreshold = Math.max(baseThreshold, noiseFloor > 0 ? noiseFloor * 3 : 0);

      if (rms >= latestDynamicThreshold) {
        if (!audioDetected) {
          audioDetected = true;
          audioStartTime = currentTime;
          speakerState = 'SPEAKING';
          onLog?.('response.audio.start', {
            responseAudioStartTime: audioStartTime,
            rms,
            peakRms,
            noiseFloor,
            dynamicThreshold: latestDynamicThreshold,
            speakerState
          });
        }
        lastVoiceTime = currentTime;
      }

      if (!audioDetected && currentTime - detectStartTime >= timingPlan.replyStartTimeoutMs) {
        finishReason = `等待 Speaker 开始回复超时：${timingPlan.replyStartTimeoutMs}ms`;
        speakerState = 'TIMEOUT';
        break;
      }

      if (audioDetected) {
        const recordedMs = currentTime - audioStartTime;
        finalSilenceMs = lastVoiceTime ? currentTime - lastVoiceTime : 0;

        // Only allow silence to end recording after the protected duration has elapsed.
        if (!minProtectReachedLogged && recordedMs >= timingPlan.minProtectMs) {
          minProtectReachedLogged = true;
          speakerState = 'WAITING_SILENCE';
          onLog?.('response.audio.min_protect.reached', {
            responseAudioStartTime: audioStartTime,
            recordedMs,
            minProtectMs: timingPlan.minProtectMs,
            silenceEndMs: timingPlan.silenceEndMs,
            speakerState
          });
        }

        if (recordedMs >= timingPlan.minProtectMs && finalSilenceMs >= timingPlan.silenceEndMs) {
          audioEndTime = currentTime;
          finishReason = `达到保护时长后检测到连续静音 ${finalSilenceMs}ms`;
          speakerState = 'FINISHED';
          await wait(postRollMs, signal).catch(() => {});
          break;
        }

        if (recordedMs >= timingPlan.maxRecordMs) {
          audioEndTime = currentTime;
          finishReason = `达到最大录制时长 ${timingPlan.maxRecordMs}ms，强制结束`;
          speakerState = 'TIMEOUT';
          await wait(postRollMs, signal).catch(() => {});
          break;
        }
      }

      if (!audioDetected && currentTime >= deadline) {
        finishReason = '响应检测窗口结束，未检测到 Speaker 回复';
        speakerState = 'TIMEOUT';
        break;
      }

      if (audioDetected && currentTime >= deadline) {
        audioEndTime = currentTime;
        finishReason = '达到响应检测窗口最大时间，强制结束';
        speakerState = 'TIMEOUT';
        await wait(postRollMs, signal).catch(() => {});
        break;
      }

      await wait(80, signal);
    }

    const detectEndTime = now();
    if (!audioEndTime) audioEndTime = audioDetected ? detectEndTime : null;
    if (!finishReason) {
      finishReason = audioDetected ? '响应检测窗口结束' : '未检测到 Speaker 回复';
    }

    const segmentStartTime = audioDetected
      ? Math.max(detectStartTime, audioStartTime - preRollMs)
      : detectStartTime;
    const segmentEndTime = audioDetected
      ? Math.min(now(), audioEndTime + postRollMs)
      : detectEndTime;
    const segmentChunks = slicePcmChunks(pcmChunks, segmentStartTime, segmentEndTime);
    const samples = mergePcmChunks(segmentChunks);
    const blob = samples.length ? encodeWav(samples, sampleRate) : new Blob([], { type: 'audio/wav' });
    const responseAudioUrl = blob.size ? URL.createObjectURL(blob) : '';
    const responseAudioFile = `speaker_tts_${detectStartTime}.wav`;
    const segmentDuration = Math.max(0, segmentEndTime - segmentStartTime);

    if (!audioDetected) {
      return {
        success: false,
        responseDetectStartTime: detectStartTime,
        responseDetectEndTime: detectEndTime,
        responseAudioDetected: false,
        responseAudioFile: blob.size ? responseAudioFile : '',
        responseAudioUrl,
        responseAudioBlob: blob,
        responseAudioMimeType: 'audio/wav',
        responseAudioSize: blob.size,
        responseTtsAudioFile: blob.size ? responseAudioFile : '',
        responseTtsAudioUrl: responseAudioUrl,
        responseTtsAudioBlob: blob,
        responseTtsAudioMimeType: 'audio/wav',
        responseTtsAudioSize: blob.size,
        responseAudioStartTime: null,
        responseAudioEndTime: detectEndTime,
        responseAudioDuration: 0,
        responseAudioSegmentStartTime: segmentStartTime,
        responseAudioSegmentEndTime: segmentEndTime,
        responseAudioSegmentDuration: segmentDuration,
        responseAsrStatus: 'not_started',
        responseAsrText: '',
        speakerOutputStatus: 'not_detected',
        responseFailStage: 'SPEAKER_OUTPUT',
        responseFailReason: blob.size
          ? '已录制响应窗口音频，但未达到 Speaker 响应音量阈值，请检查麦克风输入源、Speaker 音量或降低噪声阈值'
          : '未在响应检测窗口内检测到 Speaker 响应音频，且录音数据为空',
        peakRms,
        noiseFloor,
        dynamicThreshold: latestDynamicThreshold,
        recorderStarted: true,
        sampleRate,
        micDeviceId: config.deviceId || '',
        speakerState,
        finishReason,
        ttsTextLength: timingPlan.textLength,
        estimatedTtsDurationMs: timingPlan.estimatedMs,
        minProtectMs: timingPlan.minProtectMs,
        maxRecordMs: timingPlan.maxRecordMs,
        silenceEndMs: timingPlan.silenceEndMs,
        finalSilenceMs
      };
    }

    const duration = Math.max(0, audioEndTime - audioStartTime);
    const responseAsrText = recognition.getText();
    const asrError = recognition.getError();
    const responseAsrStatus = responseAsrText
      ? 'success'
      : (recognition.supported ? (asrError ? 'failed' : 'empty') : 'unsupported');
    let responseFailStage = '';
    let responseFailReason = '';

    if (!blob.size) {
      responseFailStage = 'SPEAKER_OUTPUT';
      responseFailReason = '检测到 Speaker 响应音量，但截取后的录音数据为空';
    } else if (duration < Number(config.minDurationMs)) {
      responseFailStage = 'SPEAKER_OUTPUT';
      responseFailReason = `检测到响应音频但时长过短：${duration}ms`;
    }
    const suspectedTruncated = Boolean(
      timingPlan.estimatedMs
      && duration < timingPlan.estimatedMs * 0.65
      && speakerState !== 'FINISHED'
    );
    if (suspectedTruncated && !responseFailReason) {
      responseFailStage = 'SPEAKER_OUTPUT';
      responseFailReason = '实际录制时长明显小于预计播报时长，疑似播报被截断';
    }

    return {
      success: !responseFailStage,
      responseDetectStartTime: detectStartTime,
      responseDetectEndTime: detectEndTime,
      responseAudioDetected: true,
      responseAudioFile,
      responseAudioUrl,
      responseAudioBlob: blob,
      responseAudioMimeType: 'audio/wav',
      responseAudioSize: blob.size,
      responseTtsAudioFile: responseAudioFile,
      responseTtsAudioUrl: responseAudioUrl,
      responseTtsAudioBlob: blob,
      responseTtsAudioMimeType: 'audio/wav',
      responseTtsAudioSize: blob.size,
      responseAudioStartTime: audioStartTime,
      responseAudioEndTime: audioEndTime,
      responseAudioDuration: duration,
      responseAudioSegmentStartTime: segmentStartTime,
      responseAudioSegmentEndTime: segmentEndTime,
      responseAudioSegmentDuration: segmentDuration,
      responseAsrStatus,
      responseAsrText,
      speakerOutputStatus: duration >= Number(config.minDurationMs) ? 'detected' : 'too_short',
      responseFailStage,
      responseFailReason,
      peakRms,
      noiseFloor,
      dynamicThreshold: latestDynamicThreshold,
      speechRecognitionSupported: recognition.supported,
      recorderStarted: true,
      sampleRate,
      micDeviceId: config.deviceId || '',
      speakerState,
      finishReason,
      ttsTextLength: timingPlan.textLength,
      estimatedTtsDurationMs: timingPlan.estimatedMs,
      minProtectMs: timingPlan.minProtectMs,
      maxRecordMs: timingPlan.maxRecordMs,
      silenceEndMs: timingPlan.silenceEndMs,
      finalSilenceMs,
      suspectedTruncated
    };
  } finally {
    await cleanup();
  }
}

export default {
  listMicrophones,
  listSpeakers,
  detectSpeakerResponse
};
