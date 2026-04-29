/**
 * Excel 导出工具
 * 将 Traces 和 Observations 数据导出为 .xlsx 文件
 */

import * as XLSX from 'xlsx';
import { buildSessionRows } from './sessionExtractor';

/**
 * 递归展平嵌套对象，数组序列化为 JSON 字符串
 */
function flattenObject(obj, prefix = '') {
  if (obj === null || typeof obj !== 'object') return { [prefix]: obj };
  if (Array.isArray(obj)) return { [prefix]: JSON.stringify(obj) };

  return Object.entries(obj).reduce((acc, [key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(acc, flattenObject(value, newKey));
    } else if (Array.isArray(value)) {
      acc[newKey] = JSON.stringify(value);
    } else {
      acc[newKey] = value;
    }
    return acc;
  }, {});
}

/**
 * 设置列宽自适应
 */
function autoFitColumns(ws, data) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const colWidths = headers.map((h) => {
    const maxLen = Math.max(
      h.length,
      ...data.map((row) => String(row[h] ?? '').length)
    );
    return { wch: Math.min(maxLen + 2, 60) };
  });
  ws['!cols'] = colWidths;
}

/**
 * 导出 Excel 文件并触发浏览器下载
 * Sheet 顺序：日志提取 → Traces → Observations
 *
 * @param {object[]} traces       - Traces 数据数组
 * @param {object[]} observations - Observations 数据数组
 * @param {string}   filename     - 文件名（含 .xlsx 后缀）
 */
export function exportToExcel(traces, observations, filename) {
  const wb = XLSX.utils.book_new();

  // --- 日志提取 Sheet（首位） ---
  const sessionRows = buildSessionRows(traces, observations);
  if (sessionRows.length > 0) {
    const wsSession = XLSX.utils.json_to_sheet(sessionRows);
    autoFitColumns(wsSession, sessionRows);
    XLSX.utils.book_append_sheet(wb, wsSession, '日志提取');
  }

  // --- Traces Sheet ---
  const flatTraces = traces.map((t) => flattenObject(t));
  const wsTraces = XLSX.utils.json_to_sheet(flatTraces);
  autoFitColumns(wsTraces, flatTraces);
  XLSX.utils.book_append_sheet(wb, wsTraces, 'Traces');

  // --- Observations Sheet ---
  const flatObs = observations.map((o) => flattenObject(o));
  const wsObs = XLSX.utils.json_to_sheet(flatObs);
  autoFitColumns(wsObs, flatObs);
  XLSX.utils.book_append_sheet(wb, wsObs, 'Observations');

  // 触发下载
  XLSX.writeFile(wb, filename);
}

/**
 * 单独导出日志提取 Excel（仅"日志提取"Sheet）
 * @param {object[]} traces       - Traces 数据数组
 * @param {object[]} observations - Observations 数据数组
 * @param {string}   filename     - 文件名（含 .xlsx 后缀）
 */
export function exportSessionExcel(traces, observations, filename) {
  const wb = XLSX.utils.book_new();
  const sessionRows = buildSessionRows(traces, observations);
  const ws = XLSX.utils.json_to_sheet(sessionRows.length ? sessionRows : [{}]);
  autoFitColumns(ws, sessionRows);
  XLSX.utils.book_append_sheet(wb, ws, '日志提取');
  XLSX.writeFile(wb, filename);
}

/**
 * 导出原始 JSON 文件
 * @param {any}    data     - 要序列化的数据
 * @param {string} filename - 文件名（含 .json 后缀）
 */
export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
