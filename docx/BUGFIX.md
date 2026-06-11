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
- scripts/startDev.cjs
- scripts/adbBridge.cjs
- src/hooks/useTestRunner.js
- src/services/responseMonitorService.js
- src/services/adbWakeService.js
- src/components/TestProcessRecord.jsx
- src/utils/testStatus.js

## 修复记录

### 2026-06-11

1. 汇总现有错误日志到统一文件。
  - 现象：错误信息分散在 `startup-error.log`、`startup-check.log`、`adb-bridge.log`、`adb-bridge.out.log` 等文件中，排查时需要来回检索。
  - 处理：新增 `scripts/collectErrorLogs.cjs` 和 `npm run logs:errors`，将包含 `STARTUP_ERROR / ERROR / Error / error / failed / fail / 异常 / 失败 / 错误` 的日志行汇总到 `logs/error-summary.log`。
  - 本次结果：共汇总 6302 行错误/异常相关日志。
2. 日志汇总发现：开发服务启动与端口占用异常。
  - 现象：`startup-error.log` 中记录 `npm run dev 启动 Vite 时失败：Port 3000 is already in use`。
  - 影响：重复启动或端口被占用时，前端开发服务无法按固定端口启动。
  - 当前状态：已有启动脚本自检和端口复用提示，后续仍需在运行前确认 3000 端口是否已有 VoiceAuto 实例。
3. 日志汇总发现：子进程启动权限异常。
  - 现象：`startup-error.log`、`adb-bridge.log` 中出现 `spawn EINVAL`、`spawn EPERM`。
  - 影响：可能导致 Vite、ADB 命令、ADB 重启或设备列表读取失败。
  - 当前状态：在受限运行环境中需要提升权限执行构建/ADB 操作；相关错误已进入统一汇总日志，便于定位发生时间和调用链。
4. 日志汇总发现：ADB / Speaker 设备恢复超时。
  - 现象：`adb-bridge.log` 中出现 `Speaker ADB device recovery timeout`、`reboot.device.recovery.failed`。
  - 影响：连续唤醒失败后触发 ADB 重启恢复时，设备可能未在超时时间内重新上线，导致本轮测试中断。
  - 当前状态：已有 Speaker 监听链路自检和一键恢复入口；后续可继续优化恢复等待时长、设备选择和失败提示。
5. 日志汇总发现：唤醒监听未命中 WakeupSuccess。
  - 现象：`wakeup.detect.finish` 中存在 `success:false`、`matchedKeyword:""`、`检测超时，未发现 WakeupSuccess 日志` 等记录。
  - 影响：Speaker 实际可能未唤醒，或日志关键词未覆盖当前设备日志格式，导致测试无法进入后续链路。
  - 当前状态：唤醒结果已在测试过程记录中显示最后一次有效结果；高级关键词配置已隐藏但默认规则仍保留在底层配置中。
6. 日志汇总发现：ASR 监听与文本提取规则存在噪声命中风险。
  - 现象：`asr.detect.start` 多次记录 ASR 开始/结束/失败关键词和文本提取正则；错误汇总中也包含部分设备侧失败、网络异常和日志噪声。
  - 影响：当设备日志噪声过多或日志格式变化时，ASR 结果可能出现未命中、误判或文本提取为空。
  - 当前状态：已支持 GoogleLiveResponseBean 的 `asr_status/input_text` 提取规则；后续需结合真实失败样本继续收敛关键词和过滤噪声。
7. 日志汇总发现：设备侧系统与网络噪声较多。
  - 现象：`adb-bridge.log` 中大量出现 `WifiVendorHal failed`、`Network is unreachable`、`HTTP error code 401`、`RESOURCE_EXHAUSTED`、`MQTT onFailure` 等设备侧日志。
  - 影响：这些日志多数不是 VoiceAuto 代码异常，但会污染错误检索结果，也可能间接影响 Speaker 在线状态、云端 ASR 或响应链路稳定性。
  - 当前状态：已汇总到 `logs/error-summary.log`；后续可在汇总脚本中增加白名单/黑名单分类，区分“平台错误”和“设备环境噪声”。

### 2026-06-06

