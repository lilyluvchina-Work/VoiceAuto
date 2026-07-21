/**
 * TAPD API 服务
 * 通过 Vite 代理 /tapd-api/* -> https://api.tapd.cn/* 避免跨域
 * 使用 HTTP Basic Auth (api_user:api_password)
 */

const BASE = '/tapd-api';
const BATCH_SIZE = 50; // 每批查询用例数
const TARGET_AGENT_ALIASES = ['目标Agent', '目标agent', '预期Agent', '期望Agent', '目标智能体', 'Agent', 'target_agent', 'TargetAgent', 'Target Agent'];
const TARGET_TEXT_ALIASES = ['目标文本', '目标语句', '测试文本', '输入文本', 'target_text', 'TargetText', 'Target Text'];
const SORT_FIELD_CANDIDATES = [
  'sort',
  'order',
  'position',
  'sequence',
  'seq',
  'rank',
  'display_order',
  'case_order',
  'testcase_order',
  'tcase_order',
  'tcase_sort',
];

function normalizeInput(value) {
  return String(value ?? '').trim();
}

function toBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeFieldName(value) {
  return String(value || '').replace(/[\s_\-：:]/g, '').toLowerCase();
}

function parseOptions(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    const parsed = tryParseJsonString(value);
    if (parsed) return parseOptions(parsed);
    return {};
  }
  if (Array.isArray(value)) {
    return value.reduce((acc, item) => {
      const key = String(item?.id ?? item?.value ?? item?.key ?? '').trim();
      const label = pickReadableText(item?.label ?? item?.name ?? item?.text ?? item?.value);
      if (key && label) acc[key] = label;
      return acc;
    }, {});
  }
  if (typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, optionValue]) => {
      const label = pickReadableText(optionValue);
      if (key && label) acc[String(key).trim()] = label;
      return acc;
    }, {});
  }
  return {};
}

function normalizeCustomFieldRecord(item) {
  const raw = item?.CustomFieldConfig || item?.CustomFieldSetting || item?.TcaseCustomFieldConfig || item || {};
  const customField = String(raw.custom_field || raw.field || raw.key || raw.name_key || '').trim();
  const name = String(raw.name || raw.label || raw.title || '').trim();
  return {
    customField,
    name,
    type: String(raw.type || raw.field_type || '').trim(),
    options: parseOptions(raw.options || raw.option || raw.enums || raw.values),
  };
}

function findCustomFieldByAliases(settings, aliases) {
  const aliasSet = new Set(aliases.map(normalizeFieldName));
  return (settings || []).find((item) => aliasSet.has(normalizeFieldName(item.name))) || null;
}

function resolveCustomFieldDisplayValue(rawValue, config) {
  const rawText = pickReadableText(rawValue);
  if (!rawText) return '';

  const options = config?.options || {};
  const parts = rawText.split(/[,\s;；，]+/).map((item) => item.trim()).filter(Boolean);
  const mappedParts = parts.map((part) => options[part] || part);
  return mappedParts.join(' / ').trim();
}

function isIdLikePath(value) {
  return /^[\d\s,|\-_/]+$/.test(String(value || '').trim());
}

function normalizeCategoryRecord(item) {
  const raw = item?.Category || item?.Tcategory || item?.TcaseCategory || item || {};
  return {
    id: String(raw.id || raw.category_id || '').trim(),
    name: String(raw.name || raw.category_name || '').trim(),
    parentId: String(raw.parent_id || raw.pid || '').trim(),
    path: String(raw.path || raw.category_path || '').trim(),
  };
}

function buildCategoryLookup(categories) {
  const byId = new Map();
  categories.forEach((c) => {
    if (!c.id) return;
    byId.set(c.id, c);
  });

  const cache = new Map();
  const buildNamePath = (id, trail = new Set()) => {
    if (!id || !byId.has(id)) return '';
    if (cache.has(id)) return cache.get(id);
    if (trail.has(id)) return '';

    trail.add(id);
    const node = byId.get(id);
    const parentNamePath = node.parentId ? buildNamePath(node.parentId, trail) : '';
    const currentName = node.name || '';
    const resolved = parentNamePath && currentName ? `${parentNamePath} / ${currentName}` : (currentName || parentNamePath);
    cache.set(id, resolved);
    trail.delete(id);
    return resolved;
  };

  return {
    resolve(categoryId) {
      const id = String(categoryId || '').trim();
      if (!id || !byId.has(id)) return null;
      const category = byId.get(id);
      const explicitPath = category.path && !isIdLikePath(category.path) ? category.path : '';
      const namePath = buildNamePath(id);
      return {
        name: category.name || '',
        path: explicitPath || namePath || '',
      };
    },
  };
}

