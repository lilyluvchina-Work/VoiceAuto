/**
 * TAPD 用例内容解析工具
 * 从用例步骤 (steps) 中提取 Human 语音指令文本
 */

// 匹配 Human/用户/人类 等前缀的正则（忽略大小写）
const HUMAN_PATTERNS = [
  /Human\s*[:：]\s*(.+)/i,
  /User\s*[:：]\s*(.+)/i,
  /用户\s*[:：]\s*(.+)/,
  /人类\s*[:：]\s*(.+)/,
];

// 去除行首序号前缀，如 "1. " "2、" "(3) "
const NUMBER_PREFIX_RE = /^\d+\s*[\.、)）]\s*/;

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTargetAgent(...sources) {
  const patterns = [
    /(?:目标\s*agent|目标Agent|target\s*agent|期望\s*agent|预期\s*agent|命中\s*agent|AgentCode|agent_code|agent)\s*[:：=]\s*([A-Za-z0-9_-]+)/i,
    /(?:路由到|命中到|进入|调用)\s*([A-Za-z][A-Za-z0-9_-]*(?:_agent|Agent))/i,
  ];

  for (const source of sources) {
    const text = stripHtml(source);
    if (!text) continue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
  }

  return '';
}

/**
 * 从 steps 字段中提取所有 Human 语句
 * @param {string} steps - TAPD 用例步骤文本（可能包含 HTML 或纯文本）
 * @returns {string[]} human 语句数组
 */
export function extractHumanTexts(steps) {
  if (!steps) return [];

  // 去除 HTML 标签（TAPD 步骤可能含富文本）
  const plain = stripHtml(steps);

  const result = [];

  for (const rawLine of plain.split(/\r?\n/)) {
    const line = rawLine.trim().replace(NUMBER_PREFIX_RE, '');
    if (!line) continue;

    for (const pattern of HUMAN_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const text = match[1].trim();
        if (text) result.push(text);
        break;
      }
    }
  }

  return result;
}

/**
 * 将 TAPD 用例转换为本地测试用例对象
 * @param {object} tapdCase - tapdService.fetchCaseDetails 返回的单条记录
 * @param {object} meta - 导入上下文 { workspaceId, workspaceName, testPlanId, testPlanName, testPlanOwner }
 * @param {object} defaultVoiceConfig
 * @param {function} generateId
 * @returns {{ audio, humanTexts, skipped, reason }[]} 每条 Human 语句对应一个测试用例
 */
export function tapdCaseToTestAudios(tapdCase, meta, defaultVoiceConfig, generateId) {
  const stepHumanTexts = extractHumanTexts(tapdCase.steps);
  const targetText = stripHtml(tapdCase.targetText);
  const humanTexts = targetText ? [targetText] : stepHumanTexts;
  const rawCategoryName = String(tapdCase.tapdPlanDirectory || tapdCase.categoryName || '').trim();
  const categoryNameLooksLikeId = /^[\d\s,|\-_/]+$/.test(rawCategoryName);
  const categoryName = categoryNameLooksLikeId ? '' : rawCategoryName;
  const categoryPath = String(tapdCase.categoryPath || '').trim();
  const categoryId = String(tapdCase.categoryId || '').trim();

  // category_path 在 TAPD 中常见为 ID 路径，这里优先显示目录名称
  const pathLooksLikeId = /^[\d\s,|\-_/]+$/.test(categoryPath);
  const readablePath = categoryPath && !pathLooksLikeId ? categoryPath : '';

  const caseDirectory = (
    categoryName
    || readablePath
    || '未分类目录'
  ).trim();

  const moduleName = caseDirectory;
  const parsedTargetAgent = extractTargetAgent(
    tapdCase.expectation,
    tapdCase.steps,
    tapdCase.name,
    meta.testPlanName,
    caseDirectory
  );
  const targetAgent = stripHtml(tapdCase.targetAgent) || parsedTargetAgent;
  const caseSort = String(meta?.planCase?.caseSort || tapdCase.caseSort || '').trim();
  const importIndex = Number.isFinite(Number(meta?.importIndex)) ? Number(meta.importIndex) : null;
  const targetAgentSource = tapdCase.targetAgent
    ? (tapdCase.targetAgentField || 'TAPD自定义字段')
    : (targetAgent ? '步骤/预期结果解析' : '');

  if (humanTexts.length === 0) {
    return [{ audio: null, humanTexts: [], skipped: true, reason: '步骤中未识别到 Human 内容', caseTitle: tapdCase.name, tapdCaseId: tapdCase.id }];
  }

  return humanTexts.map((text, index) => {
    const localId = generateId();
    const caseId = tapdCase.id ? `${tapdCase.id}_${index + 1}` : localId;
    return {
      audio: {
        id: localId,
        caseId,
        case_id: caseId,
        text,
        module: moduleName,
        source: 'tapd',
        audioBlob: null,
        audioUrl: null,
        duration: 0,
        config: { ...defaultVoiceConfig },
        audioStatus: 'not_generated',
        caseDirectory,
        tapdPlanDirectory: caseDirectory,
        tapdCategoryId: categoryId,
        tapdCategoryName: categoryName,
        tapdCategoryPath: categoryPath,
        caseSort,
        tapdCaseSort: caseSort,
        importIndex: importIndex === null ? undefined : importIndex,
        tapdImportIndex: importIndex === null ? undefined : importIndex,
        // TAPD 元数据
        tapdCaseId: tapdCase.id,
        tapdTestPlanId: meta.testPlanId,
        tapdTestPlanName: meta.testPlanName,
        tapdTestPlanOwner: meta.testPlanOwner || '',
        workspaceId: meta.workspaceId,
        workspaceName: meta.workspaceName,
        caseTitle: tapdCase.name,
        tapdSteps: tapdCase.steps || '',
        expectedResult: tapdCase.expectation,
        targetAgent,
        targetAgentSource,
        targetAgentField: tapdCase.targetAgentField || '',
        targetAgentFieldName: tapdCase.targetAgentFieldName || '',
        targetAgentValid: Boolean(targetAgent),
        targetTextField: tapdCase.targetTextField || '',
        priority: tapdCase.priority,
        tapdStatus: tapdCase.status,
        humanIndex: index + 1,
      },
      humanTexts,
      skipped: false,
      reason: '',
      caseTitle: tapdCase.name,
      tapdCaseId: tapdCase.id,
    };
  });
}
