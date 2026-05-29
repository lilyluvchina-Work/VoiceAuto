# 功能优化记录（持续更新）

## 文档定位

- 用途：持续记录已完成的功能优化与体验改进。
- 维护方式：按日期追加，不按日期新建文件。
- 验证流程：统一遵循 `.claude/CLAUDE.md` 的“变更验证与运行”规则。

## 影响范围（近期）

- src/hooks/useTestRunner.js
- src/stores/testStore.jsx
- src/components/LangfuseFetcher.jsx
- src/components/PlaybackConsole.jsx
- src/App.jsx
- vite.config.js
- src/index.css
- src/components/TestReport.jsx
- src/components/LogAnalyzer.jsx
- src/utils/reportGenerator.js
- src/utils/logAnalysis.js
- src/utils/audioUtils.jsx
- src/utils/summaryReportBuilder.js
- src/components/SummaryReport.jsx
- src/components/AudioList.jsx
- src/components/TapdImportWizard.jsx
- src/modules/tapd/services/tapdService.js
- src/modules/tapd/utils/tapdParser.js
- src/modules/langfuse/utils/sessionExtractor.js
- deploy/nginx/langfuse-proxy.conf.example
- deploy/nginx/voice-auto.server.conf.template
- deploy/scripts/build_deploy_bundle.ps1
- deploy/scripts/build_deploy_bundle.sh
- deploy/docker/Dockerfile
- deploy/docker/nginx.default.conf
- deploy/docker/docker-compose.yml
- README.md
- docx/PRODUCT_ARCH.md
- docx/SERVER_DEPLOYMENT_GUIDE.md
- docx/README.md

## 优化记录

### 2026-05-29

1. 总结报告“功能模块统计”改为只读展示。
   - 将“功能模块统计”表格中的模块名、Agent 命中率、平均耗时、用例数从可编辑输入框调整为只读文本。
   - 将“Agent 总命中率”“整体平均耗时”从可编辑输入框调整为只读展示。
   - 页头提示文案同步更新为“功能统计区域为只读，其他内容可编辑并自动保存”。
2. 总结报告“基础信息”改为只读展示。
   - 将“导入的测试计划”“测试时间”“测试负责人”从可编辑输入框调整为只读文本。
   - 页头提示文案同步更新为“基础信息与功能统计区域为只读，其他内容可编辑并自动保存”。
3. Langfuse 日志提取新增 familyid/deviceid 筛选。
   - 在“数据预览”中新增 familyid 与 deviceid 双下拉筛选，并支持一键重置。
   - “日志提取”表格支持按筛选结果展示匹配数据并显示筛选命中数。
   - 启用筛选时，“生成报告”“下载日志提取 Excel”基于筛选结果生成，原始 Traces/Observations 下载保持不变。
4. 语音测试到 Langfuse 自动链路优化。
   - 播放控制台新增“日志环境”选择，测试结束后的自动拉取使用该环境。
   - 新增 `UAT-Local` Langfuse 环境与代理路由 `/langfuse-api-uat-local`。
   - 自动拉取由“测试完成立即跳转”调整为“停留语音测试页 2 分钟后跳转并拉取日志”，给服务端日志落库预留缓冲时间。
   - 自动拉取结束时间改为跳转触发时刻，避免使用最后一条音频播放时间导致日志窗口偏短。
5. 总结报告导出与参数维护增强。
   - 提测参数改为“模型配置 / 语音识别配置”分组展示，并支持导入 `.xlsx/.xls/.csv/.txt` 参数文件。
   - 报告正文升级为 Markdown 表格结构，支持手动刷新正文格式。
   - 总结报告新增 Markdown、HTML、Excel 三种导出；Excel 包含“汇报看板、报告概览、提测参数、功能模块统计、错误信息、重点数据、测试明细”等 Sheet。
   - 报告表格新增命中子 Agent、日志状态、错误信息等重点列，并突出实际输入、输出、Agent、结论和耗时。
6. 报告统计口径调整为“本次实际执行音频”。
   - 报告行、用例总数、执行数量、执行率均基于本次执行记录生成，不再把未生成/未执行的导入用例计入本次报告。
   - Agent 判定支持命中 Agent 或命中子 Agent 与目标 Agent 一致；存在日志错误时结论按不通过处理。
7. Langfuse 日志提取结构化增强。
   - 日志提取由按 Session 聚合调整为按有效 Trace/Request 生成行，减少同 Session 多轮交互混在一行的问题。
   - 实际输入优先从 `[ASR]: final`、`[input_text]` 与 Trace 输入中提取，输出优先从 `[full_answer]` / `[response_complete]` 提取。
   - 命中 Agent 优先级调整为 `[full_answer]`、`[response_complete]`、`[run_agent]`、`[generation_complete]`，并输出来源、置信度和候选 Agent。
   - 错误日志支持从 `[error]` observation 的 output/message/content 中提取，并可合并到同 Session 最近一次有效输入。
   - 增加重复行去重、机器态输入过滤、列顺序按有效数据优先展示。
