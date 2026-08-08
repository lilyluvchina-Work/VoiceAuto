function normalizeLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeComparable(value) {
  return normalizeLine(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function firstPresent(source, fields) {
  for (const field of fields) {
    const value = normalizeLine(source?.[field]);
    if (value) return value;
  }
  return '';
}

function resolveAudioCaseId(audio) {
  const explicit = firstPresent(audio, ['caseId', 'case_id', 'testCaseId', 'tapdCaseAudioId']);
  if (explicit) return explicit;
  const tapdCaseId = normalizeLine(audio?.tapdCaseId);
  const humanIndex = normalizeLine(audio?.humanIndex);
  if (tapdCaseId && humanIndex) return `${tapdCaseId}_${humanIndex}`;
  return tapdCaseId;
}

function resolveAudioBySessionRow(testAudios, row) {
  const audios = Array.isArray(testAudios) ? testAudios : [];
  const rowCaseId = firstPresent(row, ['case_id', 'caseId', 'test_case_id', 'testCaseId']);
  if (rowCaseId) {
    const byCaseId = audios.find((audio) => resolveAudioCaseId(audio) === rowCaseId);
    if (byCaseId) return byCaseId;
  }

  const rowAudioFile = firstPresent(row, ['audio_file', 'audioFile']);
  if (rowAudioFile) {
    const byAudioFile = audios.find((audio) => normalizeLine(audio?.audioFile) === rowAudioFile);
    if (byAudioFile) return byAudioFile;
  }

  const normalizedInput = normalizeComparable(row?.InputText || row?.actual_input_text || row?.输入);
  if (!normalizedInput) return null;
  return audios.find((item) => normalizeComparable(item?.text) === normalizedInput) || null;
}

function resolveCaseName(row, audio) {
  return normalizeLine(
    audio?.caseTitle
    || audio?.name
    || audio?.tapdCaseTitle
    || row?.caseName
    || row?.case_name
    || row?.用例名称
    || row?.InputText
    || row?.actual_input_text
    || '未命名用例'
  );
}

function resolveLogUrl(row) {
  return firstPresent(row, ['logUrl', 'log_url', '日志链接', 'traceUrl', 'trace_url']) || '-';
}

function resolveExecuteTime(row) {
  return firstPresent(row, ['executeTime', 'execute_time', 'trace_time', 'timestamp', 'startTime', 'createdAt']) || '-';
}

function resolveTestEnvironment(options = {}) {
  const explicit = normalizeLine(
    options.testEnvironment
    || options.environment
    || options.envText
  );
  if (explicit) return explicit;

  const envLabel = normalizeLine(options.envLabel);
  const envKey = normalizeLine(options.envKey);
  if (envLabel && envKey) return `${envLabel} (${envKey})`;
  return envLabel || envKey || '-';
}

function clipLines(lines, maxLines = 8) {
  return lines.slice(0, maxLines).join('\n').trim();
}

function inlineText(value) {
  return normalizeLine(String(value || '').replace(/\r?\n/g, ' '));
}

export function extractCoreErrorMessage(raw) {
  const text = String(raw || '').trim();
  if (!text) return '未解析到明确错误信息，请查看日志链接。';

  const lines = text.split(/\r?\n/);
  const keywordRegex = /\b(Exception|Error|AssertionError|Traceback|FAILED)\b/i;
  const startIndex = lines.findIndex((line) => keywordRegex.test(line));
  if (startIndex < 0) return '未解析到明确错误信息，请查看日志链接。';

  const picked = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (picked.length > 0 && !line.trim()) break;
    if (
      picked.length > 0
      && /^(INFO|DEBUG|TRACE|WARN)\b/i.test(line.trim())
      && !keywordRegex.test(line)
    ) {
      break;
    }
    picked.push(line);
    if (picked.length >= 8) break;
  }

  return clipLines(picked) || '未解析到明确错误信息，请查看日志链接。';
}

export function buildTapdBugPayloads(sessionRows, testAudios, options = {}) {
  const rowsWithErrors = (sessionRows || []).filter((row) => String(row?.error || row?.error_message || row?.错误信息 || '').trim());
  const pendingBugs = [];
  const testEnvironment = resolveTestEnvironment(options);

  for (const row of rowsWithErrors) {
    const matchedAudio = resolveAudioBySessionRow(testAudios, row);
    const caseName = resolveCaseName(row, matchedAudio);
    const rawError = row?.error || row?.error_message || row?.错误信息 || '';
    const errorMessage = extractCoreErrorMessage(rawError);
    const inlineErrorMessage = inlineText(errorMessage);
    const logUrl = resolveLogUrl(row);
    const executeTime = resolveExecuteTime(row);
    const title = `【自动化测试】${caseName}执行异常`;
    const description = [
      '【问题来源】 自动化测试',
      '【执行结果】 执行异常',
      `【错误信息】 + ${inlineErrorMessage}`,
      `【测试环境】 ${testEnvironment}`,
      `【日志链接】 ${logUrl}`,
      `【执行时间】 ${executeTime}`,
      '【补充说明】 该 Bug 由自动化测试平台自动创建，请优先查看错误信息和日志链接定位原因。',
    ].join('\n');

    pendingBugs.push({
      title: title.length > 255 ? `${title.slice(0, 252)}...` : title,
      description,
      dedupeKey: `${title}##${errorMessage}##${logUrl}`,
    });
  }

  const seen = new Set();
  return pendingBugs.filter((item) => {
    if (seen.has(item.dedupeKey)) return false;
    seen.add(item.dedupeKey);
    return true;
  });
}
