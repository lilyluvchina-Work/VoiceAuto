const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const outPath = path.resolve(__dirname, '..', 'VoiceAuto语音自动化工具向上汇报.pptx');
const PX = 9525;
const W = 1280;
const H = 720;

function emu(v) {
  return Math.round(v * PX);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function color(hex) {
  return hex.replace('#', '').toUpperCase();
}

function solidFill(hex) {
  return `<a:solidFill><a:srgbClr val="${color(hex)}"/></a:solidFill>`;
}

function xfrm(x, y, w, h) {
  return `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
}

function paragraph(lines, opts = {}) {
  const {
    size = 24,
    bold = false,
    fill = '#000000',
    breakLines = true,
    lineSpacing = 108,
  } = opts;
  const parts = Array.isArray(lines) ? lines : String(lines).split('\n');
  return parts
    .map((line) => {
      const runs = String(line)
        .split(/(\*\*[^*]+\*\*)/g)
        .filter(Boolean)
        .map((part) => {
          const strong = part.startsWith('**') && part.endsWith('**');
          const text = strong ? part.slice(2, -2) : part;
          return `<a:r><a:rPr lang="zh-CN" sz="${size * 100}"${bold || strong ? ' b="1"' : ''}>${solidFill(fill)}</a:rPr><a:t>${esc(text)}</a:t></a:r>`;
        })
        .join('');
      return `<a:p><a:pPr><a:lnSpc><a:spcPct val="${lineSpacing * 1000}"/></a:lnSpc></a:pPr>${runs}</a:p>`;
    })
    .join(breakLines ? '' : '');
}

function textbox(id, name, x, y, w, h, text, opts = {}) {
  const {
    size = 24,
    bold = false,
    fill = '#000000',
    valign = 'top',
    anchor = valign === 'middle' ? 'ctr' : valign === 'bottom' ? 'b' : 't',
  } = opts;
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
    <p:txBody><a:bodyPr wrap="square" anchor="${anchor}"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${paragraph(text, { size, bold, fill })}</p:txBody>
  </p:sp>`;
}

function rect(id, name, x, y, w, h, fill = '#EDEDED', line = '#EDEDED') {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solidFill(fill)}<a:ln w="9525">${solidFill(line)}</a:ln></p:spPr>
  </p:sp>`;
}

function line(id, name, x1, y1, x2, y2, fill = '#B8BCC4', width = 2) {
  return `<p:cxnSp>
    <p:nvCxnSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
    <p:spPr>${xfrm(x1, y1, x2 - x1, y2 - y1)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${emu(width)}">${solidFill(fill)}<a:tailEnd type="triangle"/></a:ln></p:spPr>
  </p:cxnSp>`;
}

function footer(id, n) {
  return textbox(id, `page-${n}`, 1170, 662, 70, 28, `0${n}`, { size: 14, fill: '#4B5563' });
}

function slideXml(shapes) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr>${solidFill('#FFFFFF')}</p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(W)}" cy="${emu(H)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(W)}" cy="${emu(H)}"/></a:xfrm></p:grpSpPr>
      ${shapes.join('\n')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

const slides = [];

slides.push(slideXml([
  rect(2, 'top-rule', 42, 38, 1196, 4, '#111827', '#111827'),
  textbox(3, 'eyebrow', 42, 70, 520, 40, '语音自动化测试平台｜向上汇报', { size: 24, fill: '#3D8DFF', bold: true }),
  textbox(4, 'title', 42, 178, 870, 190, 'VoiceAuto\n把语音测试从手工串联变成可复用流程', { size: 58, bold: true }),
  textbox(5, 'subtitle', 42, 500, 680, 90, '围绕“测试用例 -> 音频执行 -> 日志回收 -> 结果报告”闭环，统一承载语音助手回归、链路诊断和版本提测汇报。', { size: 24, fill: '#374151' }),
  rect(6, 'value-band', 820, 172, 350, 300, '#EAF6FE', '#EAF6FE'),
  textbox(7, 'value-1', 855, 205, 280, 50, '01  用例资产化', { size: 28, bold: true }),
  textbox(8, 'value-2', 855, 285, 280, 50, '02  执行自动化', { size: 28, bold: true }),
  textbox(9, 'value-3', 855, 365, 280, 50, '03  报告结构化', { size: 28, bold: true }),
  footer(10, 1),
]));

slides.push(slideXml([
  textbox(2, 'title', 42, 42, 1110, 80, '它覆盖语音交互测试的关键工作面', { size: 40, bold: true }),
  textbox(3, 'subtitle', 42, 110, 930, 54, '从测试准备到结果汇报，减少跨工具搬运，让问题定位有日志、有录音、有结构化结论。', { size: 22, fill: '#374151' }),
  rect(4, 'flow-bg', 42, 190, 1196, 125, '#F3F4F6', '#F3F4F6'),
  textbox(5, 'step1', 70, 220, 145, 58, '用例导入\nTAPD / 文本 / 文件', { size: 20, bold: true }),
  line(6, 'arrow1', 225, 252, 285, 252, '#3D8DFF', 2),
  textbox(7, 'step2', 300, 220, 145, 58, '音频生成\n豆包 TTS / Web Speech', { size: 20, bold: true }),
  line(8, 'arrow2', 455, 252, 515, 252, '#3D8DFF', 2),
  textbox(9, 'step3', 530, 220, 145, 58, '自动执行\n唤醒 / ASR / 播放', { size: 20, bold: true }),
  line(10, 'arrow3', 685, 252, 745, 252, '#3D8DFF', 2),
  textbox(11, 'step4', 760, 220, 145, 58, '日志回收\nLangfuse / ADB', { size: 20, bold: true }),
  line(12, 'arrow4', 915, 252, 975, 252, '#3D8DFF', 2),
  textbox(13, 'step5', 990, 220, 190, 58, '报告闭环\n看板 / Excel / Bug', { size: 20, bold: true }),
  textbox(14, 'left-title', 42, 380, 390, 40, '可承担的测试工作', { size: 28, bold: true }),
  textbox(15, 'left-body', 42, 432, 500, 136, [
    '• 版本回归：批量播放用例，记录每轮成功率与失败明细',
    '• 链路验证：唤醒、ASR 输入、Speaker 播报收录分阶段判断',
    '• 路由评估：目标 Agent 与实际命中 Agent 对齐分析',
    '• 多环境排查：UAT / TEST / PROD 日志拉取与筛选'
  ], { size: 20, fill: '#111827' }),
  rect(16, 'right-panel', 680, 380, 470, 150, '#EAF6FE', '#EAF6FE'),
  textbox(17, 'right-title', 708, 410, 390, 34, '对团队的直接价值', { size: 28, bold: true }),
  textbox(18, 'right-body', 708, 462, 392, 58, '把“听一遍、翻日志、手写结论”的工作沉淀成标准流程，便于复测、追溯和向上同步。', { size: 22, fill: '#111827' }),
  footer(19, 2),
]));

slides.push(slideXml([
  textbox(2, 'title', 42, 42, 1110, 80, '后续迭代重点：从自动执行走向智能质检闭环', { size: 40, bold: true }),
  textbox(3, 'subtitle', 42, 110, 950, 54, '围绕“稳定执行、智能分析、质量治理”三条线，让工具支撑更高频、更大规模的语音版本交付。', { size: 22, fill: '#374151' }),
  line(4, 'road-line', 120, 320, 1140, 320, '#B8BCC4', 3),
  rect(5, 'phase1', 80, 210, 300, 250, '#F3F4F6', '#F3F4F6'),
  textbox(6, 'phase1-title', 110, 235, 240, 42, '近期：提效固化', { size: 28, bold: true }),
  textbox(7, 'phase1-body', 110, 300, 230, 96, [
    '• MiniMax 智能评测常态化',
    '• 配置中心与报告看板完善',
    '• 失败日志链接与导出留档'
  ], { size: 20 }),
  rect(8, 'phase2', 490, 210, 300, 250, '#EAF6FE', '#EAF6FE'),
  textbox(9, 'phase2-title', 520, 235, 240, 42, '中期：规模回归', { size: 28, bold: true }),
  textbox(10, 'phase2-body', 520, 300, 230, 96, [
    '• 定时任务与批量回归',
    '• 历史版本趋势对比',
    '• CI / 流水线触发测试'
  ], { size: 20 }),
  rect(11, 'phase3', 900, 210, 300, 250, '#F3F4F6', '#F3F4F6'),
  textbox(12, 'phase3-title', 930, 235, 240, 42, '远期：质量治理', { size: 28, bold: true }),
  textbox(13, 'phase3-body', 930, 300, 230, 116, [
    '• 异常规则引擎与根因分类',
    '• 用例库覆盖率与风险门禁',
    '• 跨环境质量知识库'
  ], { size: 20 }),
  textbox(14, 'close', 145, 545, 970, 54, '目标是在提测前自动给出“能不能发、风险在哪、证据是什么”的判断依据。', { size: 28, bold: true, fill: '#3D8DFF' }),
  footer(15, 3),
]));

function relsXml(count) {
  const rels = [];
  rels.push(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`);
  for (let i = 1; i <= count; i += 1) {
    rels.push(`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`);
  }
  rels.push(`<Relationship Id="rId${count + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
}

function presentationXml(count) {
  const ids = [];
  for (let i = 1; i <= count; i += 1) {
    ids.push(`<p:sldId id="${255 + i}" r:id="rId${i}"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${ids.map((item, index) => item.replace(`r:id="rId${index + 1}"`, `r:id="rId${index + 2}"`)).join('')}</p:sldIdLst>
  <p:sldSz cx="${emu(W)}" cy="${emu(H)}" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle/>
</p:presentation>`;
}

function contentTypes(count) {
  const slidesXml = Array.from({ length: count }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  ${slidesXml}
</Types>`;
}

function slideRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
}

function slideLayoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(W)}" cy="${emu(H)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(W)}" cy="${emu(H)}"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function slideMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(W)}" cy="${emu(H)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(W)}" cy="${emu(H)}"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
}

async function main() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes(slides.length));
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>VoiceAuto语音自动化工具向上汇报</dc:title><dc:creator>Codex</dc:creator><cp:lastModifiedBy>Codex</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-08-08T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-08T00:00:00Z</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft PowerPoint</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slides.length}</Slides></Properties>`);
  zip.file('ppt/presentation.xml', presentationXml(slides.length));
  zip.file('ppt/_rels/presentation.xml.rels', relsXml(slides.length));
  zip.file('ppt/slideMasters/slideMaster1.xml', slideMasterXml());
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  zip.file('ppt/slideLayouts/slideLayout1.xml', slideLayoutXml());
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  zip.file('ppt/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="VoiceAuto"><a:themeElements><a:clrScheme name="VoiceAuto"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="111827"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="3D8DFF"/></a:accent1><a:accent2><a:srgbClr val="6DCBF4"/></a:accent2><a:accent3><a:srgbClr val="EAF6FE"/></a:accent3><a:accent4><a:srgbClr val="B8BCC4"/></a:accent4><a:accent5><a:srgbClr val="374151"/></a:accent5><a:accent6><a:srgbClr val="111827"/></a:accent6><a:hlink><a:srgbClr val="3D8DFF"/></a:hlink><a:folHlink><a:srgbClr val="3D8DFF"/></a:folHlink></a:clrScheme><a:fontScheme name="VoiceAuto"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="VoiceAuto"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`);
  slides.forEach((xml, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRelsXml());
  });
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outPath, buf);
  console.log(outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
