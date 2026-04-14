import React, { useEffect, useMemo, useState } from 'react';
import {
  analyzeLogEntries,
  formatBytes,
  formatDateTime,
  parseLogContent
} from '../utils/logAnalysis';

const LOG_RECORD_STORAGE_KEY = 'voiceauto_log_records_v1';
const MAX_RECORDS = 30;
const MAX_PERSIST_RECORDS = 10;
const MAX_PERSIST_ENTRIES_PER_RECORD = 300;

function compactEntry(entry) {
  return {
    id: entry.id,
    lineNo: entry.lineNo,
    raw: entry.raw,
    timestamp: entry.timestamp,
    ts: entry.ts,
    secondTs: entry.secondTs,
    level: entry.level,
    module: entry.module,
    message: String(entry.message || '').slice(0, 300),
    original: String(entry.original || '').slice(0, 500)
  };
}

function compactRecordForStorage(record) {
  const entries = Array.isArray(record.entries)
    ? record.entries.slice(-MAX_PERSIST_ENTRIES_PER_RECORD).map(compactEntry)
    : [];

  return {
    id: record.id,
    name: record.name,
    importedAt: record.importedAt,
    size: record.size,
    lineCount: record.lineCount,
    firstTs: record.firstTs,
    lastTs: record.lastTs,
    entries
  };
}

function persistRecords(records) {
  const compact = records.slice(0, MAX_PERSIST_RECORDS).map(compactRecordForStorage);

  try {
    localStorage.setItem(LOG_RECORD_STORAGE_KEY, JSON.stringify(compact));
    return { ok: true, downgraded: false };
  } catch {
    // 配额不足时降级只存元数据，避免组件崩溃
    const metadataOnly = compact.map(({ entries, ...rest }) => ({ ...rest, entries: [] }));
    try {
      localStorage.setItem(LOG_RECORD_STORAGE_KEY, JSON.stringify(metadataOnly));
      return { ok: true, downgraded: true };
    } catch {
      return { ok: false, downgraded: true };
    }
  }
}

function readAnyFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target?.result || ''));
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