async function fetchCaseCategoryLookup(workspaceId, apiUser, apiPassword) {
  const endpointCandidates = [
    { path: '/tcase_categories', buildParams: (page, limit) => ({ workspace_id: workspaceId, page, limit }) },
    { path: '/tcategories', buildParams: (page, limit) => ({ workspace_id: workspaceId, page, limit }) },
  ];

  const limit = 200;

  for (const endpoint of endpointCandidates) {
    try {
      let page = 1;
      const categories = [];
      while (true) {
        const data = await tapdGet(endpoint.path, endpoint.buildParams(page, limit), apiUser, apiPassword);
        const rows = asArray(data.data);
        rows.forEach((item) => {
          const normalized = normalizeCategoryRecord(item);
          if (normalized.id) {
            categories.push(normalized);
          }
        });

        if (rows.length < limit) break;
        page += 1;
      }

      return buildCategoryLookup(categories);
    } catch {
      // 某些企业空间下分类接口存在差异，尝试下一个候选接口
    }
  }

  return buildCategoryLookup([]);
}

function makeAuthHeader(apiUser, apiPassword) {
  const safeUser = normalizeInput(apiUser);
  const safePassword = normalizeInput(apiPassword);
  return 'Basic ' + toBase64Utf8(`${safeUser}:${safePassword}`);
}

function formatTapdApiError(info) {
  if (!info) return 'Unknown TAPD error';
  if (typeof info === 'string') return info;
  if (typeof info === 'object') {
    const message = info.msg || info.message || info.error_msg || info.error || '';
    const code = info.code || info.error_code || '';
    if (message && code) return `[${code}] ${message}`;
    if (message) return message;
    if (code) return String(code);
    return JSON.stringify(info);
  }
  return String(info);
}

function stripHtmlTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDirectoryText(value) {
  const text = stripHtmlTags(value);
  if (!text) return '';
  if (text === '0' || text === 'null' || text === 'undefined') return '';
  if (isIdLikePath(text)) return '';
  return text;
}

function splitPathSegments(value) {
  return String(value || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
}

function tryParseJsonString(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!(text.startsWith('{') || text.startsWith('['))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickReadableText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = tryParseJsonString(value);
    if (parsed !== null) {
      return pickReadableText(parsed);
    }
    return stripHtmlTags(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => pickReadableText(item)).filter(Boolean).join(' / ').trim();
  }
  if (typeof value === 'object') {
    const candidates = [
      value.text,
      value.title,
      value.name,
      value.value,
      value.label,
      value.display,
      value.content,
      value['growing-title'],
      value.growing_title,
      value.open_to_categories,
      value.openToCategories,
    ];
    for (const candidate of candidates) {
      const text = pickReadableText(candidate);
      if (text) return text;
    }
  }
  return '';
}

