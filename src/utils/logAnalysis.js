/**
 * 日志解析与分析工具
 */

const LEVEL_PATTERNS = [
  { key: 'fatal', label: 'FATAL', regex: /\b(fatal|critical|崩溃|致命)\b/i },
  { key: 'error', label: 'ERROR', regex: /\b(error|err|exception|异常|失败|错误)\b/i },
  { key: 'warn', label: 'WARN', regex: /\b(warn|warning|告警|警告)\b/i },
  { key: 'info', label: 'INFO', regex: /\b(info|提示|成功|开始|完成)\b/i },
  { key: 'debug', label: 'DEBUG', regex: /\b(debug|trace|调试)\b/i }
];

const MODULE_PATTERNS = [
  /\[(?<module>[A-Za-z0-9_.-]{2,40})\]/,
  /(?:module|service|component|app|来源|模块)\s*[=:：]\s*(?<module>[A-Za-z0-9_\-\u4e00-\u9fa5]{2,40})/i,
  /^(?<module>[A-Za-z0-9_.-]{2,30})\s*[-:：]/
];

function toSecondTimestamp(ms) {
  return Math.floor(ms / 1000) * 1000;
}

function safeDate(ms) {
  if (!Number.isFinite(ms)) {
    return null;
  }
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseFlexibleDate(text) {
  const source = String(text || '').trim();
  if (!source) {
    return null;
  }

  const direct = new Date(source);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const md = source.match(/^(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (md) {
    const year = new Date().getFullYear();
    const [, month, day, hour, minute, second, ms = '0'] = md;
    const date = new Date(
      year,
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(ms.padEnd(3, '0'))
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const slash = source.match(/^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (slash) {
    const [, year, month, day, hour, minute, second, ms = '0'] = slash;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(ms.padEnd(3, '0'))
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function extractTimestamp(line) {
  const text = String(line || '');

  const patterns = [
    /(?<ts>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})?)/,
    /(?<ts>\d{4}\/\d{2}\/\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/,
    /(?<ts>\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/,
    /\[(?<ts>\d{10,13})\]/,
    /\b(?<ts>\d{10,13})\b/
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (!match?.groups?.ts) {
      continue;
    }

    const raw = match.groups.ts;
    if (/^\d{10,13}$/.test(raw)) {
      const value = Number(raw.length === 10 ? `${raw}000` : raw);
      const date = safeDate(value);
      if (date) {
        return { date, raw };
      }
      continue;
    }

    const date = parseFlexibleDate(raw);
    if (date) {
      return { date, raw };
    }
  }

  return { date: null, raw: null };
}

function extractLevel(line) {
  for (const item of LEVEL_PATTERNS) {
    if (item.regex.test(line)) {
      return item.label;
    }
  }
  return 'UNKNOWN';
}

function extractModule(line) {
  for (const regex of MODULE_PATTERNS) {
    const match = line.match(regex);
    if (match?.groups?.module) {
      return match.groups.module;
    }
  }
  return '未识别';
}

function extractMessage(line, tsRaw, level) {
  let text = String(line || '');
  if (tsRaw) {
    text = text.replace(tsRaw, '').trim();
  }
  if (level && level !== 'UNKNOWN') {
    text = text.replace(new RegExp(level, 'i'), '').trim();
  }
  text = text.replace(/^[-:|\]\s]+/, '').trim();
  return text || String(line || '');
}

export function parseLogContent(content) {
  const rows = String(content || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const entries = rows.map((line, index) => {
    const { date, raw } = extractTimestamp(line);
    const level = extractLevel(line);
    const module = extractModule(line);

    return {
      id: `log_${Date.now()}_${index}`,
      lineNo: index + 1,
      raw,
      timestamp: date ? date.toISOString() : null,
      ts: date ? date.getTime() : null,
      secondTs: date ? toSecondTimestamp(date.getTime()) : null,
      level,
      module,
      message: extractMessage(line, raw, level),
      original: line
    };
  });

  return entries;
}

function calcLevelMap(entries) {
  const levelMap = {};
  entries.forEach((item) => {
    levelMap[item.level] = (levelMap[item.level] || 0) + 1;
  });
  return levelMap;
}

function calcModuleMap(entries) {
  const moduleMap = {};
  entries.forEach((item) => {
    moduleMap[item.module] = (moduleMap[item.module] || 0) + 1;
  });
  return moduleMap;
}

function sortTopN(mapObj, n = 5) {
  return Object.entries(mapObj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function calcPeakSecond(entries) {
  const secondCount = {};
  entries.forEach((item) => {
    if (!item.secondTs) {
      return;
    }
    secondCount[item.secondTs] = (secondCount[item.secondTs] || 0) + 1;
  });

  const ranked = Object.entries(secondCount)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([secondTs, count]) => ({ secondTs: Number(secondTs), count }));

  return ranked;
}

export function analyzeLogEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const withTs = list.filter((item) => Number.isFinite(item.ts));
  const errors = list.filter((item) => item.level === 'ERROR' || item.level === 'FATAL');
  const warns = list.filter((item) => item.level === 'WARN');

  const levelStats = calcLevelMap(list);
  const moduleStats = calcModuleMap(list);
  const topModules = sortTopN(moduleStats, 5);
  const peakSeconds = calcPeakSecond(list);

  const firstTs = withTs.length > 0 ? Math.min(...withTs.map((i) => i.ts)) : null;
  const lastTs = withTs.length > 0 ? Math.max(...withTs.map((i) => i.ts)) : null;

  const errorRate = list.length > 0 ? Number(((errors.length / list.length) * 100).toFixed(1)) : 0;
  const warnRate = list.length > 0 ? Number(((warns.length / list.length) * 100).toFixed(1)) : 0;

  const conclusions = [];
  if (list.length === 0) {
    conclusions.push('当前筛选条件下没有日志数据，无法输出有效结论。');
  } else {
    conclusions.push(`日志总量 ${list.length} 条，其中可解析时间戳 ${withTs.length} 条。`);

    if (errorRate >= 20) {
      conclusions.push(`错误占比 ${errorRate}% ，系统稳定性风险较高，建议优先排查 ERROR/FATAL。`);
    } else if (errorRate >= 5) {
      conclusions.push(`错误占比 ${errorRate}% ，存在明显异常，需要关注高频错误模块。`);
    } else {
      conclusions.push(`错误占比 ${errorRate}% ，整体运行相对稳定。`);
    }

    if (warnRate >= 15) {
      conclusions.push(`WARN 占比 ${warnRate}% ，潜在风险较多，建议提前治理。`);
    }

    if (topModules.length > 0) {
      conclusions.push(`日志最集中模块为 ${topModules[0].name}（${topModules[0].count} 条）。`);
    }

    if (peakSeconds.length > 0) {
      const peak = peakSeconds[0];
      conclusions.push(`峰值发生在 ${formatDateTime(peak.secondTs)}，该秒内出现 ${peak.count} 条日志。`);
    }

    const missingTs = list.length - withTs.length;
    if (missingTs > 0) {
      conclusions.push(`有 ${missingTs} 条日志未识别出时间戳，建议补充规范化时间字段以提升分析准确度。`);
    }
  }

  return {
    totals: {
      count: list.length,
      withTimestamp: withTs.length,
      withoutTimestamp: list.length - withTs.length,
      errorCount: errors.length,
      warnCount: warns.length,
      errorRate,
      warnRate
    },
    levelStats,
    moduleStats,
    topModules,
    peakSeconds,
    firstTs,
    lastTs,
    conclusions
  };
}

export function formatDateTime(ts) {
  if (!Number.isFinite(ts)) {
    return '-';
  }
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  const second = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function formatBytes(size = 0) {
  if (!Number.isFinite(size) || size < 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[idx]}`;
}
