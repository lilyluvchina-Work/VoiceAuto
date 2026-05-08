/**
 * TAPD API 服务
 * 通过 Vite 代理 /tapd-api/* -> https://api.tapd.cn/* 避免跨域
 * 使用 HTTP Basic Auth (api_user:api_password)
 */

const BASE = '/tapd-api';
const BATCH_SIZE = 50; // 每批查询用例数

function makeAuthHeader(apiUser, apiPassword) {
  return 'Basic ' + btoa(`${apiUser}:${apiPassword}`);
}

async function tapdGet(path, params, apiUser, apiPassword) {
  const url = new URL(BASE + path, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  const resp = await fetch(url.toString(), {
    headers: { Authorization: makeAuthHeader(apiUser, apiPassword) },
  });

  if (!resp.ok) {
    throw new Error(`TAPD request failed: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  if (data.status !== 1) {
    throw new Error(`TAPD API error: ${JSON.stringify(data.info || data)}`);
  }

  return data;
}

/**
 * 测试连接 (通过获取项目列表验证)
 */
export async function testConnection(companyId, apiUser, apiPassword) {
  await tapdGet('/workspaces/projects', { company_id: companyId, category: 'project', limit: 1 }, apiUser, apiPassword);
  return true;
}

/**
 * 获取公司下所有项目列表
 * @returns {{ workspaceId, workspaceName, status, category }[]}
 */
export async function fetchProjects(companyId, apiUser, apiPassword) {
  const data = await tapdGet(
    '/workspaces/projects',
    { company_id: companyId, category: 'project', limit: 200 },
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
export async function fetchPlanCaseIds(workspaceId, testPlanId, apiUser, apiPassword) {
  let page = 1;
  const limit = 200;
  const ids = new Set();

  while (true) {
    const data = await tapdGet(
      '/test_plans/get_test_plan_tcase',
      { workspace_id: workspaceId, test_plan_id: testPlanId, page, limit },
      apiUser,
      apiPassword
    );

    const rows = data.data || [];
    for (const item of rows) {
      const rel = item.TestPlanStoryTcaseRelation || item;
      const caseId = String(rel.tcase_id || '');
      if (caseId && caseId !== '0') ids.add(caseId);
    }

    if (rows.length < limit) break;
    page++;
  }

  return Array.from(ids);
}

/**
 * 批量获取用例详情
 * @param {string[]} caseIds
 * @returns {TapdCase[]}
 */
export async function fetchCaseDetails(workspaceId, caseIds, apiUser, apiPassword) {
  const cases = [];

  for (let i = 0; i < caseIds.length; i += BATCH_SIZE) {
    const batch = caseIds.slice(i, i + BATCH_SIZE);
    const data = await tapdGet(
      '/tcases',
      {
        workspace_id: workspaceId,
        id: batch.join(','),
        fields: 'id,name,steps,expectation,priority,status,category_id,category_name,category_path,module_name',
        limit: 200,
      },
      apiUser,
      apiPassword
    );

    for (const item of data.data || []) {
      const c = item.Tcase || item;
      const categoryObj = item.Category || c.Category || {};
      cases.push({
        id: String(c.id || ''),
        name: c.name || '',
        steps: c.steps || '',
        expectation: c.expectation || '',
        priority: c.priority || '',
        status: c.status || '',
        categoryId: String(c.category_id || ''),
        categoryName: c.category_name || c.module_name || categoryObj.name || '',
        categoryPath: c.category_path || categoryObj.path || c.path || '',
      });
    }
  }

  return cases;
}
