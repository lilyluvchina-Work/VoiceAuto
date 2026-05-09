/**
 * TAPD 接口导入向导 (4步)
 * Step1: 配置 API 凭据 → Step2: 选择项目 → Step3: 选择测试计划 → Step4: 导入结果
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useTest, actions } from '../stores/testStore';
import { generateId } from '../utils/audioUtils.jsx';
import {
  testConnection,
  fetchProjects,
  fetchOpenTestPlans,
  fetchPlanCases,
  fetchCaseDetails,
} from '../modules/tapd/services/tapdService';
import { tapdCaseToTestAudios } from '../modules/tapd/utils/tapdParser';

const CONFIG_KEY = 'voiceauto_tapd_config_v1';

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepBar({ step }) {
  const steps = ['API 配置', '选择项目', '选择计划', '导入结果'];
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, i) => {
        const num = i + 1;
        const active = num === step;
        const done = num < step;
        return (
          <React.Fragment key={num}>
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors
                  ${done ? 'bg-green-500 border-green-500 text-white' : active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-dark border-gray-600 text-gray-500'}`}
              >
                {done ? '✓' : num}
              </div>
              <span className={`text-xs mt-1 whitespace-nowrap ${active ? 'text-blue-400' : done ? 'text-green-400' : 'text-gray-500'}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 ${done ? 'bg-green-500' : 'bg-gray-700'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Step 1: API Config ───────────────────────────────────────────────────────
function Step1Config({ onNext }) {
  const saved = loadConfig();
  const [apiUser, setApiUser] = useState(saved.apiUser || '');
  const [apiPassword, setApiPassword] = useState(saved.apiPassword || '');
  const [companyId, setCompanyId] = useState(saved.companyId || '');
  const [debugDirectoryMapping, setDebugDirectoryMapping] = useState(Boolean(saved.debugDirectoryMapping));
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('');

  const handleTest = async () => {
    const normalizedApiUser = apiUser.trim();
    const normalizedApiPassword = apiPassword.trim();
    const normalizedCompanyId = companyId.trim();

    if (!normalizedApiUser || !normalizedApiPassword || !normalizedCompanyId) {
      setMsgType('error'); setMsg('请填写全部字段'); return;
    }
    setTesting(true); setMsg(''); setMsgType('');
    try {
      await testConnection(normalizedCompanyId, normalizedApiUser, normalizedApiPassword);
      setMsgType('success'); setMsg('连接成功！');
    } catch (err) {
      const rawMessage = String(err?.message || 'unknown error');
      const unauthorized = /401|unauthorized/i.test(rawMessage);
      const hint = unauthorized ? '（请使用 TAPD「个人设置 -> API 管理」中的 api_user / api_password，而不是登录密码）' : '';
      setMsgType('error'); setMsg('连接失败: ' + rawMessage + hint);
    } finally {
      setTesting(false);
    }
  };

  const handleNext = () => {
    const normalizedApiUser = apiUser.trim();
    const normalizedApiPassword = apiPassword.trim();
    const normalizedCompanyId = companyId.trim();

    if (!normalizedApiUser || !normalizedApiPassword || !normalizedCompanyId) {
      setMsgType('error'); setMsg('请填写全部字段'); return;
    }

    if (normalizedApiUser !== apiUser) setApiUser(normalizedApiUser);
    if (normalizedApiPassword !== apiPassword) setApiPassword(normalizedApiPassword);
    if (normalizedCompanyId !== companyId) setCompanyId(normalizedCompanyId);

    const cfg = {
      apiUser: normalizedApiUser,
      apiPassword: normalizedApiPassword,
      companyId: normalizedCompanyId,
      debugDirectoryMapping,
    };
    saveConfig(cfg);
    onNext(cfg);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">填写 TAPD API 凭据（在 TAPD 个人设置 → API 管理中获取，需使用 api_user / api_password，不是登录密码）。</p>
      <div>
        <label className="block text-xs text-gray-400 mb-1">API User</label>
        <input className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary text-white placeholder-gray-500" value={apiUser} onChange={e => setApiUser(e.target.value)} placeholder="api_user" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">API Password</label>
        <input className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary text-white placeholder-gray-500" type="password" value={apiPassword} onChange={e => setApiPassword(e.target.value)} placeholder="api_password" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Company ID（企业 ID）</label>
        <input className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary text-white placeholder-gray-500" value={companyId} onChange={e => setCompanyId(e.target.value)} placeholder="如 20003261" />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
        <input
          type="checkbox"
          checked={debugDirectoryMapping}
          onChange={(e) => setDebugDirectoryMapping(e.target.checked)}
          className="accent-blue-500"
        />
        开启目录字段调试（导入时在控制台打印目录候选字段）
      </label>
      {msg && <p className={`text-sm ${msgType === 'success' ? 'text-green-400' : 'text-red-400'}`}>{msg}</p>}
      <div className="flex gap-3 pt-2">
        <button className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg font-medium transition-colors" onClick={handleTest} disabled={testing}>
          {testing ? '测试中...' : '测试连接'}
        </button>
        <button className="flex-1 px-4 py-2 bg-primary hover:bg-blue-600 rounded-lg font-medium transition-colors" onClick={handleNext}>
          下一步 →
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Select Project ───────────────────────────────────────────────────
function Step2Project({ cfg, onNext, onBack }) {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [projectIdInput, setProjectIdInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProjects(cfg.companyId, cfg.apiUser, cfg.apiPassword)
      .then(setProjects)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [cfg]);

  const handlePickById = () => {
    const workspaceId = projectIdInput.trim();
    if (!workspaceId) {
      return;
    }

    const matched = projects.find((p) => String(p.workspaceId) === workspaceId);
    if (matched) {
      setSelected(matched);
      return;
    }

    setSelected({
      workspaceId,
      workspaceName: `项目 ${workspaceId}`,
      status: 'normal',
      category: 'project',
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">选择要导入用例的项目（共 {projects.length} 个）。</p>
      <div className="bg-darker border border-gray-700 rounded-lg p-3 space-y-2">
        <label className="block text-xs text-gray-400">项目ID（workspace_id）</label>
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary text-white placeholder-gray-500"
            value={projectIdInput}
            onChange={(e) => setProjectIdInput(e.target.value)}
            placeholder="如 61252348"
          />
          <button
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors text-sm whitespace-nowrap"
            onClick={handlePickById}
            disabled={!projectIdInput.trim()}
          >
            按ID选择
          </button>
        </div>
        <p className="text-xs text-gray-500">可直接输入项目ID快速跳转；也可在下方列表中选择。</p>
      </div>
      {loading && <p className="text-gray-400 text-sm">加载项目列表...</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {!loading && !error && (
        <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
          {projects.map(p => (
            <button
              key={p.workspaceId}
              onClick={() => setSelected(p)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors
                ${selected?.workspaceId === p.workspaceId
                  ? 'border-blue-500 bg-blue-900/30 text-blue-300'
                  : 'border-gray-700 hover:border-gray-500 text-gray-300'}`}
            >
              <span className="font-medium">{p.workspaceName}</span>
              <span className="text-gray-500 ml-2 text-xs">#{p.workspaceId}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-3 pt-2">
        <button className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors" onClick={onBack}>← 上一步</button>
        <button className="flex-1 px-4 py-2 bg-primary hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors" disabled={!selected} onClick={() => onNext(selected)}>
          下一步 →
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Select Test Plan ─────────────────────────────────────────────────
function Step3Plan({ cfg, project, onNext, onBack }) {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [selected, setSelected] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOpenTestPlans(project.workspaceId, cfg.apiUser, cfg.apiPassword)
      .then(setPlans)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [cfg, project]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        项目：<span className="text-white font-medium">{project.workspaceName}</span> — 选择一个「开始」状态的测试计划。
      </p>
      {loading && <p className="text-gray-400 text-sm">加载测试计划...</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {!loading && !error && plans.length === 0 && <p className="text-yellow-400 text-sm">该项目下暂无「开始」状态的测试计划。</p>}
      {!loading && !error && plans.length > 0 && (
        <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
          {plans.map(p => (
            <button
              key={p.testPlanId}
              onClick={() => setSelected(p)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors
                ${selected?.testPlanId === p.testPlanId
                  ? 'border-blue-500 bg-blue-900/30 text-blue-300'
                  : 'border-gray-700 hover:border-gray-500 text-gray-300'}`}
            >
              <span className="font-medium">{p.testPlanName}</span>
              <span className="text-gray-500 ml-2 text-xs">负责人: {p.owner || '—'}</span>
            </button>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
        <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="accent-blue-500" />
        覆盖已存在的同名用例
      </label>
      <div className="flex gap-3 pt-2">
        <button className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors" onClick={onBack}>← 上一步</button>
        <button className="flex-1 px-4 py-2 bg-accent hover:bg-emerald-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors" disabled={!selected} onClick={() => onNext(selected, overwrite)}>
          开始导入
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Import Result ────────────────────────────────────────────────────
function Step4Result({ result, onClose }) {
  const { total, imported, skipped, errors } = result;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[['总用例', total, 'text-white'], ['成功导入', imported, 'text-green-400'], ['跳过', skipped, 'text-yellow-400']].map(([label, val, cls]) => (
          <div key={label} className="bg-darker rounded-lg p-3">
            <div className={`text-2xl font-bold ${cls}`}>{val}</div>
            <div className="text-xs text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {errors.length > 0 && (
        <div>
          <p className="text-xs text-yellow-400 mb-2">跳过的用例（未识别到 Human 内容）：</p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {errors.map((e, i) => (
              <div key={i} className="text-xs text-gray-400 bg-darker rounded px-2 py-1">
                <span className="text-gray-500">#{e.tapdCaseId}</span> {e.caseTitle}
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="w-full px-4 py-3 bg-primary hover:bg-blue-600 rounded-lg font-medium transition-colors" onClick={onClose}>完成</button>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────
export default function TapdImportWizard({ onClose }) {
  const { dispatch, state } = useTest();
  const [step, setStep] = useState(1);
  const [cfg, setCfg] = useState(null);
  const [project, setProject] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importProgress, setImportProgress] = useState('');
  const [importStage, setImportStage] = useState('');

  const handleConfig = useCallback((config) => {
    setCfg(config);
    setStep(2);
  }, []);

  const handleProject = useCallback((proj) => {
    setProject(proj);
    setStep(3);
  }, []);

  const handleImport = useCallback(async (plan, overwrite) => {
    setImporting(true);
    setStep(4);

    const result = { total: 0, imported: 0, skipped: 0, errors: [] };
    let currentStage = '';

    try {
      currentStage = '获取用例清单';
      setImportStage(currentStage);
      setImportProgress('正在获取用例清单...');
      const planCases = await fetchPlanCases(project.workspaceId, plan.testPlanId, cfg.apiUser, cfg.apiPassword);
      const caseIds = planCases.map((item) => item.caseId);

      if (cfg?.debugDirectoryMapping) {
        console.group('[TAPD Directory Debug] relation payload diagnostics');
        console.info('总用例数:', planCases.length);
        planCases.slice(0, 30).forEach((item, index) => {
          console.log(`[#${index + 1}] caseId=${item.caseId}`, item.diagnostics || {});
        });
        console.groupEnd();
      }

      result.total = caseIds.length;

      currentStage = '获取用例详情';
      setImportStage(currentStage);
      setImportProgress(`共 ${caseIds.length} 条用例，正在获取详情...`);
      const cases = await fetchCaseDetails(project.workspaceId, caseIds, cfg.apiUser, cfg.apiPassword);

      // 已有用例文本 set（用于重复检测）
      const existingTexts = new Set(state.testAudios.map(a => a.text));
      const meta = {
        workspaceId: project.workspaceId,
        workspaceName: project.workspaceName,
        testPlanId: plan.testPlanId,
        testPlanName: plan.testPlanName,
      };

      currentStage = '解析并导入';
      setImportStage(currentStage);
      setImportProgress('正在解析并导入...');
      for (const tapdCase of cases) {
        const rows = tapdCaseToTestAudios(tapdCase, meta, state.defaultVoiceConfig, generateId);
        for (const row of rows) {
          if (row.skipped) {
            result.skipped++;
            result.errors.push({ tapdCaseId: row.tapdCaseId, caseTitle: row.caseTitle });
            continue;
          }
          if (!overwrite && existingTexts.has(row.audio.text)) {
            result.skipped++;
            continue;
          }
          dispatch(actions.addTestAudio(row.audio));
          existingTexts.add(row.audio.text);
          result.imported++;
        }
      }

      if (cfg?.debugDirectoryMapping) {
        console.group('[TAPD Directory Debug] category mapping result');
        cases.slice(0, 30).forEach((item, index) => {
          console.log(
            `[#${index + 1}] caseId=${item.id}; category_id=${item.categoryId}; categoryName=${item.categoryName || '(empty)'}; categoryPath=${item.categoryPath || '(empty)'}`,
            item
          );
        });
        console.groupEnd();
      }
    } catch (err) {
      const stage = currentStage ? `（阶段：${currentStage}）` : '';
      setImportProgress(`导入失败${stage}: ${err.message}`);
    } finally {
      setImporting(false);
      setImportStage('');
      setImportProgress('');
      setImportResult(result);
    }
  }, [cfg, project, state.testAudios, state.defaultVoiceConfig, dispatch]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-dark border border-gray-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <span>📋</span> TAPD 接口导入
          </h3>
          <button className="text-gray-500 hover:text-gray-300 text-xl leading-none" onClick={onClose}>×</button>
        </div>

        <StepBar step={step} />

        {step === 1 && <Step1Config onNext={handleConfig} />}
        {step === 2 && <Step2Project cfg={cfg} onNext={handleProject} onBack={() => setStep(1)} />}
        {step === 3 && <Step3Plan cfg={cfg} project={project} onNext={handleImport} onBack={() => setStep(2)} />}
        {step === 4 && (
          importing
            ? <div className="text-center py-8 text-gray-400">
                <div className="animate-spin text-3xl mb-3">⏳</div>
                <p className="text-sm">{importProgress || '导入中，请稍候...'}</p>
              </div>
            : importResult && <Step4Result result={importResult} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
