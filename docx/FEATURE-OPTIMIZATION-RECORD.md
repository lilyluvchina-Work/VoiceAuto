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
- deploy/nginx/langfuse-proxy.conf.example
- README.md
- docx/ARCH.md

## 优化记录

### 2026-04-22

1. 新增循环播放次数配置，可选上限扩展至 50 次。
2. 新增播放序列调试日志开关（debugSequence）。

### 2026-04-28

1. 新增 Langfuse 服务与日志获取 UI（多环境、进度、暂停/继续/终止、导出）。
2. 新增 Vite 多环境代理（UAT/TEST/PROD）。
3. Langfuse 模式集成到主界面第三个 Tab。

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
8. TAPD API 接口导入（2026-05-09）。
   - 新增 `/tapd-api/*` Vite 代理，转发至 `https://api.tapd.cn`，解决跨域限制。
   - 新增 `src/modules/tapd/services/tapdService.js`：封装获取项目、测试计划、用例 ID、用例详情四类接口，支持分页与批量查询。
   - 新增 `src/modules/tapd/utils/tapdParser.js`：从用例步骤（steps）解析 Human/User/用户/人类前缀语句，支持 HTML 富文本去标签。
   - 新增 `src/components/TapdImportWizard.jsx`：四步向导弹窗（API配置 → 选择项目 → 选择测试计划 → 导入结果），凭据持久化至 localStorage。
   - 导入时携带 TAPD 元数据（tapd_case_id、workspace_name、test_plan_name、expected_result、priority 等）至测试用例条目。
   - 支持覆盖/跳过重复导入策略，跳过用例展示详细原因。
9. TAPD 用例展示与持久化增强（2026-05-09）。
   - TAPD 导入用例来源标记从 `tts` 调整为 `tapd`，在测试管理列表可明确识别来源。
   - 持久化逻辑改为保存测试用例完整可序列化字段，避免刷新后 TAPD 元数据丢失。
   - 测试管理页新增“清空测试用例”按钮，默认不自动清空，仅在手动确认后清空页面与本地存储数据。
10. 测试管理页结构精简（2026-05-09）。
   - 测试用例管理页移除“导入测试音频”和“测试音频列表”模块。
   - 新增“导入的测试用例列表”展示区，集中显示已导入用例与 TAPD 关键信息。
   - 语音测试页移除“测试用例管理入口”卡片，避免重复入口。
11. 测试用例分组与按模块执行增强（2026-05-09）。
   - 测试用例管理页按用例目录（填充到功能模块）分组展示导入用例。
   - TAPD 导入后默认标记为“未生成音频”，不直接进入可测列表。
   - 新增“生成测试音频”（单条/目录级）按钮，点击后才标记为可测试。
   - 语音测试页的测试音频列表按功能模块分组展示。
   - 播放控制台新增“测试模块”选择，支持仅对单独功能模块执行测试。
12. TAPD 目录结构保留与生成入口优化（2026-05-09）。
   - 导入 TAPD 用例时优先保留目录路径/目录名称（category_path/category_name）作为用例目录。
   - 测试用例管理页新增“全部生成测试音频”按钮，支持一键将全部导入用例标记为可测试。
   - 导入用例列表改为“目录下拉筛选 + 平铺列表”展示方式，目录集中管理、可快速切换查看。
## 归档来源

- 已整合根目录 README 与 `.claude/PROJECT_MEMORY.md` 的对应优化项。
- 已有明细保留单处记录，不重复抄录。