8. 测试音频删除交互优化。
   - 删除 TAPD 导入生成的测试音频时，仅清空音频文件与播放状态，保留导入用例本身，避免误删测试计划用例。
   - 删除按钮文案调整为“删除测试音频，保留导入用例”，批量删除按钮调整为“删除选中音频”。

### 2026-04-22

1. 新增循环播放次数配置，可选上限扩展至 50 次。
2. 新增播放序列调试日志开关（debugSequence）。
3. 修复循环播放场景下第 2 轮起偶发重复播放问题。
4. 优化报告交互，测试中可查看报告且不中断播放。
5. 修复报告页空白问题，无数据时显示占位信息。

### 2026-04-28

1. 新增 Langfuse 服务与日志获取 UI（多环境、进度、暂停/继续/终止、导出）。
2. 新增 Vite 多环境代理（UAT/TEST/PROD）。
3. Langfuse 模式集成到主界面第三个 Tab。
4. 标题栏支持一键切换 UAT/TEST/PROD 环境，切换后自动清空上次数据。
5. Vite 代理拆分为三条独立路由，各环境 Basic Auth 凭据独立配置。
6. 自动过滤 input、output、name 均为空的无效记录，并自动关联 Session。
7. 数据预览支持表格展示、悬浮查看完整内容与横向拖拽滑动。

### 2026-05-07

1. 测试到 Langfuse 自动链路增强。
   - 新增测试时间追踪：`report.firstTestAudioTime`、`report.lastTestAudioTime`。
   - 测试完成后自动切换到 Langfuse 页面。
   - 自动回填 Langfuse 开始/结束时间。
   - 自动拉取并解析日志，成功后自动导出 `SessionExtract` Excel。
2. 页面信息架构优化。
   - 顶部导航统一为：语音测试 / 测试过程记录 / Langfuse 日志。
   - 下线日志分析入口与“查看报告”按钮。
3. 交互样式优化。
   - 统一三个 Tab 为“图标 + 文本”样式。
   - 时间范围选择区日期/时间标签图标高亮。
   - 日期/时间输入框内置图标高亮并显式展示日历/时钟图标。
4. 代码可维护性优化。
   - App 导航与主内容渲染改为配置驱动。
   - useTestRunner 抽离队列构建与停止条件判断。
   - Langfuse 页面抽离预设配置与结果状态处理，减少重复代码。

### 2026-05-08

1. 新增“是否自动拉取 Langfuse 日志”配置能力（语音测试播放控制台）。
   - 提供显式开关并持久化到全局状态。
   - 开启时：音频列表测试结束后自动跳转 Langfuse 日志页。
   - 关闭时：音频列表测试结束后停留在语音测试页。
2. Langfuse 页面状态持久化增强。
   - 刷新页面后保留环境、时间范围、拉取结果与筛选相关状态。
   - 对 `fetching/paused` 等进行安全回落，避免刷新后进入异常中间态。
3. Langfuse 页面交互优化。
   - 将“清空日志信息”按钮上移到操作区并保持常驻可见。
   - 自动拉取链路移除“自动导出 Excel”行为，改为仅自动拉取日志。
4. 测试报告结构化导出增强。
   - 新增 JSON 导出，提供结构化字段（summary/config/cases）。
   - 新增 CSV 导出，支持批量明细对接外部系统。
5. 日志分析大文件优化。
   - 增加大日志自动降载策略：超限时仅分析最近 80,000 行。
   - 增加任务归档面板：记录日志导入任务状态与摘要，支持本地持久化。
6. 生产部署可用性优化。
   - 补充 Nginx 反向代理示例配置，降低 Langfuse 生产接入成本。
7. 新增“测试用例管理”菜单。
   - 顶部新增测试用例管理入口，集中管理测试用例导入与存放。
   - 支持从 TAPD 粘贴导入（表格/CSV/逐行文本）并自动去重。
   - 保留手动输入与文本导入能力，统一归档到测试用例列表。

### 2026-05-09

1. TAPD API 接口导入。
   - 新增 `/tapd-api/*` Vite 代理，转发至 `https://api.tapd.cn`，解决跨域限制。
   - 新增 `src/modules/tapd/services/tapdService.js`：封装获取项目、测试计划、用例 ID、用例详情四类接口，支持分页与批量查询。
   - 新增 `src/modules/tapd/utils/tapdParser.js`：从用例步骤（steps）解析 Human/User/用户/人类前缀语句，支持 HTML 富文本去标签。
   - 新增 `src/components/TapdImportWizard.jsx`：四步向导弹窗（API配置 → 选择项目 → 选择测试计划 → 导入结果），凭据持久化至 localStorage。
   - 导入时携带 TAPD 元数据（tapd_case_id、workspace_name、test_plan_name、expected_result、priority 等）至测试用例条目。
   - 支持覆盖/跳过重复导入策略，跳过用例展示详细原因。
