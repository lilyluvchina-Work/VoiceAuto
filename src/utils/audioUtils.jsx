/**
 * 音频工具函数 - 统一导出入口
 *
 * 该文件作为 barrel 模块，从各专注模块聚合导出。
 * 新代码建议直接从对应模块导入：
 *   - formatters.js     时间/ID 格式化
 *   - audioHelpers.js   音频文件操作
 *   - fileHelpers.js    文件 I/O、剪贴板
 *   - reportGenerator.js 报告生成
 */

export { formatTime, formatDuration, generateId } from './formatters';
export { getAudioDuration, isValidAudioFile, getFileExtension, getSourceInfo, playAudioItem } from './audioHelpers';
export { readTextFile, parseTestCases, parseTestCasesWithModule, parseTapdTestCases, inferModuleFromCaseText, downloadBlob, copyToClipboard } from './fileHelpers';
export { generateReportText, generateReportJson, generateReportCsv } from './reportGenerator';
