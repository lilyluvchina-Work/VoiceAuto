import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const OUT = "E:/Voice/VoiceAuto/VoiceAuto功能介绍.pptx";
const BUILD = "E:/Voice/VoiceAuto/.codex_ppt_build";
const SLIDE_W = 1280;
const SLIDE_H = 720;
const INK = "#000000";
const PANEL = "#F2F2F2";
const RULE = "#B8BCC4";
const ACCENT = "#3D8DFF";
const ACCENT_LIGHT = "#6DCBF4";
const FONT = "Microsoft YaHei, Helvetica Neue, Arial, sans-serif";

function line(fill = "none", width = 0) {
  return { style: "solid", fill, width };
}

function textbox(slide, text, x, y, w, h, opts = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    name: opts.name,
    position: { left: x, top: y, width: w, height: h },
    fill: opts.fill ?? "none",
    line: opts.line ?? line("none", 0),
  });
  shape.text = text;
  shape.text.style = {
    fontSize: opts.size ?? 24,
    bold: opts.bold ?? false,
    color: opts.color ?? INK,
    typeface: FONT,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
  };
  return shape;
}

function rect(slide, x, y, w, h, opts = {}) {
  return slide.shapes.add({
    geometry: opts.geometry ?? "rect",
    name: opts.name,
    position: { left: x, top: y, width: w, height: h },
    fill: opts.fill ?? PANEL,
    line: opts.line ?? line("none", 0),
  });
}

function footer(slide, n) {
  textbox(slide, String(n), 1184.18, 659.24, 54.48, 25.33, {
    size: 13.33,
    align: "right",
    valign: "bottom",
  });
}

function notes(slide, sourceLines) {
  slide.speakerNotes.textFrame.setText([
    "[Sources]",
    ...sourceLines,
  ]);
  slide.speakerNotes.setVisible(true);
}

function cover(p, n) {
  const s = p.slides.add();
  textbox(s, "VoiceAuto", 41.33, 41.18, 598.67, 68.15, { size: 32 });
  textbox(s, "语音自动化\n测试平台", 41.33, 182.55, 992, 261.57, {
    size: 80,
    bold: true,
    valign: "bottom",
  });
  textbox(s, "从用例导入、语音生成、自动执行到日志分析与报告导出的闭环工具", 41.33, 497.87, 760, 113.41, { size: 28 });
  footer(s, n);
  notes(s, [
    "README.md: VoiceAuto 项目功能特性与技术栈。",
    "docs/product/product-introduction.md: 产品概述、目标用户与核心价值。",
  ]);
}

function agenda(p, n) {
  const s = p.slides.add();
  textbox(s, "这套工具解决的是语音测试从执行到追踪的完整闭环", 41.33, 36.12, 1197.33, 109.97, {
    size: 38.67,
    bold: true,
  });
  const rows = [
    ["01", "先把测试用例统一导入、归类、生成可播放音频"],
    ["02", "再按唤醒词、音色、循环次数、模块范围配置执行策略"],
    ["03", "执行中实时记录唤醒、ASR、Speaker 响应等关键链路"],
    ["04", "完成后自动沉淀过程记录、结构化报告和 Langfuse 日志"],
    ["05", "配置、账号、TAPD、钉钉、TTS 等能力集中维护"],
    ["06", "部署与排障资产进入项目目录，便于交接和复用"],
  ];
  const x = 41.33;
  const y = 218.37;
  const rowH = 58;
  const numW = 92.23;
  rows.forEach(([num, label], i) => {
    rect(s, x, y + i * rowH, 1197.34, rowH, { fill: "#FFFFFF", line: line(INK, 1) });
    rect(s, x + numW, y + i * rowH, 0.5, rowH, { fill: INK });
    textbox(s, num, x + 12, y + i * rowH + 13, 60, 32, { size: 22 });
    textbox(s, label, x + numW + 18, y + i * rowH + 12, 1060, 34, { size: 22 });
  });
  footer(s, n);
  notes(s, [
    "docs/product/product-introduction.md: 功能范围与业务流程。",
    "docs/product/product-use-guide.md: 用户页面入口和完整测试步骤。",
  ]);
}

function why(p, n) {
  const s = p.slides.add();
  textbox(s, "核心价值是让语音测试更快、更可追溯、更容易定位问题", 41.33, 36.12, 1197.33, 109.97, {
    size: 38.67,
    bold: true,
  });
  textbox(s, "面向测试工程师、语音产品研发、需要批量验证语音文案的产品人员。", 41.33, 180.83, 620, 90.83, {
    size: 30,
  });
  textbox(s, "平台把人工重复播放、手工统计、日志检索和报告整理集中到一条流程里，降低重复劳动，也让每次测试结果有据可查。", 41.33, 313.94, 600, 260, {
    size: 24,
  });
  const items = ["批量执行", "过程留痕", "自动判定", "日志联动", "报告导出"];
  items.forEach((item, i) => {
    const y = 313.94 + i * 64;
    rect(s, 788.21, y + 2.5, 22.32, 22.31, { geometry: "ellipse", fill: INK });
    textbox(s, item, 828, y - 1, 410.67, 57.61, { size: 32 });
  });
  footer(s, n);
  notes(s, [
    "docs/product/product-introduction.md: 目标用户与核心价值。",
    "README.md: 功能特性概览。",
  ]);
}