2. TAPD 用例展示与持久化增强。
   - TAPD 导入用例来源标记从 `tts` 调整为 `tapd`，在测试管理列表可明确识别来源。
   - 持久化逻辑改为保存测试用例完整可序列化字段，避免刷新后 TAPD 元数据丢失。
   - 测试管理页新增“清空测试用例”按钮，默认不自动清空，仅在手动确认后清空页面与本地存储数据。
3. 测试管理页结构精简。
   - 测试用例管理页移除“导入测试音频”和“测试音频列表”模块。
   - 新增“导入的测试用例列表”展示区，集中显示已导入用例与 TAPD 关键信息。
   - 语音测试页移除“测试用例管理入口”卡片，避免重复入口。
4. 测试用例分组与按模块执行增强。
   - 测试用例管理页按用例目录（填充到功能模块）分组展示导入用例。
   - TAPD 导入后默认标记为“未生成音频”，不直接进入可测列表。
   - 新增“生成测试音频”（单条/目录级）按钮，点击后才标记为可测试。
   - 语音测试页的测试音频列表按功能模块分组展示。
   - 播放控制台新增“测试模块”选择，支持仅对单独功能模块执行测试。
5. TAPD 目录结构保留与生成入口优化。
   - 导入 TAPD 用例时优先保留目录路径/目录名称（category_path/category_name）作为用例目录。
   - 测试用例管理页新增“全部生成测试音频”按钮，支持一键将全部导入用例标记为可测试。
   - 导入用例列表改为“目录下拉筛选 + 平铺列表”展示方式，目录集中管理、可快速切换查看。
6. TAPD 导入链路可靠性与可观测性增强。
   - TAPD 配置页增加目录字段调试开关，可在导入时输出候选字段与映射结果，便于快速定位租户字段差异。
   - 导入流程增加阶段化进度与失败上下文提示（获取清单/获取详情/解析导入），降低排障成本。
   - API 鉴权与输入处理增强：凭据输入自动去空格，401 场景提示改为“需使用 API 管理中的凭据”。
7. TAPD 用例目录持久化与模块统一。
   - 新增并持久化 `tapdPlanDirectory` 字段，导入后目录可跨刷新保留。
   - 功能模块统一使用用例目录值，减少目录与模块口径不一致。
   - 测试管理页与语音测试页目录显示优先读取 `tapdPlanDirectory`，保证筛选与展示一致性。

### 2026-05-11

1. 服务器部署文档补全。
   - 新增 `docx/SERVER_DEPLOYMENT_GUIDE.md`，提供从本地构建到公网访问的完整步骤。
   - 文档按当前项目实际（Vite 前端 + Nginx 代理）给出可执行命令与配置示例。
   - 增加部署前准备清单、上线检查清单、域名与 HTTPS 配置说明。
2. 部署资产标准化。
   - 新增 `deploy/scripts`、`deploy/nginx`、`deploy/docker` 三类标准部署资产。
   - 新增部署包脚本，强制部署包输出到项目外目录，避免本地仓库污染。
   - 新增 Nginx 站点模板与 Docker 部署配置，便于重复部署与团队交接。

### 2026-05-13

1. Langfuse 错误提取与 TAPD 缺陷联动。
   - 日志提取中 `output.content` 调整为优先从 `full-answer.content` 获取并保存，兼容历史字段回退。
   - 新增 `error` 字段提取，直接汇总 observation 的 `error` 信息。
   - 新增错误自动提 TAPD Bug 能力：当存在错误信息时，按“每条错误信息一条 Bug”提交到已选项目。
   - Bug 标题规则统一为：`用例名称 + Human 文本 + 总结性错误信息`。
   - TAPD 导入向导新增项目持久化（workspace_id/workspace_name），用于后续自动提单定位对应项目。
2. 顶部菜单排序优化。
   - 顶部菜单将“测试用例管理”调整到第 1 位。
   - 默认进入页切换为“测试用例管理”，便于先进行用例维护再执行测试。
3. 总结报告能力新增。
   - 新增“总结报告”顶部菜单，集中展示最新一次 Langfuse 生成的总结报告。
   - Langfuse 页面新增“生成总结报告并发送邮件”按钮。
   - 报告内容包含：执行用例条数、执行通过率、每个模块平均响应时间、测试环境。
   - 生成报告后自动唤起邮件客户端，目标邮箱为 `lily_lv@sdmctech.com`，并带入报告正文。
