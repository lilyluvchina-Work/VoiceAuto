export const DEVICE_TYPES = {
  SPEAKER: 'speaker',
  AI_TOY: 'ai_toy',
};

export const LOG_SOURCES = {
  ADB: 'adb',
  SERIAL: 'serial',
};

const SPEAKER_ASR_TEXT_PATTERN = String.raw`/message=Message\(content=([\s\S]*?),\s*messageType=(?:asr_status|input_text)\)/i`;
const SPEAKER_ASR_FALLBACK_PATTERN = String.raw`/(?:ASR result|asrText|recognizedText|finalResult)\s*[:=]\s*["']?([^"',，。；;\]\}]+)/i`;

export const DEVICE_PROFILES = {
  [DEVICE_TYPES.SPEAKER]: {
    type: DEVICE_TYPES.SPEAKER,
    label: 'Speaker',
    wake: {
      keywords: [
        'WakeupSuccess',
        'WAKEUP_SUCCESS',
        'wakeup success',
        'onCedarWakeup',
        'GlobalControl: onCedarWakeup',
      ],
      listeningKeywords: [],
    },
    input: {
      startKeywords: [
        '/ASR_STATUS.*PARTIAL/i',
        '/asr_status[^\\n]*(partial)/i',
        '/"asr_status"\\s*:\\s*"partial"/i',
        '/onHandlerCloudMsg==>GoogleLiveResponseBean.*messageType=asr_status/i',
      ],
      endKeywords: [
        '/ASR_STATUS.*FINAL/i',
        '/asr_status[^\\n]*(final)/i',
        '/"asr_status"\\s*:\\s*"final"/i',
        '/onHandlerCloudMsg==>GoogleLiveResponseBean.*messageType=input_text/i',
        'ASR result',
        'asrText',
        'recognizedText',
        'finalResult',
      ],
      failureKeywords: [
        '/ASR_STATUS.*UNIDENTIFIED/i',
        '/asr_status[^\\n]*(unidentified)/i',
        '/"asr_status"\\s*:\\s*"unidentified"/i',
      ],
      extractPatterns: [
        SPEAKER_ASR_TEXT_PATTERN,
        SPEAKER_ASR_FALLBACK_PATTERN,
      ],
    },
    response: {
      vadStartKeywords: [
        '/VAD_STATUS.*START/i',
        '/vad_status[^\\n]*(start)/i',
        '/"vad_status"\\s*:\\s*"start"/i',
      ],
      vadEndKeywords: [
        '/VAD_STATUS.*STOP/i',
        '/vad_status[^\\n]*(stop)/i',
        '/"vad_status"\\s*:\\s*"stop"/i',
      ],
      ttsKeywords: ['TTS_STATUS', 'tts_status'],
      firstAudioKeywords: [],
      playbackDoneKeywords: ['/SpeechService.*onLiveTtsEnd==>(?:false\\b|\\$stopRecord)/i'],
      listeningKeywords: [],
    },
    failure: {
      keywords: [
        '/reboot/i',
        '/boot_completed/i',
        '/device offline/i',
        '/device not found/i',
      ],
    },
    defaults: {
      wakeDetectionTimeoutMs: 5000,
      asrDetectionTimeoutMs: 8000,
      responseWindowMs: 15000,
      responseMaxWaitMs: 120000,
      baudrate: 115200,
    },
  },
  [DEVICE_TYPES.AI_TOY]: {
    type: DEVICE_TYPES.AI_TOY,
    label: 'AI玩具',
    wake: {
      keywords: ['VOICE WAKE WORD HIT ACCEPTED'],
      listeningKeywords: ['Cedar: Start listening'],
    },
    input: {
      startKeywords: ['Cedar: Input Text'],
      endKeywords: ['Cedar: Input Text'],
      failureKeywords: [
        'Application: ║ New State: idle',
        'Application: New State: idle',
        'WS response timeout (no_tts_start)',
        'Rebooting.',
        'Guru Meditation',
        'task_wdt',
        'I2C transaction timeout',
      ],
      extractPatterns: ['/Cedar: Input Text:\\s*(.*)$/i'],
    },
    response: {
      vadStartKeywords: [],
      vadEndKeywords: [],
      ttsKeywords: [],
      firstAudioKeywords: ['Audio latency first_downlink_audio'],
      playbackDoneKeywords: ['TTS playback done'],
      listeningKeywords: ['Cedar: Start listening'],
    },
    failure: {
      keywords: [
        'Application: ║ New State: idle',
        'Application: New State: idle',
        'WS response timeout (no_tts_start)',
        'Rebooting.',
        'Guru Meditation',
        'task_wdt',
        'I2C transaction timeout',
      ],
    },
    defaults: {
      wakeDetectionTimeoutMs: 10000,
      asrDetectionTimeoutMs: 14000,
      responseWindowMs: 18000,
      responseMaxWaitMs: 35000,
      baudrate: 115200,
    },
  },
};

export function getDeviceProfile(deviceType = DEVICE_TYPES.SPEAKER) {
  return DEVICE_PROFILES[deviceType] || DEVICE_PROFILES[DEVICE_TYPES.SPEAKER];
}

export function getDefaultDeviceOptions() {
  return {
    type: DEVICE_TYPES.SPEAKER,
    logSource: LOG_SOURCES.ADB,
    serialPort: '',
    baudrate: 115200,
    speakerContinuousDialogue: false,
  };
}

export function resolveDeviceRuntimeOptions(testOptions = {}) {
  const device = {
    ...getDefaultDeviceOptions(),
    ...(testOptions.device || {}),
  };
  const profile = getDeviceProfile(device.type);

  return {
    deviceType: profile.type,
    profile,
    logSource: profile.type === DEVICE_TYPES.AI_TOY ? LOG_SOURCES.SERIAL : LOG_SOURCES.ADB,
    serialPort: String(device.serialPort || '').trim(),
    baudrate: Number(device.baudrate) || profile.defaults.baudrate || 115200,
    speakerContinuousDialogue: profile.type === DEVICE_TYPES.SPEAKER && Boolean(device.speakerContinuousDialogue),
  };
}