function fourCapabilities(p, n) {
  const s = p.slides.add();
  textbox(s, "功能能力覆盖测试准备、执行控制、过程记录和结果分析", 41.33, 36.12, 1197.33, 109.97, {
    size: 38.67,
    bold: true,
  });
  const blocks = [
    ["用例准备", "支持文本、音频文件、手动输入与 TAPD 接口导入，并按功能模块归类。"],
    ["语音生成", "提供豆包 V3 TTS 后端代理和 Web Speech 回退，支持音色、语种、音量、倍速配置。"],
    ["自动执行", "播放控制台支持开始、暂停、继续、停止、重置、循环次数和模块范围选择。"],
    ["结果沉淀", "输出过程记录、JSON/CSV/文本报告、Excel 过程数据和总结报告。"],
  ];
  blocks.forEach(([title, body], i) => {
    const x = i % 2 === 0 ? 41.33 : 656.86;
    const y = i < 2 ? 213.33 : 421.73;
    textbox(s, `${title}\n${body}`, x, y, 581.33, 172.5, { size: 28 });
  });
  footer(s, n);
  notes(s, [
    "docs/product/product-introduction.md: 4.1 语音测试模式、4.4 总结报告模式。",
    "docs/product/product-use-guide.md: 测试用例准备、音频生成、执行和导出说明。",
  ]);
}

function workflow(p, n) {
  const s = p.slides.add();
  textbox(s, "标准测试流程从准备到归档分为四个阶段", 41.33, 36.12, 1197.33, 109.97, {
    size: 38.67,
    bold: true,
  });
  rect(s, 35.46, 354.2, 1285.61, 0.03, { geometry: "straightConnector1", fill: "none", line: line(INK, 1) });
  const milestones = [
    ["准备", "导入用例\n生成测试音频"],
    ["配置", "设置唤醒词\n音色与循环策略"],
    ["执行", "启动播放队列\n监测关键链路"],
    ["沉淀", "导出报告\n拉取日志与复盘"],
  ];
  milestones.forEach(([label, body], i) => {
    const x = 41.33 + i * 300;
    rect(s, x - 5.87, 348.58, 11.24, 11.24, { geometry: "ellipse", fill: INK });
    textbox(s, label, x, 298.51, 169.33, 27.55, { size: 21.33, bold: true });
    textbox(s, body, x, 401.33, 250, 166.54, { size: 30 });
  });
  footer(s, n);
  notes(s, [
    "docs/product/product-use-guide.md: 一次完整测试的六步流程。",
    "docs/product/product-introduction.md: 5.1 语音测试流程。",
  ]);
}

function monitoring(p, n) {
  const s = p.slides.add();
  textbox(s, "自主监测把固定等待升级为事件驱动的链路判定", 41.33, 36.12, 1197.33, 109.97, {
    size: 38.67,
    bold: true,
  });
  const blocks = [
    ["唤醒监测", "通过 ADB 日志识别 WakeupSuccess，异常时支持自检与恢复。"],
    ["ASR 输入监测", "跟踪 ASR 生命周期，提取实际识别文本并给出相似度诊断。"],
    ["Speaker 响应监测", "录制播报音频，结合 VAD/TTS 状态判断是否完成响应。"],
    ["过程记录", "每条用例记录唤醒、播放、ASR、Speaker 音频收录五项结果。"],
  ];
  blocks.forEach(([title, body], i) => {
    const x = i % 2 === 0 ? 41.33 : 656.86;
    const y = i < 2 ? 213.33 : 421.73;
    textbox(s, `${title}\n${body}`, x, y, 581.33, 172.5, { size: 27 });
  });
  footer(s, n);
  notes(s, [
    "docs/product/product-introduction.md: 自主监测配置与过程记录口径。",
    "docs/changelog/feature-optimization.md: 自主监测链路自检、恢复和三阶段闭环记录。",
  ]);
}

function integrations(p, n) {
  const s = p.slides.add();
  textbox(s, "外部系统联动让测试计划、日志和通知进入同一工作台", 41.33, 36.12, 1197.33, 109.97, {
    size: 38.67,
    bold: true,
  });
  const blocks = [
    ["配置中心", "账号、TAPD、Langfuse、钉钉、豆包 TTS 参数统一入库维护。"],
    ["TAPD 导入", "通过接口读取测试计划、用例详情和目录结构，保持模块口径一致。"],
    ["Langfuse 日志", "支持 UAT、TEST、PROD 等多环境分页拉取、筛选和导出。"],
    ["部署资产", "Nginx、Docker、部署脚本和代理配置放在项目内，便于上线交接。"],
  ];
  blocks.forEach(([title, body], i) => {
    const x = i % 2 === 0 ? 41.33 : 656.86;
    const y = i < 2 ? 213.33 : 421.73;
    textbox(s, `${title}\n${body}`, x, y, 581.33, 172.5, { size: 27 });
  });
  footer(s, n);
  notes(s, [
    "docs/product/product-introduction.md: 配置中心、TAPD、Langfuse、部署与环境配置。",
    "docs/architecture/product-architecture.md: TAPD 导入架构、部署资产架构。",
  ]);
}

