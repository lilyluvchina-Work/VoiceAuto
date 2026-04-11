/**
 * 音频文件相关工具函数
 */

const VALID_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'];
const VALID_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];

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
 * @param {string} source - 'tts' | 'file'
 * @returns {object} { icon, label }
 */
export function getSourceInfo(source) {
  if (source === 'tts') {
    return { icon: '🎵', label: 'TTS' };
  }
  return { icon: '📁', label: '文件' };
}

/**
 * 播放音频（支持文件源和 TTS 源）
 * @param {object} audio - 音频对象 { source, audioUrl, text, config }
 * @param {object} ttsService - TTS 服务实例
 * @returns {Promise<void>}
 */
export function playAudioItem(audio, ttsService) {
  if (audio.source === 'file' && audio.audioUrl) {
    return new Promise((resolve, reject) => {
      const audioEl = new Audio(audio.audioUrl);
      audioEl.volume = (audio.config?.volume || 100) / 100;
      audioEl.playbackRate = audio.config?.rate || 1.0;
      audioEl.onended = resolve;
      audioEl.onerror = reject;
      audioEl.play().catch(reject);
    });
  }
  return ttsService.speak(audio.text, {
    voiceName: audio.config?.voiceName,
    lang: audio.config?.lang,
    volume: audio.config?.volume,
    rate: audio.config?.rate
  });
}
