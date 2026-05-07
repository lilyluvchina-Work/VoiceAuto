# Bug 修复记录（持续更新）

## 文档定位

- 用途：持续记录已完成的 Bug 修复。
- 维护方式：按日期追加，不按日期新建文件。
- 验证流程：统一遵循 `.claude/CLAUDE.md` 的“变更验证与运行”规则。

## 影响范围（近期）

- src/components/LangfuseFetcher.jsx
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

## 归档来源

- 已整合根目录 README 与 `.claude/PROJECT_MEMORY.md` 的对应修复项。
- 已有明细保留单处记录，不重复抄录。


