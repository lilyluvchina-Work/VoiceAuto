# 2026-07-24 开发内容补充说明

## 文档定位

- 用途：记录 2026-07-23 至 2026-07-24 落地的登录、配置中心、数据库持久化、TAPD/Langfuse/钉钉参数来源调整。
- 面向对象：开发、测试、部署维护人员。
- 注意：本文不记录完整密钥、Token、Secret；真实参数以配置中心和数据库为准。

## 一、后端能力

### 1. 登录与账号

已新增 Node 后端服务，负责静态资源托管和 API。

| 接口 | 说明 |
|---|---|
| `POST /api/auth/login` | 登录 |
| `GET /api/auth/profile` | 查询当前登录用户 |
| `POST /api/auth/logout` | 退出 |
| `POST /api/users` | 新增账号 |

登录成功后写入 HttpOnly Cookie：`voiceauto_session`。

### 2. 配置 API

配置中心读写已迁移到 PostgreSQL。

| 接口 | 说明 |
|---|---|
| `GET /api/configs` | 查询全部配置 |
| `GET /api/configs/:type` | 查询单类配置 |
| `PUT /api/configs/:type` | 保存单类配置 |

配置类型：

- `tapd`
- `langfuse`
- `dingtalk`
- `doubaoTts`
- `server`

### 3. 数据表

新增 `app_config` 表，应用访问配置接口时自动创建。

```sql
CREATE TABLE IF NOT EXISTS app_config (
  config_type TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);
```

## 二、配置中心

### 1. 数据保存位置

配置中心数据保存到 PostgreSQL，不再以浏览器 `localStorage` 作为持久化来源。

前端流程：

```text
用户登录
  ↓
调用 /api/configs 预加载数据库配置
  ↓
写入前端运行时配置缓存
  ↓
TAPD / Langfuse / 钉钉运行逻辑读取缓存
```

### 2. 默认配置

默认配置文件：

```text
src/config/sensitiveDefaults.js
```

默认配置入库脚本：

```text
scripts/seedDefaultConfigs.js
```

容器内执行：

```bash
docker exec voiceauto-web-api-test node scripts/seedDefaultConfigs.js
```

## 三、TAPD 参数来源

TAPD 导入向导读取配置中心保存的 TAPD 配置。

| 页面字段 | 配置字段 |
|---|---|
| API User | `apiUser` |
| API Password | `apiPassword` |
| Company ID | `companyId` |
| 项目ID | `workspaceId` |

调整后行为：

- 导入向导第一步只读展示配置。
- 不再读取旧的 `voiceauto_tapd_config_v1`。
- 不在导入窗口临时维护参数。
- 项目 ID 由配置中心控制。
- 项目列表仅用于核对项目名称。

## 四、Langfuse 参数来源

Langfuse 多环境参数读取配置中心保存的环境列表。

每个环境包含：

- `envKey`
- `label`
- `proxyBase`
- `baseUrl`
- `publicKey`
- `secretKey`
- `enabled`

调整后行为：

- 语音测试页“日志环境”下拉从启用环境列表生成。
- Langfuse 日志页环境按钮从启用环境列表生成。
- 默认环境取配置列表中的第一个启用环境。
- 未知环境 Key 使用默认样式兜底，避免页面崩溃。
- 配置中心保存 Langfuse 参数后立即刷新运行时环境映射。

## 五、钉钉参数来源

钉钉通知从配置中心读取：

- `webhook`
- `secret`
- `proxyPath`
- `enabled`

通知服务不再以 `VITE_DINGTALK_*` 作为主要配置来源。

## 六、部署变化

Docker 运行镜像从纯 Nginx 静态服务调整为 Node 后端服务，原因是需要提供登录、账号和配置 API。

运行镜像包含：

- `dist/`
- `server/`
- `scripts/`
- `src/config/`

容器启动命令：

```bash
node server/index.js
```

## 七、验证项

已新增或更新测试：

- `tests/backendAuth.test.mjs`
- `tests/backendConfig.test.mjs`
- `tests/configApi.test.mjs`
- `tests/secureConfigStore.test.mjs`
- `tests/defaultSensitiveConfig.test.mjs`
- `tests/configParameterDisplay.test.mjs`
- `tests/langfuseEnvironmentRefresh.test.mjs`
- `tests/langfuseEnvStyles.test.mjs`
- `tests/stateSanitizer.test.mjs`

部署后建议验证：

1. 登录成功。
2. 配置中心可读取数据库配置。
3. TAPD 导入向导展示配置中心参数。
4. 语音测试页日志环境来自 Langfuse 配置。
5. Langfuse 日志页环境按钮来自 Langfuse 配置。
6. 钉钉通知可读取配置中心参数。
7. `/api/configs/tapd` 和 `/api/configs/langfuse` 返回已配置数据。
