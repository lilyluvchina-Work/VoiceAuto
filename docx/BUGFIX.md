# Bug 修复记录（持续更新）

## 文档定位

- 用途：持续记录已完成的 Bug 修复。
- 维护方式：按日期追加，不按日期新建文件。
- 验证流程：统一遵循 `.claude/CLAUDE.md` 的“变更验证与运行”规则。

## 影响范围（近期）

- src/components/LangfuseFetcher.jsx
- src/components/PlaybackConsole.jsx
- src/components/SummaryReport.jsx
- src/modules/langfuse/utils/sessionExtractor.js
- src/modules/tapd/services/tapdService.js
- src/utils/summaryReportBuilder.js
- vite.config.js
- src/modules/langfuse/utils/excelExporter.js
- src/index.css

## 修复记录

### 2026-06-04

1. 修复自主监测过程日志中 ASR 文本与响应文本混淆问题。
  - 现象：测试过程记录里“获取到的 ASR 文本”和“响应文本”显示相同内容，无法区分输入识别和 Speaker 回复。
  - 根因：响应链路的麦克风转写 `responseAsrText` 被展示层复用为 ASR 文本。
  - 修复：展示层拆分 `actualAsrText`、`responseAsrText`、`speakerResponseText`；其中 `speakerResponseText` 优先来自 ADB `tts_status` 日志。
2. 修复 Speaker 响应文本来源不准确问题。
  - 现象：第三阶段仅通过麦克风 ASR 转写响应音频，无法稳定代表 Speaker 实际播放内容。
  - 根因：未接入 Speaker 端 `VAD_STATUS` / `TTS_STATUS` 日志。
  - 修复：ADB Bridge 新增响应日志监听，使用 `vad_status=start/stop` 判断响应窗口，并从 `tts_status` 提取 Speaker 实际播放回复文本。
3. 修复自主监测过程日志重复展示问题。
  - 现象：响应 ASR interim 或重复派发的同内容日志可能在测试过程记录中刷屏。
  - 根因：过程日志按事件直接追加，没有内容去重。
  - 修复：日志入库时按内容指纹去重，忽略 `id/time/raw/sampleLines` 等易变字段。
4. 修复开启自主监测后仍等待固定用例间隔问题。
  - 现象：自主监测开启后，下一条用例仍等待固定 `wakeIntervalDelay`。
  - 根因：用例间隔逻辑未感知自主监测状态。
  - 修复：任一自主监测开启时跳过固定用例间隔，直接进入下一次唤醒流程。

### 2026-05-29

1. 修复 Langfuse 日志拉取偶发 `read ECONNRESET` 后整轮失败问题。
  - 现象：开发环境终端持续出现 `vite http proxy error`，`/api/public/traces` 或 `/api/public/observations` 请求失败后页面报错中断。
  - 根因：分页拉取链路未对瞬时网络故障（如连接被上游重置）做重试，单次失败直接终止整轮任务。
  - 修复：在 `src/modules/langfuse/services/langfuseService.js` 与 `src/services/langfuseService.js` 增加网络错误重试（指数退避）；并在 `vite.config.js` 的 Langfuse 代理增加 `timeout/proxyTimeout` 稳定性参数。
2. 修复自动拉取 Langfuse 日志窗口过短导致末尾日志缺失问题。
  - 现象：测试完成后立即拉取日志时，最后几条语音交互可能尚未写入 Langfuse，报告中出现实际输入/输出缺失。
  - 根因：自动拉取结束时间使用最后一条测试音频时间，未给 Langfuse 日志落库留出缓冲。
  - 修复：测试完成后先停留 2 分钟，再以跳转触发时间作为 `langfuseFetchEndTime` 自动拉取日志。
3. 修复报告把未执行导入用例计入本次报告的问题。
  - 现象：仅执行部分模块或部分音频时，报告仍可能按全部导入用例计算总数和明细。
  - 根因：报告构建直接遍历 `testAudios`，未严格以本次 `testReport.cases` 执行记录为准。
  - 修复：报告行和统计指标改为从执行记录反查音频生成，只统计本次实际执行音频。
