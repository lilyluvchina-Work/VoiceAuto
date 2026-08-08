import React, { useEffect, useMemo, useState } from 'react';
import {
  CONFIG_SCHEMAS,
  CONFIG_TYPES,
  getOperationLogs,
  maskSensitiveValue,
  readConfig,
} from '../modules/config/secureConfigStore';
import { loadDatabaseConfig, saveDatabaseConfig } from '../modules/config/configApi';
import {
  buildDingTalkParameterRows,
  buildTapdParameterRows,
} from '../modules/config/parameterDisplay';
import { getLoginLogs, hasPermission, PERMISSIONS } from '../modules/config/authStore';
import { createUserAccount } from '../modules/config/userApi';
import { refreshLangfuseEnvironments } from '../modules/langfuse/services/langfuseService';
import { useAuth } from './AuthGate';
import {
  getToolUsageRecords,
  summarizeToolUsageByUser,
  TOOL_USAGE_UPDATED_EVENT,
} from '../utils/toolUsageStore';

const FIELD_LABELS = {
  configName: '配置名称',
  envKey: '环境 Key',
  label: '环境名称',
  proxyBase: '代理路径',
  baseUrl: 'Base URL',
  host: 'Host',
  publicKey: 'Public Key',
  secretKey: 'Secret Key',
  projectId: 'Project ID',
  workspaceId: 'Workspace ID',
  companyId: 'Company ID',
  tapdProjectId: 'TAPD Project ID',
  apiUser: 'API User',
  apiPassword: 'API Password',
  defaultTestPlanId: '默认测试计划 ID',
  timeout: '超时时间(ms)',
  webhook: 'Webhook',
  accessToken: 'Access Token',
  apiKey: 'API Key',
  apiKeyId: 'APP ID',
  apiKeySecret: 'Access Token',
  model: '模型',
  temperature: '温度',
  maxCompletionTokens: '最大输出 Tokens',
  secret: 'Secret',
  proxyPath: '代理路径',
  groupName: '群名称',
  provider: '服务厂商',
  url: '服务地址',
  appId: 'App ID',
  cluster: 'Cluster',
  defaultVoiceType: '默认音色',
  resourceId: 'Resource ID',
  uid: 'UID',
  type: '类型',
  port: '端口',
  databaseName: '数据库名',
  username: '账号',
  password: '密码',
  poolSize: '连接池',
  sslConfig: 'SSL 配置',
  backupStrategy: '备份策略',
  retentionDays: '保留周期(天)',
  serverName: '服务器名称',
  os: '操作系统',
  servicePort: '服务端口',
  deployPath: '部署路径',
  sshPort: 'SSH 端口',
  sshUser: 'SSH 账号',
  sshPassword: 'SSH 密码',
  sshPrivateKey: 'SSH 私钥',
  logPath: '日志路径',
  storagePath: '文件存储路径',
  adbPath: 'ADB 路径',
  adbDeviceId: 'ADB 设备',
  chromePath: 'Chrome 路径',
  startCommand: '启动命令',
  serviceStatus: '服务状态',
  enabled: '启用',
  debugDirectoryMapping: '目录调试',
};

const CONFIG_TABS = [
  CONFIG_TYPES.LANGFUSE,
  CONFIG_TYPES.TAPD,
  CONFIG_TYPES.DINGTALK,
  CONFIG_TYPES.DOUBAO_TTS,
  CONFIG_TYPES.MINIMAX,
  CONFIG_TYPES.SERVER,
];
const USER_MANAGEMENT_TAB = 'userManagement';

