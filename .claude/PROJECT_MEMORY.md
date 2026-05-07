# VoiceAuto 项目记忆

## 文档定位

- 用途：沉淀项目长期稳定信息，减少重复沟通成本。
- 读者：协作开发者与 AI 助手。
- 原则：记录稳定事实，不记录短期临时事项。

## 项目概览

- 项目名称：VoiceAuto
- 形态：纯前端应用（Browser-Based）
- 目标：覆盖语音测试、过程记录、Langfuse 日志拉取导出的一体化流程

## 核心能力

1. 语音测试
   - 唤醒词配置、音频配置、测试用例管理、播放控制台。
2. 测试过程记录
   - 过程统计与报告展示，支持测试中查看。
3. Langfuse 日志
   - 多环境拉取（UAT/TEST/PROD）、过滤与关联、Excel/JSON 导出。

## 技术基线

- React 18
- Vite 5
- Tailwind CSS
- Web Speech API / 豆包 TTS（失败自动回退）
- 状态管理：React Context + useReducer

## 关键约束

- 执行流程保持顺序性，避免并发播放。
- 关键配置与用例支持 localStorage 持久化。
- 文档命名与结构统一，变更记录归档到 docx 持续文件。

## 文档映射

- 架构文档：docx/ARCH.md
- 产品文档：docx/PRODUCT.md
- Bug 记录：docx/BUGFIX-RECORD.md
- 功能优化记录：docx/FEATURE-OPTIMIZATION-RECORD.md
- docx 目录说明：docx/README.md
