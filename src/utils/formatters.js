/**
 * 格式化工具函数
 */

/**
 * 格式化时间显示
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串 MM:SS
 */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 格式化时长（毫秒转为 mm:ss）
 * @param {number} ms - 毫秒
 * @returns {string}
 */
export function formatDuration(ms) {
  return formatTime(ms / 1000);
}

/**
 * 生成唯一 ID
 * @returns {string}
 */
export function generateId() {
  return `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