4. 修复删除 TAPD 测试音频时误移除导入用例的问题。
  - 现象：在语音测试页删除某条 TAPD 音频后，对应导入用例也从测试音频列表中消失，后续需要重新导入或生成。
  - 根因：删除动作直接从 `testAudios` 中移除整条记录，未区分“导入用例”和“已生成音频”。
  - 修复：对 TAPD 来源音频执行删除时仅清空 `audioBlob/audioUrl/duration/audioStatus`，保留用例元数据。
5. 修复 Langfuse 错误日志与有效输入分离导致报告错误信息缺失问题。
  - 现象：`[error]` observation 有错误内容，但报告明细或日志提取行未归到对应输入。
  - 根因：旧提取逻辑按 Session 粗聚合且只识别部分 error 结构，孤立错误行无法挂到最近一次有效输入。
  - 修复：按 Trace/Request 构造日志提取行，增强 `[error]` output/message/content 解析，并将同 Session 孤立错误合并到最近有效输入行。

### 2026-04-22

1. 修复第 2 轮起可能出现同一用例连续播放问题。
2. 修复测试中查看报告会打断播放问题。
3. 修复查看报告后内容空白问题（空数据占位）。

### 2026-05-07

1. 修复 `buildSessionRows` 导出缺失。
  - 现象：页面报错 `does not provide an export named 'buildSessionRows'`。
  - 根因：`excelExporter.js` 使用了 `buildSessionRows` 但未显式导出。
  - 修复：在 `src/modules/langfuse/utils/excelExporter.js` 增加 `export { buildSessionRows }`。
2. 修复获取日志按钮手动触发失效。
  - 现象：点击“获取日志”后参数异常，手动拉取失败。
  - 根因：`handleFetch` 新增可选参数后，按钮直接绑定导致事件对象被当作入参。
  - 修复：按钮改为 `onClick={() => handleFetch()}`。
3. 修复自动回填同秒时间窗口被拦截。
  - 现象：开始/结束时间同秒时触发“开始时间必须早于结束时间”。
  - 根因：自动回填窗口无最小时间差保护。
  - 修复：结束时间不大于开始时间时自动顺延 1 秒。
4. 修复日期/时间输入框仅有高亮框无图标。
  - 现象：输入框内置图标只显示高亮底色，未显示对应图标。
  - 根因：浏览器原生 indicator 图标在样式覆盖后可见性不足。
  - 修复：为 `date/time` indicator 注入显式 SVG（日期=日历，时间=时钟）。

### 2026-05-08

1. 修复开发环境端口漂移导致页面连不上问题。
  - 现象：访问 `localhost:3000` 时偶发跳到 `3001` 并出现 `ERR_CONNECTION_REFUSED`。
  - 根因：Vite 在端口被占用时自动回退到其他端口，前端访问口径不一致。
  - 修复：在 `vite.config.js` 的 `server` 中增加 `strictPort: true`，端口冲突时直接报错。
2. 修复“自动拉取 Langfuse 日志”入口不明显问题。
  - 现象：播放控制台中的开关不易被发现，用户误以为功能未生效。
  - 根因：原入口为弱化样式的普通复选框文案。
  - 修复：在 `PlaybackConsole` 调整为高可见性的高亮卡片样式并显示当前状态提示。
3. 修复 Langfuse 点击“获取日志”后历史结果瞬间消失问题。
  - 现象：重新拉取时页面已有结果会立即清空，体验为“数据秒无”。
  - 根因：`handleFetch` 启动时立即调用 `resetFetchedResultState()`，且结果区仅在 `isDone` 时渲染。
  - 修复：拉取开始时仅重置进度，不清空结果；结果区改为“有历史数据或已完成”均可显示。

### 2026-05-09

1. 修复语音测试菜单中手动导入与手动输入入口丢失问题。
  - 现象：语音测试页看不到“导入测试音频”区域，导致“手动导入测试音频/输入生成测试音频”不可用。
  - 根因：主页面在语音测试模式未渲染 `AudioImporter` 组件。
  - 修复：在 `src/App.jsx` 语音测试右侧区域恢复 `AudioImporter` 渲染。
