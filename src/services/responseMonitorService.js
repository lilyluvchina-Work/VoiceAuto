const DEFAULT_OPTIONS = {
  deviceId: '',
  responseWindowMs: 15000,
  silenceMs: 1000,
  minDurationMs: 500,
  noiseThreshold: 0.035,
  language: 'zh-CN'
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

    const id = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(id);
      reject(new Error('响应监测已取消'));
    };

    signal?.addEventListener('abort', abort, { once: true });
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

function getMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4'
  ];

  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
}

function calculateRms(analyser, buffer) {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = (buffer[i] - 128) / 128;
    sum += value * value;
  }
  return Math.sqrt(sum / buffer.length);
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

export async function detectSpeakerResponse(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const {
    signal,
    onLog
  } = config;

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前浏览器不支持麦克风采集');
  }
  if (!window.MediaRecorder) {
    throw new Error('当前浏览器不支持响应音频录制');
  }

  const constraints = {
    audio: config.deviceId
      ? { deviceId: { exact: config.deviceId } }
      : true
  };

  const detectStartTime = now();
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const buffer = new Uint8Array(analyser.fftSize);
  const chunks = [];
  const mimeType = getMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const recognition = startRecognition({
    language: config.language,
    onText: (text) => onLog?.('response.asr.interim', { responseAsrText: text })
  });

  let audioDetected = false;
  let audioStartTime = null;
  let audioEndTime = null;
  let lastVoiceTime = null;
  let peakRms = 0;

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  const cleanup = async () => {
    recognition.stop();
    stream.getTracks().forEach((track) => track.stop());
    source.disconnect();
    await audioContext.close().catch(() => {});
  };

  try {
    onLog?.('response.detect.window.start', {
      responseDetectStartTime: detectStartTime,
      responseWindowMs: config.responseWindowMs,
      silenceMs: config.silenceMs,
      minDurationMs: config.minDurationMs,
      noiseThreshold: config.noiseThreshold,
      speechRecognitionSupported: recognition.supported
    });

    const deadline = detectStartTime + Math.max(1000, Number(config.responseWindowMs) || DEFAULT_OPTIONS.responseWindowMs);
    while (now() < deadline) {
      if (signal?.aborted) throw new Error('响应监测已取消');
      const rms = calculateRms(analyser, buffer);
      peakRms = Math.max(peakRms, rms);

      if (rms >= Number(config.noiseThreshold)) {
        if (!audioDetected) {
          audioDetected = true;
          audioStartTime = now();
          recorder.start(100);
          onLog?.('response.audio.start', {
            responseAudioStartTime: audioStartTime,
            rms,
            peakRms
          });
        }
        lastVoiceTime = now();
      }

      if (audioDetected && lastVoiceTime && now() - lastVoiceTime >= Number(config.silenceMs)) {
        audioEndTime = now();
        break;
      }

      await wait(80, signal);
    }

    const detectEndTime = now();
    if (!audioDetected) {
      return {
        success: false,
        responseDetectStartTime: detectStartTime,
        responseDetectEndTime: detectEndTime,
        responseAudioDetected: false,
        responseAudioFile: '',
        responseAudioUrl: '',
        responseAudioStartTime: null,
        responseAudioEndTime: null,
        responseAudioDuration: 0,
        responseAsrStatus: 'not_started',
        responseAsrText: '',
        speakerOutputStatus: 'not_detected',
        responseFailStage: 'SPEAKER_OUTPUT',
        responseFailReason: '未在响应检测窗口内检测到 Speaker 响应音频',
        peakRms
      };
    }

    if (!audioEndTime) audioEndTime = detectEndTime;
    if (recorder.state === 'recording') {
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
    }

    const duration = Math.max(0, audioEndTime - audioStartTime);
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
    const responseAudioUrl = URL.createObjectURL(blob);
    const responseAsrText = recognition.getText();
    const asrError = recognition.getError();
    const responseAsrStatus = responseAsrText
      ? 'success'
      : (recognition.supported ? (asrError ? 'failed' : 'empty') : 'unsupported');
    let responseFailStage = '';
    let responseFailReason = '';

    if (duration < Number(config.minDurationMs)) {
      responseFailStage = 'SPEAKER_OUTPUT';
      responseFailReason = `检测到响应音频但时长过短：${duration}ms`;
    } else if (responseAsrStatus !== 'success') {
      responseFailStage = responseAsrStatus === 'unsupported' ? 'RESPONSE_AUDIO_ASR' : 'RESPONSE_EMPTY';
      responseFailReason = asrError || '响应音频 ASR 文本为空';
    }

    return {
      success: !responseFailStage,
      responseDetectStartTime: detectStartTime,
      responseDetectEndTime: detectEndTime,
      responseAudioDetected: true,
      responseAudioFile: `response_${detectStartTime}.webm`,
      responseAudioUrl,
      responseAudioBlob: blob,
      responseAudioStartTime: audioStartTime,
      responseAudioEndTime: audioEndTime,
      responseAudioDuration: duration,
      responseAsrStatus,
      responseAsrText,
      speakerOutputStatus: duration >= Number(config.minDurationMs) ? 'detected' : 'too_short',
      responseFailStage,
      responseFailReason,
      peakRms,
      speechRecognitionSupported: recognition.supported
    };
  } finally {
    await cleanup();
  }
}

export default {
  listMicrophones,
  detectSpeakerResponse
};