const FIELD_ORDER = {
  [CONFIG_TYPES.LANGFUSE]: ['envKey', 'label', 'baseUrl', 'proxyBase', 'publicKey', 'secretKey', 'projectId', 'defaultTimeRange', 'maxLimit', 'timeout', 'enabled'],
  [CONFIG_TYPES.TAPD]: ['configName', 'baseUrl', 'workspaceId', 'companyId', 'tapdProjectId', 'apiUser', 'apiPassword', 'defaultTestPlanId', 'timeout', 'debugDirectoryMapping', 'enabled'],
  [CONFIG_TYPES.DINGTALK]: ['groupName', 'proxyPath', 'webhook', 'accessToken', 'secret', 'enabled'],
  [CONFIG_TYPES.DOUBAO_TTS]: ['apiKeyId', 'apiKeySecret', 'secretKey', 'resourceId'],
  [CONFIG_TYPES.MINIMAX]: ['configName', 'baseUrl', 'apiKey', 'model', 'temperature', 'maxCompletionTokens', 'timeout', 'enabled'],
  [CONFIG_TYPES.DATABASE]: ['type', 'host', 'port', 'databaseName', 'username', 'password', 'poolSize', 'sslConfig', 'backupStrategy', 'retentionDays', 'enabled'],
  [CONFIG_TYPES.SERVER]: ['serverName', 'host', 'os', 'servicePort', 'deployPath', 'sshPort', 'sshUser', 'sshPassword', 'sshPrivateKey', 'logPath', 'storagePath', 'adbPath', 'adbDeviceId', 'chromePath', 'startCommand', 'serviceStatus', 'enabled'],
};

function buildEditableFormFields(type, config) {
  const sensitive = new Set(CONFIG_SCHEMAS[type].sensitive);
  const editableFields = new Set(FIELD_ORDER[type] || Object.keys(config));
  return Object.entries(config).reduce((acc, [key, value]) => {
    if (!editableFields.has(key)) return acc;
    acc[key] = sensitive.has(key) ? maskSensitiveValue(value) : value;
    return acc;
  }, {});
}

function isUnchangedSensitiveDisplay(value, storedValue) {
  const displayValue = String(value ?? '').trim();
  const plainValue = String(storedValue ?? '').trim();
  if (!displayValue || !plainValue) return false;
  return displayValue === plainValue || displayValue === maskSensitiveValue(plainValue);
}

function buildConfigSubmitPayload(type, form, storedConfig) {
  const sensitive = new Set(CONFIG_SCHEMAS[type].sensitive);
  return Object.entries(form).reduce((payload, [field, value]) => {
    payload[field] = sensitive.has(field) && isUnchangedSensitiveDisplay(value, storedConfig[field])
      ? ''
      : value;
    return payload;
  }, {});
}

function ConfigSaveMessage({ type, message }) {
  if (!message) return null;
  const isSuccess = type === 'success';
  return (
    <div
      role="status"
      className={`rounded-lg border px-3 py-2 text-sm ${
        isSuccess
          ? 'border-emerald-700/70 bg-emerald-950/35 text-emerald-200'
          : 'border-red-800/70 bg-red-950/35 text-red-200'
      }`}
    >
      {message}
    </div>
  );
}

function ParameterLine({ label, value, onChange, disabled }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3 text-sm md:text-base leading-7">
      <span className="text-gray-400 text-right">{label}：</span>
      <input
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:text-gray-500"
      />
    </div>
  );
}