4. Langfuse 日志保留优化。
   - 切换顶部菜单时不再卸载 Langfuse 页面，日志数据不会被切菜单动作清空。
   - 刷新页面继续使用本地缓存恢复日志。
   - 日志仅允许通过页面“清空日志信息”按钮手动清空。
5. 总结报告邮件发送能力增强。
   - 新增自动发送链路：Langfuse 与总结报告页优先通过 EmailJS 直接发送邮件。
   - 自动发送目标邮箱固定为 `lily_lv@sdmctech.com`。
   - 自动发送失败时回退为 `mailto` 唤起邮件客户端，确保可继续发送。
   - 新增邮件服务封装：`src/services/emailService.js`（支持配置检查与统一发送入口）。
6. 总结报告菜单临时隐藏。
   - 顶部导航暂时移除“总结报告”菜单入口。
   - 总结报告相关代码能力保留，仅隐藏菜单展示，后续可快速恢复。

### 2026-05-27

1. 总结报告能力升级。
   - 恢复“总结报告”菜单入口，Langfuse 页面按钮调整为“生成报告”，生成后弹窗提示成功。
   - 取消报告邮件发送链路，报告生成后仅保存到本地并在总结报告页展示。
   - 报告基础信息补充导入测试计划、用例总数、执行数量、执行率、测试时间、测试负责人。
   - 提测参数补充租户 ID、用户 ID、家庭 ID，缺失字段统一以 `/` 展示。
   - 总结报告页面支持基础信息、提测参数、模块统计和正文编辑；报告明细表格保持只读。
   - 报告排版优化为分区展示，提升可读性。
2. 报告表格与统计口径升级。
   - 报告表格以测试计划目标文本为主，显示全部目标文本。
   - 表格字段整理为：用例 ID、目标文本、目标 Agent、实际输入、命中 Agent、Agent 是否命中、文本相似度、匹配状态、匹配方式、结论、输出、VadDuration、ASRDuration、TTSDuration、LLMDuration、FirstToken、错误信息。
   - Agent 命中率按功能模块统计，并输出整体 Agent 命中率。
   - 平均耗时按功能模块统计，并输出整体平均耗时。
   - FirstToken 按 `TTSDuration + LLMDuration` 计算。
3. 用例与日志对齐方案落地。
   - 测试执行时生成测试批次 `runId`，每条播放记录保存 `caseId`、播放顺序、音频 ID、音频文件名、播放开始/结束时间。
   - TAPD 导入用例生成稳定 `caseId`，格式优先为 `tapdCaseId_humanIndex`。
   - 报告匹配优先级调整为：`run_id + case_id`、`case_id`、`audio_file`、播放时间窗口、文本相似度、顺序兜底。
   - 同一条 Langfuse 日志只允许匹配到一条目标文本，避免实际输入与目标文本多对一错配。
   - 是否通过调整为目标 Agent 与命中 Agent 一致即通过，文本相似度仅作为对齐质量辅助字段。
4. TAPD 目标 Agent 获取方案落地。
   - 导入测试计划时先调用 `tcases/custom_fields_settings` 获取测试用例自定义字段配置。
   - 自动识别“目标Agent”字段，支持“预期Agent”“期望Agent”“目标智能体”“Agent”“target_agent”等别名。
   - 查询 `/tcases` 用例详情时动态追加目标 Agent 对应的 `custom_field_xx`。
   - 目标 Agent 为下拉枚举时，根据自定义字段 `options` 自动转换为真实 Agent 名称。
   - 同步支持“目标文本”自定义字段，优先使用该字段生成测试音频；无字段时继续从 steps 中解析 Human 文本。
   - 保留步骤/预期结果解析作为目标 Agent 兜底。
5. Langfuse 日志提取增强。
   - 命中 Agent 优先从 `[run_agent]` observation 的 `input.agent_code` 提取。
   - 兼容 `input`、`input_data`、`inputData` 以及数组结构中的 `agent_code`。
   - 输出文本优先从 `[full_answer]` observation 的 `output.content` 提取，兼容对象、数组与 message.content 结构。
   - 日志提取行补充 `run_id`、`case_id`、`audio_file`、`play_index`、`timestamp` 等字段，用于报告强匹配。
6. 测试音频列表顺序控制。
   - 测试音频列表支持上移/下移调整播放顺序。
   - 删除或调整顺序后，列表立即生效，测试执行按当前列表顺序播放。

## 归档来源

- 已整合根目录 README 与 `.claude/PROJECT_MEMORY.md` 的对应优化项。
- 已有明细保留单处记录，不重复抄录。

