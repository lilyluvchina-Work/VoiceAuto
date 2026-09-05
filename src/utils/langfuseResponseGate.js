const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_INTERVAL_MS = 3000;

const sleepDefault = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function parseJsonLike(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/^[\[{"]/.test(trimmed)) return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function extractLangfuseText(value, depth = 0) {
  if (value == null || depth > 6) return '';
  const parsed = parseJsonLike(value);
  if (typeof parsed === 'string') return normalizeText(parsed);
  if (typeof parsed !== 'object') return normalizeText(parsed);

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const text = extractLangfuseText(item, depth + 1);
      if (text) return text;
    }
    return '';
  }

  const preferredKeys = [
    'response_text',
    'full_answer',
    'full-answer',
    'answer',
    'content',
    'text',
    'message',
    'output',
    'completion',
    'data',
  ];
  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      const text = extractLangfuseText(parsed[key], depth + 1);
      if (text) return text;
    }
  }

  for (const value of Object.values(parsed)) {
    const text = extractLangfuseText(value, depth + 1);
    if (text) return text;
  }
  return '';
}

export function isResponseCompleteObservation(observation = {}) {
  return String(observation.name || '').toLowerCase().includes('response_complete');
}

function collectSearchText(value, depth = 0) {
  if (value == null || depth > 4) return '';
  const parsed = parseJsonLike(value);
  if (typeof parsed !== 'object') return normalizeText(parsed);
  if (Array.isArray(parsed)) {
    return parsed.map(item => collectSearchText(item, depth + 1)).filter(Boolean).join(' ');
  }
  return Object.values(parsed).map(item => collectSearchText(item, depth + 1)).filter(Boolean).join(' ');
}

function traceMatchesTestCase(trace = {}, testCase = {}) {
  const audio = testCase.audio || testCase || {};
  const targetText = normalizeText(audio.text || testCase.targetText || '');
  const exactIds = [
    audio.id,
    audio.tapdCaseId,
    audio.humanIndex,
    testCase.caseId,
    testCase.audioId,
  ].map(normalizeText).filter(Boolean);
  const haystack = normalizeText([
    trace.id,
    trace.name,
    trace.sessionId,
    collectSearchText(trace.input),
    collectSearchText(trace.output),
    collectSearchText(trace.metadata),
    collectSearchText(trace.tags),
  ].filter(Boolean).join(' '));

  if (!haystack) return false;
  if (exactIds.some(id => haystack.includes(id))) return true;
  return Boolean(targetText && haystack.includes(targetText));
}

function findTraceForObservation(observation, traces = [], testCase = {}) {
  const traceId = observation.traceId || observation.trace_id || observation.trace?.id;
  const trace = traces.find(item => item.id === traceId) || null;
  if (trace && traceMatchesTestCase(trace, testCase)) return trace;
  if (trace && !testCase?.audio?.text) return trace;
  return traces.find(item => traceMatchesTestCase(item, testCase)) || trace;
}

export function resolveResponseCompleteCandidate({
  traces = [],
  observations = [],
  testCase = {},
} = {}) {
  const candidates = observations
    .filter(isResponseCompleteObservation)
    .slice()
    .sort((a, b) => {
      const left = Date.parse(a.startTime || a.endTime || a.createdAt || '') || 0;
      const right = Date.parse(b.startTime || b.endTime || b.createdAt || '') || 0;
      return right - left;
    });

  for (const observation of candidates) {
    const responseText = extractLangfuseText(observation.output ?? observation.response ?? observation);
    if (!responseText) continue;
    const matchedTrace = findTraceForObservation(observation, traces, testCase);
    const hasCaseHint = Boolean(testCase?.audio?.text || testCase?.caseId || testCase?.audioId);
    if (hasCaseHint && traces.length > 0 && !matchedTrace) continue;

    return {
      success: true,
      status: 'response_complete',
      responseText,
      matchedObservationId: observation.id || '',
      matchedTraceId: matchedTrace?.id || observation.traceId || observation.trace_id || '',
      matchedObservationName: observation.name || '',
      matchedAt: observation.endTime || observation.startTime || observation.createdAt || null,
    };
  }

  return null;
}

export async function waitForLangfuseResponseComplete({
  envKey,
  fromTimestamp,
  toTimestamp,
  testCase,
  fetchTraces,
  fetchObservations,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  signal,
  sleep = sleepDefault,
  now = () => Date.now(),
  onAttempt,
} = {}) {
  if (!fetchTraces || !fetchObservations) {
    throw new Error('Langfuse fetch functions are required');
  }

  const startedAt = now();
  let attempts = 0;
  let lastError = null;

  while ((now() - startedAt) <= Math.max(0, timeoutMs)) {
    if (signal?.aborted) {
      return {
        success: false,
        status: 'aborted',
        attempts,
        message: 'Langfuse response 等待已取消',
      };
    }

    attempts += 1;
    const toValue = typeof toTimestamp === 'function' ? toTimestamp() : toTimestamp;
    try {
      const [traces, observations] = await Promise.all([
        fetchTraces(envKey, fromTimestamp, toValue),
        fetchObservations(envKey, fromTimestamp, toValue),
      ]);
      const candidate = resolveResponseCompleteCandidate({ traces, observations, testCase });
      onAttempt?.({ attempts, tracesCount: traces.length, observationsCount: observations.length, candidate });
      if (candidate) {
        return {
          ...candidate,
          attempts,
          fetchedAt: now(),
        };
      }
    } catch (error) {
      lastError = error;
      onAttempt?.({ attempts, error });
    }

    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) break;
    await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - elapsed)));
  }

  return {
    success: false,
    status: 'timeout',
    attempts,
    message: lastError?.message || 'Langfuse 未确认 response 成功',
  };
}