2. 修复 TAPD 导入在选择测试计划后失败时缺少定位信息问题。
  - 现象：导入失败仅显示通用错误，无法判断失败阶段。
  - 根因：导入流程未记录阶段状态，异常信息缺少上下文。
  - 修复：在 `src/components/TapdImportWizard.jsx` 增加“获取用例清单/获取用例详情/解析并导入”阶段标记并拼接到失败文案。
3. 修复 TAPD 目录映射被非目录字段覆盖导致目录不一致问题。
  - 现象：导入后的目录与 TAPD “用例目录”列不一致，出现目录空值或异常值。
  - 根因：早期目录提取链路存在多字段竞争，部分字段值为 ID 或噪声文本。
  - 修复：目录主链路调整为 `test_plans/get_test_plan_tcase -> tcases.category_id -> tcase_categories` 映射，并增加目录文本归一化过滤。
4. 修复 TAPD 分类接口兼容性问题导致导入失败。
  - 现象：部分租户在目录查询阶段失败，进而中断导入。
  - 根因：目录接口候选中包含稳定性较差端点。
  - 修复：`fetchCaseCategoryLookup` 优先并收敛到 `tcase_categories/tcategories`，同时保留端点回退。

### 2026-05-11

1. 修复开发服务仅监听 `localhost` 导致局域网无法访问问题。
  - 现象：同局域网设备使用“主机 IP + 3000 端口”无法访问页面。
  - 根因：`vite.config.js` 未配置 `server.host`，Vite 默认仅监听回环地址。
  - 修复：在 `vite.config.js` 的 `server` 中增加 `host: '0.0.0.0'`，允许通过局域网 IP 访问。

### 2026-05-27

1. 修复报告表格未显示全部目标文本问题。
  - 现象：报告明细受文本相似度过滤影响，部分测试计划目标文本未显示。
  - 根因：旧逻辑以相似度匹配结果作为报告明细来源。
  - 修复：报告表格改为以测试音频/测试计划目标文本为主，Langfuse 日志只作为实际值填充。
2. 修复目标文本与实际输入文本无法一一对应问题。
  - 现象：多条目标文本可能匹配到同一条日志，或按相似度导致错配。
  - 根因：缺少稳定用例标识和日志唯一占用规则。
  - 修复：新增 `run_id + case_id` 优先匹配，并确保每条 Langfuse 日志最多匹配一条目标文本；无强标识时按时间窗口、相似度和顺序兜底。
3. 修复报告无法从日志提取实际输入、输出和命中 Agent 问题。
  - 现象：报告表格中实际输入、输出、命中 Agent 为空或取到中间日志。
  - 根因：Langfuse observation 字段结构存在数组、`input_data`、`full_answer` 等差异，旧提取逻辑覆盖不足。
  - 修复：实际输入增强 ASR/input 类 observation 兜底；输出优先取 `[full_answer]` 的 `output.content`；命中 Agent 优先取 `[run_agent]` 的 `input.agent_code`。
4. 修复目标 Agent 未从测试计划用例中稳定获取问题。
  - 现象：目标 Agent 依赖 steps/expectation 文本解析，TAPD 用例中维护了自定义字段时仍取不到。
  - 根因：导入链路未查询 `tcases/custom_fields_settings`，也未在 `/tcases` 的 `fields` 中动态加入目标 Agent 自定义字段。
  - 修复：导入时先识别目标 Agent 对应 `custom_field_xx`，查询详情时带入该字段，并支持下拉枚举值转换。
5. 修复测试音频列表调整或删除后执行顺序不及时生效问题。
  - 现象：用户调整音频播放顺序或删除音频后，测试执行仍可能按旧列表。
  - 根因：播放列表缺少显式重排动作与播放状态同步清理。
  - 修复：新增重排状态动作，删除当前播放音频时同步清理当前播放索引与音频 ID，测试队列按最新列表构建。

## 归档来源

- 已整合根目录 README 与 `.claude/PROJECT_MEMORY.md` 的对应修复项。
- 已有明细保留单处记录，不重复抄录。