function outputs(p, n) {
  const s = p.slides.add();
  textbox(s, "输出物覆盖复盘、交接和系统对接", 41.33, 36.12, 1197.33, 109.97, {
    size: 38.67,
    bold: true,
  });
  s.charts.add("bar", {
    position: { left: 42.91, top: 130.67, width: 537.97, height: 492.39 },
    categories: ["过程", "报告", "日志", "总结"],
    series: [
      { name: "可视查看", values: [1, 1, 1, 1], fill: ACCENT_LIGHT },
      { name: "可导出", values: [1, 1, 1, 1], fill: ACCENT },
    ],
    hasLegend: true,
    legend: { position: "bottom", overlay: false },
    dataLabels: { showValue: false },
    yAxis: {
      visible: false,
      max: 1.2,
      majorGridlines: { style: "solid", width: 1, fill: "#EDEDED" },
    },
  });
  const cards = [
    ["过程记录", "展开每条用例，查看阶段状态、录音、相似度与诊断字段。"],
    ["结构化报告", "支持 JSON、CSV、Markdown、HTML、Excel。"],
    ["日志提取", "Traces 与 Observations 可导出 Excel / JSON。"],
  ];
  cards.forEach(([title, body], i) => {
    const y = 41.33 + i * 208;
    rect(s, 657.68, y, 580.99, 172, { geometry: "roundRect", fill: PANEL });
    textbox(s, `${title}\n${body}`, 688.89, y + 30.97, 523.56, 110.07, { size: 26 });
  });
  footer(s, n);
  notes(s, [
    "docs/product/product-introduction.md: 测试过程记录与报告、Langfuse 日志获取、总结报告模式。",
    "README.md: 测试报告与结构化报告功能特性。",
  ]);
}

function architecture(p, n) {
  const s = p.slides.add();
  textbox(s, "技术架构保持轻量，但为扩展和恢复留出清晰边界", 41.33, 36.12, 1197.33, 109.97, {
    size: 38.67,
    bold: true,
  });
  const layers = [
    ["视图层", "Components 负责页面展示、交互输入和结果反馈。"],
    ["业务编排层", "Hooks + Store 统一测试执行、播放和状态管理。"],
    ["服务层", "TTS、TAPD、Langfuse、ADB、通知等外部能力封装。"],
    ["工具层", "报告生成、日志分析、Excel 导出、文本解析等纯函数逻辑。"],
  ];
  layers.forEach(([title, body], i) => {
    const y = 170 + i * 110;
    rect(s, 80, y, 1120, 78, { fill: i % 2 === 0 ? "#EFEFEF" : "#FFFFFF", line: line(RULE, 1) });
    textbox(s, title, 110, y + 18, 220, 40, { size: 26, bold: true });
    textbox(s, body, 350, y + 18, 800, 40, { size: 24 });
  });
  footer(s, n);
  notes(s, [
    "docs/architecture/product-architecture.md: 总体分层、运行时主链路、状态与持久化架构。",
    "README.md: 技术栈说明。",
  ]);
}

function close(p, n) {
  const s = p.slides.add();
  textbox(s, "落地方式", 41.33, 41.18, 240, 68.15, { size: 32 });
  textbox(s, "用 VoiceAuto\n把语音测试变成\n可执行、可记录、可复盘的流程", 41.33, 158, 1040, 330, {
    size: 66,
    bold: true,
    valign: "bottom",
  });
  textbox(s, "建议先用于日常冒烟和版本回归，再逐步接入 TAPD、Langfuse 与自主监测链路。", 41.33, 522.13, 760, 113.41, {
    size: 28,
  });
  footer(s, n);
  notes(s, [
    "docs/product/product-use-guide.md: 常见使用场景和使用建议。",
    "docs/product/product-introduction.md: 迭代建议与验收标准。",
  ]);
}

async function writeBlob(out, blob) {
  await fs.writeFile(out, Buffer.from(await blob.arrayBuffer()));
}

async function main() {
  await fs.mkdir(path.join(BUILD, "rendered"), { recursive: true });
  const p = Presentation.create({ slideSize: { width: SLIDE_W, height: SLIDE_H } });

  [cover, agenda, why, fourCapabilities, workflow, monitoring, integrations, outputs, architecture, close]
    .forEach((fn, i) => fn(p, i + 1));

  for (const [index, slide] of p.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    await writeBlob(path.join(BUILD, "rendered", `${stem}.png`), await p.export({ slide, format: "png", scale: 1 }));
    await fs.writeFile(path.join(BUILD, "rendered", `${stem}.layout.json`), await (await slide.export({ format: "layout" })).text());
  }

  await writeBlob(path.join(BUILD, "montage.webp"), await p.export({ format: "webp", montage: true, scale: 1 }));
  const pptx = await PresentationFile.exportPptx(p);
  await pptx.save(OUT);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
