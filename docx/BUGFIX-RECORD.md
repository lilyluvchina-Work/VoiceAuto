# Bug 修复记录（持续更新）

## 文档定位

- 用途：持续记录已完成的 Bug 修复。
- 维护方式：按日期追加，不按日期新建文件。
- 验证流程：统一遵循 `.claude/CLAUDE.md` 的“变更验证与运行”规则。

## 影响范围（近期）

- src/components/LangfuseFetcher.jsx
- src/components/PlaybackConsole.jsx
- vite.config.js
- src/modules/langfuse/utils/excelExporter.js
- src/index.css

## 修复记录

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

## 归档来源

- 已整合根目录 README 与 `.claude/PROJECT_MEMORY.md` 的对应修复项。
- 已有明细保留单处记录，不重复抄录。


