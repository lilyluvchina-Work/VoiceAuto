# VoiceAuto 架构文档

## 2026-09-05 设备控制边界

- `useTestRunner.js` 路由设备：AI玩具进入 `src/runners/aiToyRunner.js`，Speaker 维持 ADB/录音编排。
- `scripts/aiToySession.cjs` 管理持久串口会话及锁；`POST /api/adb/ai-toy/session` 支持 open/read/arm/close，arm 区分 wake/turn。
- `scripts/aiToyReboot.cjs` 在复位前订阅日志，处理重新枚举和启动顺序确认；共用 `/api/adb/reboot-and-wait` 返回 `bootCompleted`。
- `src/utils/speakerRecovery.js` 保留当前用例身份、强制重新唤醒并限制恢复次数。Speaker 播报结束监听按最大等待时间运行，明确完播结果可释放录音保护。
- `dingTalkService.js` 统一模板；AI玩具新增事件异步发送，不阻塞设备控制。
- 重试计数、启动标记和现有限制见[设备流程说明](../product/device-test-workflows.md)。历史设计中的分阶段串口开关已由持续会话替代。


## 文档定位

- 目标读者：研发与架构维护人员。
- 内容范围：系统分层、运行链路、状态管理、容错策略、模块边界与演进方向。

## 1. 架构目标

- 运行组成：React 前端、Node 业务后端、数据库及连接设备的本地桥接服务。
- 高操作性：配置、导入、执行、报告在单页内完成。
- 可扩展性：语音引擎、导入方式、日志分析规则可扩展。
- 可恢复性：关键状态落盘 `localStorage`，刷新后可恢复。

## 2. 总体分层

系统采用四层架构：`视图层 -> 业务编排层 -> 服务层 -> 工具层`。

```mermaid
flowchart LR
  A[视图层 Components] --> B[业务编排层 Hooks + Store]
  B --> C[服务层 Services]
  B --> D[工具层 Utils]
  C --> E[外部能力: TAPD / Langfuse / TTS]
```

### 2.1 视图层（Components）

- 负责页面展示、交互输入、结果反馈。
- 关键组件：`AudioImporter`、`AudioList`、`PlaybackConsole`、`TestCaseManager`、`TapdImportWizard`、`LangfuseFetcher`、`SummaryReport`。

### 2.2 业务编排层（Hooks + Store）

- `React Context + useReducer` 统一状态管理。
- `useTestRunner`、`useAudioPlayer` 等 Hook 封装执行与播放行为。

### 2.3 服务层（Services）

- `ttsService`：统一语音合成入口（Doubao 优先，Web Speech 回退）。
- `tapdService`：TAPD 计划/用例/目录接口编排。
- `langfuseService`：多环境日志分页拉取，含网络瞬时错误重试。

### 2.4 工具层（Utils）

- 负责纯函数逻辑：文本解析、日志分析、报告生成、导出转换等。

## 3. 运行时主链路

```mermaid
flowchart TD
  U[用户] --> M{模式}

  M -->|语音控制| V1[配置唤醒词与语音参数]
  V1 --> V2[导入或选择测试用例]
  V2 --> V3[执行播放队列]
  V3 --> V4[生成测试过程记录]

  M -->|测试用例管理| C1[TAPD 导入向导]
  C1 --> C2[计划关联用例ID]
  C2 --> C3[查询 tcases + tcase_categories]
  C3 --> C4[生成 tapdPlanDirectory 并入库]

  M -->|Langfuse日志| L1[选择环境与时间范围]
  L1 --> L2[分页拉取 traces/observations]
  L2 --> L3[提取有效 trace/request 行]
  L3 --> L4[筛选并生成报告/导出]
```

## 4. TAPD 导入架构（目录映射）

为保证“用例目录”与 TAPD 页面一致，当前采用以下稳定链路：

1. `test_plans/get_test_plan_tcase`：获取 `tcase_id` 列表。
2. `tcases`：按 `id` 批量获取用例详情，读取 `category_id`。
3. `tcase_categories`：获取目录表（`id/name/parent_id/path`）。
4. 通过 `category_id -> category.id` 映射目录名称与路径。

导入落库字段：

- `tapdPlanDirectory`：目录文本（主字段）
- `categoryId`：目录 ID
- `categoryPath`：目录路径
- `module`：与 `tapdPlanDirectory` 保持一致

```mermaid
sequenceDiagram
  participant UI as TapdImportWizard
  participant S as tapdService
  participant API as TAPD API

  UI->>S: fetchPlanCases(workspaceId, testPlanId)
  S->>API: get_test_plan_tcase
  API-->>S: tcase_id[]
  UI->>S: fetchCaseDetails(caseIds)
  S->>API: tcases(id in ...)
  API-->>S: case + category_id
  S->>API: tcase_categories
  API-->>S: category tree
  S-->>UI: tapdPlanDirectory/categoryPath/module
```

## 5. 状态与持久化架构

核心状态：

- `wakeWord`、`defaultVoiceConfig`
- `testAudios`（含 TAPD 元数据）
- `testOptions`（循环次数、调试开关、自动拉取日志、Langfuse 环境、模块筛选）
- `playback`、`report`（含执行记录、自动拉取时间窗、Langfuse 环境）

持久化策略：

- `voiceauto_state`：测试配置与用例信息
- `voiceauto_log_records_v1`：日志记录归档
- `voiceauto_summary_report_v1`：最新总结报告

## 6. 容错与稳定性设计

- 语音容错：Doubao 失败自动回退 Web Speech。
- 播放容错：单条失败不阻断整轮执行。
- 存储容错：`localStorage` 超限时降级保存。
- TAPD 导入容错：分页拉取、批量去重、阶段化报错（清单/详情/导入）。
- Langfuse 拉取容错：支持暂停/继续/终止并保留中间态；网络瞬时错误按指数退避重试。
- 自动拉取容错：测试完成后延迟 2 分钟再拉取 Langfuse 日志，降低日志落库延迟导致的漏数。
- 报告口径容错：总结报告以本次执行记录反查音频，只统计实际执行音频。

## 7. 模块化目录与演进

目标结构（摘要）：

```text
src/
├── modules/      # langfuse/audio/test/log/config
├── components/   # 共享与页面组件
├── hooks/        # 通用行为
├── stores/       # 全局状态
├── services/     # 公共服务
└── utils/        # 通用工具
```

演进原则：

- 模块内保持 `services/utils/components` 分层。
- 跨模块调用优先通过模块 `index.js` 导出入口。
- 新能力优先落在对应模块，避免全局散落。

## 8. 部署资产架构

为支持重复部署与交接，部署文件统一纳入项目目录：

```text
deploy/
├── scripts/
│   ├── build_deploy_bundle.ps1
│   └── build_deploy_bundle.sh
├── nginx/
│   ├── voice-auto.server.conf.template
│   └── langfuse-proxy.conf.example
└── docker/
  ├── Dockerfile
  ├── nginx.default.conf
  └── docker-compose.yml
```

约束：

- 部署脚本与配置文件存放在项目内，便于版本管理与交接。
- 部署包输出目录必须在项目外，避免污染仓库与误提交产物。
