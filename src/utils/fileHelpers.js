/**
 * 文件 I/O 相关工具函数
 */

/**
 * 从文件读取文本内容
 * @param {File} file - 文件对象
 * @returns {Promise<string>} 文件内容
 */
export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

/**
 * 解析文本用例（按行分割）
 * @param {string} text - 文本内容
 * @returns {string[]} 用例数组
 */
export function parseTestCases(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

const MODULE_KEYWORDS = {
  音乐控制: ['音乐', '歌曲', '歌单', '播放', '暂停', '下一首', '上一首', '音量', '专辑', '歌手'],
  家居控制: ['灯', '空调', '窗帘', '电视', '扫地机', '风扇', '加湿器', '卧室', '客厅', '厨房', '家里'],
  导航出行: ['导航', '路线', '到', '出发', '打车', '公交', '地铁', '高铁', '机场', '堵车', '目的地'],
  天气与资讯: ['天气', '温度', '下雨', '新闻', '资讯', '股价', '汇率', '头条', '空气质量', '预报'],
  系统控制: ['闹钟', '提醒', '日程', '电话', '短信', '蓝牙', 'wifi', '重启', '关机', '打开应用', '关闭应用']
};

function normalizeCaseText(line) {
  return line
    .replace(/^[-*\d.、\s]+/, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .trim();
}

function parseModuleLabel(line) {
  const trimmed = line.trim();

  const bracketMatch = trimmed.match(/^\[([^\]]+)\]\s*$/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }

  const headingMatch = trimmed.match(/^(#{1,6}\s*)?([\u4e00-\u9fa5A-Za-z0-9_\- ]{2,20})(模块|用例|测试)?\s*[:：]?\s*$/);
  if (!headingMatch) {
    return null;
  }

  const label = headingMatch[2]?.trim();
  if (!label) {
    return null;
  }

  if (Object.keys(MODULE_KEYWORDS).some((moduleName) => label.includes(moduleName) || moduleName.includes(label))) {
    return Object.keys(MODULE_KEYWORDS).find((moduleName) => label.includes(moduleName) || moduleName.includes(label));
  }

  if (trimmed.includes('模块') || trimmed.startsWith('#')) {
    return label;
  }

  return null;
}

export function inferModuleFromCaseText(text, fallback = '未分类') {
  const line = text.trim();
  if (!line) {
    return fallback;
  }

  for (const [moduleName, keywords] of Object.entries(MODULE_KEYWORDS)) {
    if (keywords.some((kw) => line.includes(kw))) {
      return moduleName;
    }
  }

  return fallback;
}

/**
 * 解析文档并自动识别测试用例所属模块
 * 支持标题分组（如 # 音乐控制）和关键词推断
 * @param {string} text - 文档内容
 * @param {string} fallbackModule - 无法识别时使用的默认模块
 * @returns {{ text: string, module: string }[]}
 */
export function parseTestCasesWithModule(text, fallbackModule = '未分类') {
  const lines = text.split(/\r?\n/);
  const result = [];
  let currentModule = fallbackModule;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }

    const moduleLabel = parseModuleLabel(line);
    if (moduleLabel) {
      currentModule = moduleLabel;
      continue;
    }

    const cleanText = normalizeCaseText(line);
    if (!cleanText) {
      continue;
    }

    const module = inferModuleFromCaseText(cleanText, currentModule || fallbackModule);
    result.push({ text: cleanText, module });
  }

  return result;
}

/**
 * 下载 Blob 为文件
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 复制文本到剪贴板
 * @param {string} text
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