function toDatetimeLocalValue(ts) {
  if (!Number.isFinite(ts)) {
    return '';
  }
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  const second = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export default function LogAnalyzer() {
  const [records, setRecords] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [storageNotice, setStorageNotice] = useState('');

  const [recordQuery, setRecordQuery] = useState('');
  const [recordDate, setRecordDate] = useState('');

  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [keyword, setKeyword] = useState('');
  const [levelFilter, setLevelFilter] = useState('ALL');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOG_RECORD_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      setRecords(parsed);
      if (parsed.length > 0) {
        setActiveId(parsed[0].id);
      }
    } catch {
      // 忽略损坏缓存
    }
  }, []);

  useEffect(() => {
    const result = persistRecords(records);
    if (!result.ok) {
      setStorageNotice('本地存储空间不足，日志记录未能持久化。刷新页面后需重新导入。');
      return;
    }
    if (result.downgraded) {
      setStorageNotice('本地存储空间不足，已自动压缩保存历史记录。');
      return;
    }
    if (storageNotice) {
      setStorageNotice('');
    }
  }, [records, storageNotice]);

  const activeRecord = useMemo(
    () => records.find((item) => item.id === activeId) || null,
    [records, activeId]
  );

  useEffect(() => {
    if (!activeRecord) {
      return;
    }
    setStartTime(activeRecord.firstTs ? toDatetimeLocalValue(activeRecord.firstTs) : '');
    setEndTime(activeRecord.lastTs ? toDatetimeLocalValue(activeRecord.lastTs) : '');
    setKeyword('');
    setLevelFilter('ALL');
  }, [activeRecord?.id]);

  const searchableRecords = useMemo(() => {
    const query = recordQuery.trim().toLowerCase();
    return records.filter((item) => {
      const byName = !query || item.name.toLowerCase().includes(query);
      const byDate = !recordDate || formatDateTime(item.importedAt).startsWith(recordDate);
      return byName && byDate;
    });
  }, [records, recordQuery, recordDate]);

  const filteredEntries = useMemo(() => {
    const list = activeRecord?.entries || [];

    const startTs = startTime ? new Date(startTime).getTime() : null;
    const endTs = endTime ? new Date(endTime).getTime() : null;
    const q = keyword.trim().toLowerCase();

    return list.filter((item) => {
      if (levelFilter !== 'ALL' && item.level !== levelFilter) {
        return false;
      }

      if (Number.isFinite(startTs) && Number.isFinite(item.ts) && item.ts < startTs) {
        return false;
      }

      if (Number.isFinite(endTs) && Number.isFinite(item.ts) && item.ts > endTs) {
        return false;
      }

      if (q && !`${item.message} ${item.original} ${item.module}`.toLowerCase().includes(q)) {
        return false;
      }

      return true;
    });
  }, [activeRecord, startTime, endTime, keyword, levelFilter]);

  const analysis = useMemo(() => analyzeLogEntries(filteredEntries), [filteredEntries]);

  const importLogText = (name, text, size) => {
    const entries = parseLogContent(text);
    const summary = analyzeLogEntries(entries);

    const record = {
      id: `record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      importedAt: Date.now(),
      size,
      lineCount: entries.length,
      firstTs: summary.firstTs,
      lastTs: summary.lastTs,
      entries
    };

    setRecords((prev) => {
      const merged = [record, ...prev].slice(0, MAX_RECORDS);
      return merged;
    });
    setActiveId(record.id);
  };

  const handleFileImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const content = await readAnyFile(file);
      importLogText(file.name, content, file.size);
      alert('日志导入成功');
    } catch (err) {
      alert(`日志导入失败: ${err.message}`);
    } finally {
      event.target.value = '';
    }
  };

  const removeRecord = (id) => {
    const next = records.filter((item) => item.id !== id);
    setRecords(next);
    if (activeId === id) {
      setActiveId(next[0]?.id || null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-dark rounded-xl p-6 border border-gray-700">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <span className="text-2xl">🧾</span>
          日志分析
        </h2>
        <p className="text-sm text-gray-400 mb-6">
          支持任意格式日志文件导入，自动提取时间、级别、模块与关键信息，并提供多维度分析结论。
        </p>

        <div className="p-4 rounded-lg bg-gray-800/40 border border-gray-700 space-y-3">
          <h3 className="text-sm font-medium text-gray-300">文件导入</h3>
          <input
            type="file"
            onChange={handleFileImport}
            className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4
                       file:rounded file:border-0 file:text-sm file:font-semibold
                       file:bg-primary file:text-white hover:file:bg-blue-600"
          />
          <p className="text-xs text-gray-500">不限制文件后缀，按文本方式解析。</p>
        </div>

        {storageNotice && (
          <div className="mt-4 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">
            {storageNotice}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-4 bg-dark rounded-xl p-5 border border-gray-700">
          <h3 className="font-medium mb-4">导入记录</h3>

          <div className="space-y-3 mb-4">
            <input
              value={recordQuery}
              onChange={(e) => setRecordQuery(e.target.value)}
              placeholder="按文件名搜索"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm"
            />
            <input
              type="date"
              value={recordDate}
              onChange={(e) => setRecordDate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm"
            />
          </div>

          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {searchableRecords.length === 0 && (
              <div className="text-sm text-gray-500 py-8 text-center">暂无匹配记录</div>
            )}

            {searchableRecords.map((item) => (
              <div
                key={item.id}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  activeId === item.id
                    ? 'border-primary bg-primary/10'
                    : 'border-gray-700 bg-gray-800/40 hover:border-gray-500'
                }`}
                onClick={() => setActiveId(item.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{item.name}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatDateTime(item.importedAt)} | {formatBytes(item.size)}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">{item.lineCount} 条日志</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecord(item.id);
                    }}
                    className="text-xs text-red-300 hover:text-red-200"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="xl:col-span-8 bg-dark rounded-xl p-5 border border-gray-700">
          {!activeRecord && (
            <div className="py-12 px-4 text-center text-gray-400">
              <p className="text-4xl mb-3">📂</p>
              <p className="text-base text-gray-300">请先从上方选择日志文件导入</p>
              <p className="text-sm text-gray-500 mt-2">导入完成后，这里将展示日志统计、分布分析与结论。</p>
            </div>
          )}

          {activeRecord && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-white">{activeRecord.name}</h3>
                <p className="text-xs text-gray-400 mt-1">
                  导入时间 {formatDateTime(activeRecord.importedAt)}
                  {activeRecord.firstTs && activeRecord.lastTs && (
                    <>
                      {' '}
                      | 日志范围 {formatDateTime(activeRecord.firstTs)} ~ {formatDateTime(activeRecord.lastTs)}
                    </>
                  )}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className="p-3 bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-400">总日志</p>
                  <p className="text-2xl font-semibold">{analysis.totals.count}</p>
                </div>
                <div className="p-3 bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-400">错误数</p>
                  <p className="text-2xl font-semibold text-red-400">{analysis.totals.errorCount}</p>
                </div>
                <div className="p-3 bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-400">警告数</p>
                  <p className="text-2xl font-semibold text-amber-400">{analysis.totals.warnCount}</p>
                </div>
                <div className="p-3 bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-400">可解析时间戳</p>
                  <p className="text-2xl font-semibold text-primary">{analysis.totals.withTimestamp}</p>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-gray-800/40 border border-gray-700 space-y-3">
                <h4 className="text-sm font-medium text-gray-300">筛选条件（时间精确到秒）</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <input
                    type="datetime-local"
                    step="1"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm"
                  />
                  <input
                    type="datetime-local"
                    step="1"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm"
                  />
                  <select
                    value={levelFilter}
                    onChange={(e) => setLevelFilter(e.target.value)}
                    className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm"
                  >
                    <option value="ALL">全部级别</option>
                    <option value="FATAL">FATAL</option>
                    <option value="ERROR">ERROR</option>
                    <option value="WARN">WARN</option>
                    <option value="INFO">INFO</option>
                    <option value="DEBUG">DEBUG</option>
                    <option value="UNKNOWN">UNKNOWN</option>
                  </select>
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="关键字搜索"
                    className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700">
                  <h4 className="text-sm font-medium text-gray-300 mb-3">级别分布</h4>
                  <div className="space-y-2 text-sm">
                    {Object.entries(analysis.levelStats).map(([name, count]) => (
                      <div key={name} className="flex items-center justify-between">
                        <span className="text-gray-300">{name}</span>
                        <span className="text-white font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700">
                  <h4 className="text-sm font-medium text-gray-300 mb-3">模块 Top 5</h4>
                  <div className="space-y-2 text-sm">
                    {analysis.topModules.length === 0 && (
                      <p className="text-gray-500">暂无模块数据</p>
                    )}
                    {analysis.topModules.map((item) => (
                      <div key={item.name} className="flex items-center justify-between">
                        <span className="text-gray-300 truncate pr-3">{item.name}</span>
                        <span className="text-white font-medium">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700">
                <h4 className="text-sm font-medium text-gray-300 mb-3">分析结论</h4>
                <ul className="space-y-2 text-sm text-gray-200 list-disc pl-5">
                  {analysis.conclusions.map((line, idx) => (
                    <li key={idx}>{line}</li>
                  ))}
                </ul>
              </div>

              <div className="p-4 rounded-lg bg-gray-800/30 border border-gray-700">
                <h4 className="text-sm font-medium text-gray-300 mb-3">日志明细（最近 200 条）</h4>
                <div className="max-h-[320px] overflow-y-auto rounded border border-gray-700">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-800 sticky top-0">
                      <tr>
                        <th className="text-left p-2">时间</th>
                        <th className="text-left p-2">级别</th>
                        <th className="text-left p-2">模块</th>
                        <th className="text-left p-2">信息</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.slice(-200).map((item) => (
                        <tr key={item.id} className="border-t border-gray-800">
                          <td className="p-2 text-gray-400 whitespace-nowrap">
                            {item.ts ? formatDateTime(item.ts) : '-'}
                          </td>
                          <td className="p-2">
                            <span className={`px-2 py-0.5 rounded ${
                              item.level === 'ERROR' || item.level === 'FATAL'
                                ? 'bg-red-500/20 text-red-300'
                                : item.level === 'WARN'
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : item.level === 'INFO'
                                    ? 'bg-green-500/20 text-green-300'
                                    : 'bg-gray-600/30 text-gray-300'
                            }`}>
                              {item.level}
                            </span>
                          </td>
                          <td className="p-2 text-gray-300">{item.module}</td>
                          <td className="p-2 text-gray-200">{item.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
