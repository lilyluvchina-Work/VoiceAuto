/**
 * 音频文件相关工具函数
 */
import { normalizeVoiceConfigByLang } from '../constants/index.js';

const VALID_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'];
const VALID_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];
const VOICE_CONFIG_FIELDS = ['voice', 'voiceType', 'voiceName', 'provider'];

/**
 * 获取音频时长
 * @param {string} src - 音频源 URL 或 Blob URL
 * @returns {Promise<number>} 时长（毫秒）
 */
export function getAudioDuration(src) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';

    audio.onloadedmetadata = () => {
      resolve(audio.duration * 1000);
    };

    audio.onerror = () => {
      reject(new Error('Failed to load audio'));
    };

    audio.src = src;
  });
}

/**
 * 验证音频文件格式
 * @param {File} file - 文件对象
 * @returns {boolean}
 */
export function isValidAudioFile(file) {
  const hasValidType = VALID_AUDIO_TYPES.includes(file.type);
  const hasValidExt = VALID_AUDIO_EXTENSIONS.some(ext =>
    file.name.toLowerCase().endsWith(ext)
  );
  return hasValidType || hasValidExt;
}

/**
 * 获取文件扩展名
 * @param {string} filename
 * @returns {string}
 */
export function getFileExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

/**
 * 获取音频来源类型标识
 * @param {string} source - 'text' | 'tts' | 'tapd' | 'file'
 * @returns {object} { icon, label }
 */
export function getSourceInfo(source) {
  if (source === 'text') {
    return { icon: '📄', label: '文本导入' };
  }
  if (source === 'tts') {
    return { icon: '🎵', label: 'TTS' };
  }
  if (source === 'tapd') {
    return { icon: '🧩', label: 'TAPD' };
  }
  return { icon: '📁', label: '文件' };
}

/**
 * 播放音频（支持文件源和 TTS 源）
 * @param {object} audio - 音频对象 { source, audioUrl, text, config }
 * @param {object} ttsService - TTS 服务实例
 * @param {object} fallbackConfig - 默认 TTS 配置
 * @param {object} options - 播放过程回调
 * @returns {Promise<void>}
 */
export function playAudioItem(audio, ttsService, fallbackConfig = {}, options = {}) {
  const audioConfig = audio.config || {};
  const hasModernAudioVoice = Boolean(
    audioConfig.voiceType
    || audioConfig.provider === 'doubao-v3'
    || (audioConfig.voice && String(audioConfig.voice).includes('_'))
  );
  const normalizedAudioConfig = hasModernAudioVoice
    ? audioConfig
    : Object.fromEntries(
        Object.entries(audioConfig).filter(([key]) => !VOICE_CONFIG_FIELDS.includes(key))
      );
  const config = {
    ...fallbackConfig,
    ...normalizedAudioConfig
  };
  const resolvedConfig = normalizeVoiceConfigByLang(config);

  if (audio.source === 'file' && audio.audioUrl) {
    return new Promise((resolve, reject) => {
      const audioEl = new Audio(audio.audioUrl);
      audioEl.volume = (resolvedConfig.volume || 100) / 100;
      audioEl.playbackRate = resolvedConfig.rate || 1.0;
      audioEl.onplaying = () => options.onStart?.();
      audioEl.onended = resolve;
      audioEl.onerror = reject;
      audioEl.play().catch(reject);
    });
  }

  if (!String(audio.text || '').trim()) {
    return Promise.reject(new Error('测试音频文本为空，无法播报'));
  }

  return ttsService.speak(audio.text, {
    voice: resolvedConfig.voice,
    voiceType: resolvedConfig.voiceType,
    voiceName: resolvedConfig.voiceName,
    provider: resolvedConfig.provider,
    lang: resolvedConfig.lang,
    volume: resolvedConfig.volume,
    rate: resolvedConfig.rate,
    onStart: options.onStart
  });
}