function ParameterPreview({
  type,
  config,
  onDingTalkParameterChange,
  onTapdParameterChange,
  onLangfuseParameterChange,
  onLangfuseEnvironmentLabelChange,
  onLangfuseEnvironmentRemove,
  canManage,
}) {
  if (type === CONFIG_TYPES.TAPD) {
    const tapdFieldMap = {
      应用ID: 'apiUser',
      应用密钥: 'apiPassword',
      项目ID: 'workspaceId',
      公司ID: 'companyId',
    };
    return (
      <section className="rounded-lg border border-gray-700 bg-gray-950 px-5 py-4">
        <h4 className="text-base font-semibold text-white mb-4">TAPD参数：</h4>
        <div className="max-w-2xl space-y-2">
          {buildTapdParameterRows(config).map((row) => (
            <ParameterLine
              key={row.label}
              label={row.label}
              value={row.value}
              onChange={(value) => onTapdParameterChange?.(tapdFieldMap[row.label], value)}
              disabled={!canManage}
            />
          ))}
        </div>
      </section>
    );
  }

  if (type === CONFIG_TYPES.DINGTALK) {
    return (
      <section className="rounded-lg border border-gray-700 bg-gray-950 px-5 py-4">
        <h4 className="text-base font-semibold text-white mb-4">钉钉群消息参数：</h4>
        <div className="max-w-3xl space-y-3">
          {buildDingTalkParameterRows(config).map((row) => (
            <ParameterLine
              key={row.field}
              label={row.label}
              value={row.value}
              onChange={(value) => onDingTalkParameterChange?.(row.field, value)}
              disabled={!canManage}
            />
          ))}
        </div>
      </section>
    );
  }

  if (type === CONFIG_TYPES.LANGFUSE) {
    const environments = Array.isArray(config) ? config : [config];
    return (
      <section className="rounded-lg border border-gray-700 bg-gray-950 px-5 py-4">
        <h4 className="text-base font-semibold text-white mb-4">Langfuse参数：</h4>
        <p className="text-sm md:text-base text-gray-200 mb-4 pl-8">可自行在langfuse创建信息</p>
        <div className="space-y-6">
          {environments.map((environment, index) => (
            <div key={environment._uiId || `${environment.envKey || 'langfuse'}-${index}`} className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <input
                  value={environment.label || ''}
                  onChange={(event) => onLangfuseEnvironmentLabelChange?.(index, event.target.value)}
                  disabled={!canManage}
                  className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm md:text-base font-medium text-gray-100 outline-none focus:border-gray-600 focus:bg-gray-950 disabled:text-gray-500"
                />
                <button
                  type="button"
                  onClick={() => onLangfuseEnvironmentRemove?.(index)}
                  disabled={!canManage || environments.length <= 1}
                  className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-1.5 text-xs text-red-200 hover:border-red-500 hover:text-red-100 disabled:border-gray-800 disabled:bg-gray-900 disabled:text-gray-600"
                >
                  删除环境
                </button>
              </div>
              <div className="max-w-3xl space-y-3">
                <ParameterLine
                  label="Secret Key"
                  value={environment.secretKey}
                  onChange={(value) => onLangfuseParameterChange?.(index, 'secretKey', value)}
                  disabled={!canManage}
                />
                <ParameterLine
                  label="Public Key"
                  value={environment.publicKey}
                  onChange={(value) => onLangfuseParameterChange?.(index, 'publicKey', value)}
                  disabled={!canManage}
                />
                <ParameterLine
                  label="Base URL"
                  value={environment.baseUrl}
                  onChange={(value) => onLangfuseParameterChange?.(index, 'baseUrl', value)}
                  disabled={!canManage}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return null;
}

function emptyLangfuseEnvironment(index) {
  return {
    _uiId: `langfuse-env-${Date.now()}-${index}`,
    envKey: `ENV_${index + 1}`,
    label: `环境 ${index + 1}`,
    baseUrl: '',
    proxyBase: '',
    publicKey: '',
    secretKey: '',
    projectId: '',
    enabled: true,
  };
}

function buildLangfuseEditableForm(config) {
  const environments = config.environments?.length
    ? config.environments
    : [config];
  return {
    ...config,
    environments: environments.map((environment, index) => ({
      ...emptyLangfuseEnvironment(index),
      ...environment,
      _uiId: environment._uiId || `${environment.envKey || environment.label || 'langfuse-env'}-${index}`,
      publicKey: maskSensitiveValue(environment.publicKey),
      secretKey: maskSensitiveValue(environment.secretKey),
      projectId: maskSensitiveValue(environment.projectId),
    })),
  };
}

function buildLangfusePreviewEnvironments(storedConfig, form) {
  const storedEnvironments = storedConfig.environments?.length ? storedConfig.environments : [storedConfig];
  return (form.environments || []).map((environment, index) => {
    const stored = storedEnvironments.find((item) => item.envKey === environment.envKey) || storedEnvironments[index] || {};
    return {
      ...stored,
      ...environment,
      text: environment.parameterTextDraft,
    };
  });
}

function buildLangfuseSubmitPayload(form, storedConfig) {
  const storedEnvironments = storedConfig.environments?.length ? storedConfig.environments : [storedConfig];
  return {
    ...form,
    environments: (form.environments || []).map((environment, index) => {
      const stored = storedEnvironments.find((item) => item.envKey === environment.envKey)
        || storedEnvironments[index]
        || {};
      return {
        ...environment,
        publicKey: isUnchangedSensitiveDisplay(environment.publicKey, stored.publicKey) ? '' : environment.publicKey,
        secretKey: isUnchangedSensitiveDisplay(environment.secretKey, stored.secretKey) ? '' : environment.secretKey,
        projectId: isUnchangedSensitiveDisplay(environment.projectId, stored.projectId) ? '' : environment.projectId,
      };
    }),
  };
}

function LangfuseConfigForm({ onSaved, canManage }) {
  const [storedConfig, setStoredConfig] = useState(() => readConfig(CONFIG_TYPES.LANGFUSE));
  const [form, setForm] = useState(() => buildLangfuseEditableForm(storedConfig));
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [loading, setLoading] = useState(true);
  const previewEnvironments = buildLangfusePreviewEnvironments(storedConfig, form);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadDatabaseConfig(CONFIG_TYPES.LANGFUSE)
      .then((config) => {
        if (!mounted) return;
        setStoredConfig(config);
        setForm(buildLangfuseEditableForm(config));
      })
      .catch((error) => {
        if (mounted) {
          setMessageType('error');
          setMessage(error.message || '配置加载失败');
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleEnvironmentChange = (index, field, value) => {
    setForm((current) => ({
      ...current,
      environments: current.environments.map((environment, itemIndex) => (
        itemIndex === index ? { ...environment, [field]: value, parameterTextDraft: '' } : environment
      )),
    }));
  };

  const addEnvironment = () => {
    setForm((current) => ({
      ...current,
      environments: [
        ...current.environments,
        emptyLangfuseEnvironment(current.environments.length),
      ],
    }));
  };

  const removeEnvironment = (index) => {
    setForm((current) => ({
      ...current,
      environments: current.environments.length <= 1
        ? current.environments
        : current.environments.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canManage) {
      setMessageType('error');
      setMessage('当前账号无配置修改权限');
      return;
    }
    setMessage('');
    setMessageType('');
    try {
      const saved = await saveDatabaseConfig(CONFIG_TYPES.LANGFUSE, buildLangfuseSubmitPayload(form, storedConfig));
      setStoredConfig(saved);
      setForm(buildLangfuseEditableForm(saved));
      refreshLangfuseEnvironments();
      setMessageType('success');
      setMessage('保存成功，配置已写入数据库');
      onSaved();
    } catch (error) {
      setMessageType('error');
      setMessage(error.message || '配置保存失败');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-700 bg-dark p-5 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-white">Langfuse 配置</h3>
          <p className="text-xs text-gray-500 mt-1">版本 {storedConfig.version || 0}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 hover:border-gray-500 disabled:text-gray-500 text-sm font-medium text-gray-200"
            type="button"
            onClick={addEnvironment}
            disabled={!canManage}
          >
            + 新增环境
          </button>
          <button
            className="px-4 py-2 rounded-lg bg-primary hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-sm font-medium text-white"
            type="submit"
            disabled={!canManage}
          >
            保存配置
          </button>
        </div>
      </div>

      <ParameterPreview
        type={CONFIG_TYPES.LANGFUSE}
        config={previewEnvironments}
        onLangfuseParameterChange={handleEnvironmentChange}
        onLangfuseEnvironmentLabelChange={(index, value) => handleEnvironmentChange(index, 'label', value)}
        onLangfuseEnvironmentRemove={removeEnvironment}
        canManage={canManage}
      />

      {loading && <p className="text-sm text-gray-400">正在从数据库加载配置...</p>}
      <ConfigSaveMessage type={messageType} message={message} />
    </form>
  );
}

function ConfigForm({ type, onSaved, canManage }) {
  if (type === CONFIG_TYPES.LANGFUSE) {
    return <LangfuseConfigForm onSaved={onSaved} canManage={canManage} />;
  }

  const schema = CONFIG_SCHEMAS[type];
  const [storedConfig, setStoredConfig] = useState(() => readConfig(type));
  const [form, setForm] = useState(() => buildEditableFormFields(type, storedConfig));
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [loading, setLoading] = useState(true);
  const sensitiveFields = new Set(schema.sensitive);
  const requiredFields = new Set(schema.required);
  const previewConfig = {
    ...storedConfig,
    ...Object.fromEntries(Object.entries(form).filter(([field, value]) => !sensitiveFields.has(field) || String(value ?? '').trim())),
  };

  const handleChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadDatabaseConfig(type)
      .then((config) => {
        if (!mounted) return;
        setStoredConfig(config);
        setForm(buildEditableFormFields(type, config));
      })
      .catch((error) => {
        if (mounted) {
          setMessageType('error');
          setMessage(error.message || '配置加载失败');
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [type]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canManage) {
      setMessageType('error');
      setMessage('当前账号无配置修改权限');
      return;
    }
    setMessage('');
    setMessageType('');
    try {
      const saved = await saveDatabaseConfig(type, buildConfigSubmitPayload(type, form, storedConfig));
      setStoredConfig(saved);
      setForm(buildEditableFormFields(type, saved));
      setMessageType('success');
      setMessage('保存成功，配置已写入数据库');
      onSaved();
    } catch (error) {
      setMessageType('error');
      setMessage(error.message || '配置保存失败');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-700 bg-dark p-5 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{schema.label}</h3>
          <p className="text-xs text-gray-500 mt-1">版本 {readConfig(type).version || 0}</p>
        </div>
        <button
          className="px-4 py-2 rounded-lg bg-primary hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-sm font-medium text-white"
          type="submit"
          disabled={!canManage}
        >
          保存配置
        </button>
      </div>

      <ParameterPreview
        type={type}
        config={previewConfig}
        onDingTalkParameterChange={handleChange}
        onTapdParameterChange={handleChange}
        canManage={canManage}
      />

      {loading && <p className="text-sm text-gray-400">正在从数据库加载配置...</p>}
      {![CONFIG_TYPES.TAPD, CONFIG_TYPES.DINGTALK].includes(type) && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(FIELD_ORDER[type] || []).map((field) => {
          if (field === 'enabled' || field === 'debugDirectoryMapping') {
            return (
              <label key={field} className="flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-900 px-3 py-3 text-sm text-gray-300">
                <input
                  type="checkbox"
                  className="accent-blue-500"
                  checked={Boolean(form[field])}
                onChange={(event) => handleChange(field, event.target.checked)}
                  disabled={!canManage}
                />
                <span>{FIELD_LABELS[field] || field}</span>
              </label>
            );
          }

          return (
            <label key={field} className="space-y-1.5">
              <span className="text-xs text-gray-400">
                {FIELD_LABELS[field] || field}
                {requiredFields.has(field) && <span className="text-red-300 ml-1">*</span>}
                {sensitiveFields.has(field) && <span className="text-yellow-300 ml-1">敏感</span>}
              </span>
              <input
                value={form[field] ?? ''}
                type="text"
                onChange={(event) => handleChange(field, event.target.value)}
                disabled={!canManage}
                placeholder={sensitiveFields.has(field) && readConfig(type).hasSecrets ? '输入新值后保存' : ''}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </label>
          );
        })}
      </div>
      )}

      <ConfigSaveMessage type={messageType} message={message} />
    </form>
  );
}

function OperationLogPanel({ refreshKey }) {
  const logs = useMemo(() => getOperationLogs().slice().reverse(), [refreshKey]);
  const loginLogs = useMemo(() => getLoginLogs().slice().reverse(), [refreshKey]);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-lg border border-gray-700 bg-dark p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">配置变更记录</h3>
        <div className="max-h-56 overflow-y-auto space-y-2">
          {logs.length === 0 && <p className="text-xs text-gray-500">暂无记录</p>}
          {logs.map((log) => (
            <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-900 px-3 py-2 text-xs">
              <span className="text-gray-300">{log.summary}</span>
              <span className="text-gray-500">{new Date(log.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-gray-700 bg-dark p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">登录记录</h3>
        <div className="max-h-56 overflow-y-auto space-y-2">
          {loginLogs.length === 0 && <p className="text-xs text-gray-500">暂无记录</p>}
          {loginLogs.map((log) => (
            <div key={log.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-900 px-3 py-2 text-xs">
              <span className={log.loginResult === '成功' ? 'text-emerald-300' : 'text-red-300'}>
                {log.loginAccount} · {log.loginResult}
              </span>
              <span className="text-gray-500">{new Date(log.loginTime).toLocaleString('zh-CN', { hour12: false })}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolUsagePanel({ refreshKey }) {
  const records = useMemo(() => getToolUsageRecords(), [refreshKey]);
  const summaryRows = useMemo(() => summarizeToolUsageByUser(records), [records]);
  const recentRecords = records.slice(0, 8);

  return (
    <section className="rounded-lg border border-gray-700 bg-dark p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">工具使用时长</h3>
          <p className="text-xs text-gray-500 mt-1">按登录用户统计测试开始到测试结束的使用时长</p>
        </div>
        <span className="text-xs text-gray-500">共 {records.length} 次测试记录</span>
      </div>

      {summaryRows.length === 0 ? (
        <p className="text-xs text-gray-500">暂无工具使用记录</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-xs">
            <thead className="bg-gray-950/70 text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">用户</th>
                <th className="px-3 py-2 text-left font-medium">登录账号</th>
                <th className="px-3 py-2 text-right font-medium">测试次数</th>
                <th className="px-3 py-2 text-right font-medium">累计使用时长</th>
                <th className="px-3 py-2 text-left font-medium">最近开始时间</th>
                <th className="px-3 py-2 text-left font-medium">最近结束时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {summaryRows.map((item) => (
                <tr key={item.loginAccount} className="hover:bg-gray-900/60">
                  <td className="px-3 py-2 text-gray-200">{item.userName}</td>
                  <td className="px-3 py-2 text-gray-300">{item.loginAccount}</td>
                  <td className="px-3 py-2 text-right text-gray-300">{item.runCount}</td>
                  <td className="px-3 py-2 text-right text-emerald-300 font-semibold">{item.totalDurationText}</td>
                  <td className="px-3 py-2 text-gray-400">{item.lastStartTimeText}</td>
                  <td className="px-3 py-2 text-gray-400">{item.lastEndTimeText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentRecords.length > 0 && (
        <div className="border-t border-gray-800 pt-4">
          <h4 className="text-xs font-semibold text-gray-300 mb-2">最近记录</h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {recentRecords.map((record) => (
              <div key={record.id} className="rounded-lg bg-gray-900 px-3 py-2 text-xs flex items-center justify-between gap-3">
                <span className="text-gray-300">
                  {record.userName} · {record.loginAccount}
                </span>
                <span className="text-gray-500">
                  {record.startTimeText} - {record.durationText}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function UserManagementPanel({ canManageUsers }) {
  const [form, setForm] = useState({
    username: '',
    loginAccount: '',
    password: '',
    role: 'test_lead',
    status: 'enabled',
  });
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canManageUsers) {
      setMessageType('error');
      setMessage('当前账号无新增账号权限');
      return;
    }
    setSaving(true);
    setMessage('');
    setMessageType('');
    const result = await createUserAccount(form);
    setSaving(false);
    if (!result.success) {
      setMessageType('error');
      setMessage(result.message || '新增账号失败');
      return;
    }
    setMessageType('success');
    setMessage(`账号 ${result.user.loginAccount} 已创建`);
    setForm({
      username: '',
      loginAccount: '',
      password: '',
      role: 'test_lead',
      status: 'enabled',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-700 bg-dark p-5 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">账号管理</h3>
          <p className="text-xs text-gray-500 mt-1">新增账号后可直接使用后端登录接口登录</p>
        </div>
        <button
          className="px-4 py-2 rounded-lg bg-primary hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-sm font-medium text-white"
          type="submit"
          disabled={!canManageUsers || saving}
        >
          {saving ? '保存中...' : '新增账号'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="space-y-1.5">
          <span className="text-xs text-gray-400">用户名</span>
          <input
            value={form.username}
            onChange={(event) => handleChange('username', event.target.value)}
            disabled={!canManageUsers || saving}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs text-gray-400">登录账号</span>
          <input
            value={form.loginAccount}
            onChange={(event) => handleChange('loginAccount', event.target.value)}
            disabled={!canManageUsers || saving}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs text-gray-400">初始密码</span>
          <input
            value={form.password}
            type="password"
            onChange={(event) => handleChange('password', event.target.value)}
            disabled={!canManageUsers || saving}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs text-gray-400">角色</span>
          <select
            value={form.role}
            onChange={(event) => handleChange('role', event.target.value)}
            disabled={!canManageUsers || saving}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <option value="test_lead">测试负责人</option>
            <option value="admin">管理员</option>
          </select>
        </label>
      </div>

      {message && (
        <p className={`text-sm ${messageType === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>
          {message}
        </p>
      )}
    </form>
  );
}

export default function ConfigCenter() {
  const auth = useAuth();
  const [activeType, setActiveType] = useState(CONFIG_TYPES.LANGFUSE);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((value) => value + 1);
  const canManage = hasPermission(auth?.currentUser, PERMISSIONS.CONFIG_MANAGE);
  const canManageUsers = hasPermission(auth?.currentUser, PERMISSIONS.USER_MANAGE);

  useEffect(() => {
    const onToolUsageUpdated = () => refresh();
    window.addEventListener(TOOL_USAGE_UPDATED_EVENT, onToolUsageUpdated);
    return () => window.removeEventListener(TOOL_USAGE_UPDATED_EVENT, onToolUsageUpdated);
  }, []);

  useEffect(() => {
    const onOpenConfigType = (event) => {
      const requestedType = event?.detail?.type;
      if (CONFIG_SCHEMAS[requestedType]) setActiveType(requestedType);
    };
    window.addEventListener('voiceauto:open-config-type', onOpenConfigType);
    return () => window.removeEventListener('voiceauto:open-config-type', onOpenConfigType);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-white">配置中心</h2>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CONFIG_TABS.map((type) => (
          <button
            key={type}
            onClick={() => setActiveType(type)}
            className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
              activeType === type
                ? 'bg-primary border-primary text-white'
                : 'bg-dark border-gray-700 text-gray-300 hover:border-gray-500'
            }`}
          >
            {CONFIG_SCHEMAS[type].label}
          </button>
        ))}
        <button
          onClick={() => setActiveType(USER_MANAGEMENT_TAB)}
          className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
            activeType === USER_MANAGEMENT_TAB
              ? 'bg-primary border-primary text-white'
              : 'bg-dark border-gray-700 text-gray-300 hover:border-gray-500'
          }`}
        >
          账号管理
        </button>
      </div>

      {activeType === USER_MANAGEMENT_TAB ? (
        <UserManagementPanel canManageUsers={canManageUsers} />
      ) : (
        <ConfigForm key={`${activeType}-${refreshKey}`} type={activeType} onSaved={refresh} canManage={canManage} />
      )}
      <ToolUsagePanel refreshKey={refreshKey} />
      <OperationLogPanel refreshKey={refreshKey} />
    </div>
  );
}
