import { CONFIG_TYPES, readConfig as readSecureConfig } from '../modules/config/secureConfigStore.js';
import { createTapdBug } from '../modules/tapd/services/tapdService.js';
import { buildTapdBugPayloads } from './tapdBugFormatter.js';

function normalizeLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function loadTapdConfig() {
  return readSecureConfig(CONFIG_TYPES.TAPD, { includeSecrets: true });
}

export function resolveDeveloperOwner({ summaryReport = {}, runtimeReport = {} } = {}) {
  return normalizeLine(
    summaryReport.developerOwner
    || summaryReport.devOwner
    || summaryReport.currentOwner
    || summaryReport.current_owner
    || runtimeReport.developerOwner
    || runtimeReport.devOwner
    || runtimeReport.currentOwner
    || runtimeReport.current_owner
  );
}

export function resolveBugFoundVersion({ summaryReport = {}, runtimeReport = {} } = {}) {
  return normalizeLine(
    summaryReport.bugFoundVersion
    || summaryReport.versionReport
    || summaryReport.version_report
    || summaryReport.foundVersion
    || runtimeReport.bugFoundVersion
    || runtimeReport.versionReport
    || runtimeReport.version_report
    || runtimeReport.foundVersion
  );
}

export async function submitTapdBugsBySessionRows(sessionRows, testAudios, options = {}) {
  const bugPayloads = buildTapdBugPayloads(sessionRows, testAudios, options);
  if (bugPayloads.length === 0) {
    return { skipped: true, reason: 'no-error', total: 0, created: 0, failed: 0 };
  }

  const cfg = options.tapdConfig || loadTapdConfig();
  const apiUser = normalizeLine(cfg.apiUser);
  const apiPassword = normalizeLine(cfg.apiPassword);
  const workspaceId = normalizeLine(cfg.workspaceId);
  if (!apiUser || !apiPassword || !workspaceId) {
    return {
      skipped: true,
      reason: 'missing-config',
      total: bugPayloads.length,
      created: 0,
      failed: bugPayloads.length,
    };
  }

  const currentOwner = normalizeLine(options.currentOwner || options.developerOwner);
  const versionReport = normalizeLine(options.versionReport || options.version_report || options.bugFoundVersion);
  const createBug = options.createBug || createTapdBug;
  let created = 0;
  let failed = 0;
  for (const bug of bugPayloads) {
    try {
      await createBug(workspaceId, bug.title, bug.description, apiUser, apiPassword, { currentOwner, versionReport });
      created++;
    } catch {
      failed++;
    }
  }

  return {
    skipped: false,
    reason: '',
    total: bugPayloads.length,
    created,
    failed,
  };
}