1. 修复项目次日启动后 Speaker 监听链路不稳定问题。
  - 现象：前一晚运行正常，次日启动后无法稳定监听 Speaker 唤醒或响应日志。
  - 根因：项目启动依赖 ADB、设备在线状态、logcat 可读性和监听进程，但启动阶段缺少统一自检与恢复机制。
  - 修复：
    - 新增启动自检脚本 `scripts/startDev.cjs`，启动前检查 ADB bridge、设备状态和 logcat 可读性；
    - `scripts/adbBridge.cjs` 新增 `/api/adb/devices`、`/api/adb/health`、`/api/adb/recover`；
    - 异常信息和解决方案写入 `logs/startup-error.log`，自检结果写入 `logs/startup-check.log`。
2. 修复 ASR 文本无法从云端日志稳定提取问题。
  - 现象：页面无法稳定获取 `onHandlerCloudMsg==>GoogleLiveResponseBean(...messageType=asr_status/input_text...)` 中的 ASR 文本。
  - 根因：旧 ASR 关键字和正则未覆盖 GoogleLiveResponseBean 日志结构。
  - 修复：新增 `asr_status/input_text` 云端日志关键字和 `Message(content=..., messageType=...)` 文本提取正则，并在本地存储恢复时自动合并默认规则。
3. 修复唤醒成功后测试音频偶发未正常播放问题。
  - 现象：Speaker 已唤醒，但测试音频没有按预期开始播放。
  - 根因：唤醒 TTS 队列和测试音频播放衔接过紧，存在音频播放状态未完全释放的窗口。
  - 修复：唤醒成功后先停止残留 TTS 队列并短暂等待，再播放测试音频；同时增加测试音频开始播放超时保护。
4. 修复 Speaker 播放 TTS 音频录制偶发为空或被截断问题。
  - 现象：有时能录到 Speaker 播报内容，有时录音为空或只录到部分内容，长回复更明显。
  - 根因：旧录制逻辑对长文本回复缺少动态保护时长，静音判断过早，PCM 缓存窗口也可能不足。
  - 修复：
    - 响应录音改为连续 PCM 采样并编码 WAV；
    - 根据 TTS 文本长度估算播报时长，增加最短录制保护；
    - 长文本使用更长静音结束阈值，并设置最大录制兜底；
    - 下一轮唤醒延后到 Speaker 播报结束并冷却后再执行；
    - 结果中记录结束原因、预计时长、实际录制时长、连续静音和疑似截断标记。
5. 修复测试结果统计口径重复实现导致维护风险问题。
  - 现象：过程记录和报告导出分别维护唤醒/ASR/TTS 状态判定，后续容易出现统计口径不一致。
  - 根因：状态判断逻辑分散在多个文件。
  - 修复：新增 `src/utils/testStatus.js` 统一管理状态判断和统计方法，过程记录与报告导出共用同一套逻辑。

### 2026-06-04

1. 修复 Speaker 播报未结束即开始下一次唤醒的问题。
  - 现象：响应检测结束后立即进入下一次唤醒，偶发与 Speaker 尾音重叠。
  - 根因：流程虽已监听到 `vad_status=stop`，但未在播报结束后增加唤醒保护时间。
  - 修复：在 `useTestRunner` 增加“响应结束到下一次唤醒”门控，监听到 Speaker 播报结束后强制等待 1s，再进入下一轮唤醒。

1. 修复自动监听 Speaker 播报误判失败与监听器累积问题。
  - 现象：即使检测到 Speaker 发声与 ADB 响应日志，仍可能被判定为失败；长时间运行时响应监听存在回调累积风险。
  - 根因：响应链路将浏览器 ASR 结果作为硬性通过条件，并且响应轮询 `wait` 未及时释放 `abort` 监听器；同时通过条件对 `vadEnded` 依赖过强。
  - 修复：
    - `responseMonitorService` 中响应 ASR 降级为诊断信息，不再作为主成功条件；
    - `wait` 增加统一清理逻辑，超时/取消/完成都会移除 `abort` 监听器；
    - `useTestRunner` 放宽响应链路判定为“响应音频成功 + ADB 侧存在 TTS 文本证据（success/vadStarted/ttsMatchedLine 任一）”。

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