function pickSortValue(source) {
  if (!source || typeof source !== 'object') return '';

  for (const key of SORT_FIELD_CANDIDATES) {
    const directValue = source[key];
    if (directValue !== undefined && directValue !== null && String(directValue).trim() !== '') {
      return String(directValue).trim();
    }
  }

  for (const [key, value] of Object.entries(source)) {
    if (/(^|_)(sort|order|position|sequence|seq|rank)(_|$)/i.test(key)
      && value !== undefined
      && value !== null
      && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
}

function pickDirectoryText(value) {
  return normalizeDirectoryText(pickReadableText(value));
}

function extractGrowingTitle(source) {
  if (!source || typeof source !== 'object') return '';

  const directCandidates = [
    source['growing-title'],
    source.growing_title,
    source.growingTitle,
  ];

  for (const candidate of directCandidates) {
    const text = pickDirectoryText(candidate);
    if (text) return text;
  }

  const nestedCandidates = [source.attrs, source.attribute, source.fields, source.extend, source.extends];
  for (const nested of nestedCandidates) {
    const text = extractGrowingTitle(nested);
    if (text) return text;
  }

  return '';
}

function extractOpenToCategoriesTitle(source) {
  if (!source || typeof source !== 'object') return '';

  const openToCategoriesCandidates = [
    source.open_to_categories,
    source.openToCategories,
    source.open_to_categorys,
    source.openToCategorys,
    source['open-to-categories'],
    source.story_name?.open_to_categories,
    source.story_name?.openToCategories,
    source.story_name?.open_to_categorys,
    source.story_name?.openToCategorys,
  ];

  for (const candidate of openToCategoriesCandidates) {
    const text = pickDirectoryText(candidate);
    if (text) return text;

    if (Array.isArray(candidate)) {
      const joined = candidate
        .map((item) => pickReadableText(item))
        .filter(Boolean)
        .join(' / ')
        .trim();
      if (joined) return joined;
    }
  }

  const nestedCandidates = [source.attrs, source.attribute, source.fields, source.extend, source.extends];
  for (const nested of nestedCandidates) {
    const text = extractOpenToCategoriesTitle(nested);
    if (text) return text;
  }

  return '';
}

function extractPlanDirectoryTitle(source) {
  if (!source || typeof source !== 'object') return '';

  const directOpenCandidates = [
    source.open_to_categories,
    source.openToCategories,
    source.open_to_categorys,
    source.openToCategorys,
    source['open-to-categories'],
    source.story_name?.open_to_categories,
    source.story_name?.openToCategories,
    source.story_name?.open_to_categorys,
    source.story_name?.openToCategorys,
  ];

  for (const candidate of directOpenCandidates) {
    const text = pickDirectoryText(candidate);
    if (text) return text;
  }

  const nestedCandidates = [source.story_name, source.attrs, source.attribute, source.fields, source.extend, source.extends];
  for (const nested of nestedCandidates) {
    const text = extractPlanDirectoryTitle(nested);
    if (text) return text;
  }

  const exactDirectoryKeyCandidates = [
    source.case_directory,
    source.caseDirectory,
    source.directory_name,
    source.directoryName,
    source.catalog_name,
    source.catalogName,
    source.category_name,
    source.categoryName,
    source.tcase_category_name,
    source.tcaseCategoryName,
    source.module_name,
    source.moduleName,
  ];

  for (const candidate of exactDirectoryKeyCandidates) {
    const text = pickDirectoryText(candidate);
    if (text) return text;
  }

  for (const [key, value] of Object.entries(source)) {
    if (/^open[_-]?to[_-]?categor(?:y|ies|ys)$/i.test(key)) {
      const text = pickDirectoryText(value);
      if (text) return text;
    }
    if (/(directory|catalog|category|module)/i.test(key) && !/(^id$|_id$|path|status|creator|owner|created|modified)/i.test(key)) {
      const text = pickDirectoryText(value);
      if (text) return text;
    }
    if (value && typeof value === 'object') {
      const text = extractPlanDirectoryTitle(value);
      if (text) return text;
    }
  }

  return '';
}

function buildPlanDirectoryDiagnostics(item, rel) {
  const read = (value) => pickReadableText(value);

  return {
    itemKeys: Object.keys(item || {}),
    relationKeys: Object.keys(rel || {}),
    candidates: {
      itemOpenToCategories: read(item?.open_to_categories),
      itemOpenToCategorys: read(item?.open_to_categorys),
      itemStoryNameOpenToCategories: read(item?.story_name?.open_to_categories),
      itemStoryNameOpenToCategorys: read(item?.story_name?.open_to_categorys),
      relOpenToCategories: read(rel?.open_to_categories),
      relOpenToCategorys: read(rel?.open_to_categorys),
      relStoryNameOpenToCategories: read(rel?.story_name?.open_to_categories),
      relStoryNameOpenToCategorys: read(rel?.story_name?.open_to_categorys),
      parsedPlanDirectoryFromItem: extractPlanDirectoryTitle(item),
      parsedPlanDirectoryFromRelation: extractPlanDirectoryTitle(rel),
    },
  };
}

async function tapdGet(path, params, apiUser, apiPassword) {
  const url = new URL(BASE + path, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  let resp;
  try {
    resp = await fetch(url.toString(), {
      headers: { Authorization: makeAuthHeader(apiUser, apiPassword) },
    });
  } catch (error) {
    throw new Error(`TAPD network error: ${error?.message || 'request failed'}`);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const suffix = body ? ` - ${body.slice(0, 200)}` : '';
    throw new Error(`TAPD request failed: ${resp.status} ${resp.statusText}${suffix}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error('TAPD response parse failed: non-JSON response');
  }

  if (data.status !== 1) {
    const errText = formatTapdApiError(data.info || data);
    throw new Error(`TAPD API error: ${errText}`);
  }

  return data;
}

async function tapdPost(path, body, apiUser, apiPassword) {
  const url = new URL(BASE + path, window.location.origin);
  const payload = new URLSearchParams();
  Object.entries(body || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      payload.set(k, String(v));
    }
  });

  let resp;
  try {
    resp = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: makeAuthHeader(apiUser, apiPassword),
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: payload.toString(),
    });
  } catch (error) {
    throw new Error(`TAPD network error: ${error?.message || 'request failed'}`);
  }

  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => '');
    const suffix = bodyText ? ` - ${bodyText.slice(0, 200)}` : '';
    throw new Error(`TAPD request failed: ${resp.status} ${resp.statusText}${suffix}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error('TAPD response parse failed: non-JSON response');
  }

  if (data.status !== 1) {
    const errText = formatTapdApiError(data.info || data);
    throw new Error(`TAPD API error: ${errText}`);
  }

  return data;
}

/**
 * 测试连接 (通过获取项目列表验证)
 */
export async function testConnection(companyId, apiUser, apiPassword) {
  const normalizedCompanyId = normalizeInput(companyId);
  if (!normalizedCompanyId) {
    throw new Error('company_id is required');
  }

  await tapdGet('/workspaces/projects', { company_id: normalizedCompanyId, category: 'project', limit: 1 }, apiUser, apiPassword);
  return true;
}

/**
 * 获取公司下所有项目列表
 * @returns {{ workspaceId, workspaceName, status, category }[]}
 */
export async function fetchProjects(companyId, apiUser, apiPassword) {
  const normalizedCompanyId = normalizeInput(companyId);
  const data = await tapdGet(
    '/workspaces/projects',
    { company_id: normalizedCompanyId, category: 'project', limit: 200 },
    apiUser,
    apiPassword
  );

  const rows = data.data || [];
  return rows.map((item) => {
    const ws = item.Workspace || item;
    return {
      workspaceId: String(ws.id || ws.workspace_id || ''),
      workspaceName: ws.name || ws.workspace_name || '',
      status: ws.status || '',
      category: ws.category || '',
    };
  });
}

/**
 * 获取项目下状态为 open 的测试计划
 * @returns {{ testPlanId, testPlanName, owner, status }[]}
 */
export async function fetchOpenTestPlans(workspaceId, apiUser, apiPassword) {
  let page = 1;
  const limit = 200;
  const plans = [];

  while (true) {
    const data = await tapdGet(
      '/test_plans',
      { workspace_id: workspaceId, status: 'open', page, limit },
      apiUser,
      apiPassword
    );

    const rows = data.data || [];
    for (const item of rows) {
      const p = item.TestPlan || item;
      plans.push({
        testPlanId: String(p.id || ''),
        testPlanName: p.name || '',
        owner: p.owner || '',
        status: p.status || '',
      });
    }

    if (rows.length < limit) break;
    page++;
  }

  return plans;
}

/**
 * 获取测试计划中的所有用例 ID
 * @returns {string[]}
 */
export async function fetchPlanCases(workspaceId, testPlanId, apiUser, apiPassword) {
  let page = 1;
  const limit = 200;
  const caseMap = new Map();

  while (true) {
    const data = await tapdGet(
      '/test_plans/get_test_plan_tcase',
      {
        workspace_id: workspaceId,
        test_plan_id: testPlanId,
        page,
        limit,
      },
      apiUser,
      apiPassword
    );

    const rows = data.data || [];
    for (const item of rows) {
      const rel = item.TestPlanStoryTcaseRelation || item;
      const caseId = String(rel.tcase_id || '');
      if (!caseId || caseId === '0') continue;

      const existing = caseMap.get(caseId);
      if (!existing) {
        caseMap.set(caseId, {
          caseId,
          caseSort: pickSortValue(rel) || pickSortValue(item),
          planDirectoryTitle: '',
          diagnostics: buildPlanDirectoryDiagnostics(item, rel),
        });
      }
    }

    if (rows.length < limit) break;
    page++;
  }

  return Array.from(caseMap.values());
}

/**
 * 获取测试计划中的所有用例 ID
 * @returns {string[]}
 */
export async function fetchPlanCaseIds(workspaceId, testPlanId, apiUser, apiPassword) {
  const planCases = await fetchPlanCases(workspaceId, testPlanId, apiUser, apiPassword);
  return planCases.map((item) => item.caseId);
}

/**
 * 获取测试用例自定义字段配置，并识别目标 Agent / 目标文本字段。
 */
export async function fetchTcaseCustomFieldSettings(workspaceId, apiUser, apiPassword) {
  const data = await tapdGet(
    '/tcases/custom_fields_settings',
    { workspace_id: workspaceId },
    apiUser,
    apiPassword
  );

  const settings = (data.data || [])
    .map(normalizeCustomFieldRecord)
    .filter((item) => item.customField && item.name);

  const targetAgentField = findCustomFieldByAliases(settings, TARGET_AGENT_ALIASES);
  const targetTextField = findCustomFieldByAliases(settings, TARGET_TEXT_ALIASES);

  return {
    settings,
    targetAgentField,
    targetTextField,
  };
}

/**
 * 批量获取用例详情
 * @param {string[]} caseIds
 * @returns {TapdCase[]}
 */
export async function fetchCaseDetails(workspaceId, caseIds, apiUser, apiPassword, options = {}) {
  if (!Array.isArray(caseIds) || caseIds.length === 0) {
    return [];
  }

  const normalizedCaseIds = Array.from(new Set(caseIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (normalizedCaseIds.length === 0) {
    return [];
  }

  const cases = [];
  const categoryLookup = await fetchCaseCategoryLookup(workspaceId, apiUser, apiPassword);
  const customFieldInfo = options.customFieldInfo || await fetchTcaseCustomFieldSettings(workspaceId, apiUser, apiPassword).catch(() => ({
    settings: [],
    targetAgentField: null,
    targetTextField: null,
  }));
  const targetAgentField = customFieldInfo.targetAgentField;
  const targetTextField = customFieldInfo.targetTextField;
  const extraFields = [
    targetAgentField?.customField,
    targetTextField?.customField,
  ].filter(Boolean);
  const fields = Array.from(new Set([
    'id',
    'name',
    'steps',
    'expectation',
    'priority',
    'status',
    'category_id',
    'category_name',
    'module_name',
    ...SORT_FIELD_CANDIDATES,
    ...extraFields,
  ])).join(',');

  for (let i = 0; i < normalizedCaseIds.length; i += BATCH_SIZE) {
    const batch = normalizedCaseIds.slice(i, i + BATCH_SIZE);
    const data = await tapdGet(
      '/tcases',
      {
        workspace_id: workspaceId,
        id: batch.join(','),
        fields,
        limit: 200,
      },
      apiUser,
      apiPassword
    );

    for (const item of data.data || []) {
      const c = item.Tcase || item;
      const categoryObj = item.Category || c.Category || {};
      const categoryId = String(c.category_id || '').trim();
      const resolvedCategory = categoryLookup.resolve(categoryId);

      const caseDirectoryPath = (
        normalizeDirectoryText(resolvedCategory?.path)
        || normalizeDirectoryText(c.category_path)
        || normalizeDirectoryText(categoryObj.path)
        || normalizeDirectoryText(c.path)
      ).trim();

      const caseDirectoryName = (
        normalizeDirectoryText(resolvedCategory?.name)
        || normalizeDirectoryText(c.category_name)
        || normalizeDirectoryText(c.module_name)
        || normalizeDirectoryText(categoryObj.name)
        || splitPathSegments(caseDirectoryPath).slice(-1)[0]
      ).trim();
      const targetAgentRaw = targetAgentField?.customField ? c[targetAgentField.customField] : '';
      const targetTextRaw = targetTextField?.customField ? c[targetTextField.customField] : '';
      const targetAgent = resolveCustomFieldDisplayValue(targetAgentRaw, targetAgentField);
      const targetText = resolveCustomFieldDisplayValue(targetTextRaw, targetTextField);

      cases.push({
        id: String(c.id || ''),
        name: c.name || '',
        steps: c.steps || '',
        expectation: c.expectation || '',
        targetText,
        targetTextField: targetTextField?.customField || '',
        targetAgent,
        targetAgentField: targetAgentField?.customField || '',
        targetAgentFieldName: targetAgentField?.name || '',
        targetAgentSource: targetAgent ? (targetAgentField?.customField || 'custom_field') : '',
        priority: c.priority || '',
        status: c.status || '',
        categoryId,
        tapdPlanDirectory: caseDirectoryName || '',
        categoryName: caseDirectoryName || '',
        categoryPath: caseDirectoryPath || '',
        caseSort: pickSortValue(c) || pickSortValue(item),
      });
    }
  }

  return cases;
}

/**
 * 在 TAPD 项目下创建 Bug
 * @returns {{ bugId: string, title: string }}
 */
export async function createTapdBug(workspaceId, title, description, apiUser, apiPassword) {
  const normalizedWorkspaceId = normalizeInput(workspaceId);
  const normalizedTitle = normalizeInput(title);
  if (!normalizedWorkspaceId) {
    throw new Error('workspace_id is required');
  }
  if (!normalizedTitle) {
    throw new Error('bug title is required');
  }

  const data = await tapdPost(
    '/bugs',
    {
      workspace_id: normalizedWorkspaceId,
      title: normalizedTitle,
      description: String(description || '').trim(),
    },
    apiUser,
    apiPassword
  );

  const bug = data?.data?.Bug || data?.data || {};
  return {
    bugId: String(bug.id || bug.bug_id || ''),
    title: String(bug.title || normalizedTitle),
  };
}
