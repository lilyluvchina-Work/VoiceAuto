# VoiceAuto 文档索引

## 文档定位

- 用途：集中说明 `docs` 目录下文档的分类、职责与维护方式。
- 迁移说明：原 `docx` 目录下的 Markdown 文档已按主题迁移到 `docs` 子目录。

## 目录分类

### 产品与使用

1. `product/product-introduction.md`
  - 产品视角文档。
  - 说明目标用户、核心价值、业务流程、功能说明和非功能要求。
2. `product/product-use-guide.md`
  - 用户使用指引。
  - 面向测试工程师与客户的操作流程文档。

### 架构

1. `architecture/product-architecture.md`
  - 项目架构总文档。
  - 说明系统分层、主链路、模块边界、目录约定与协作上下文。

### 安全与配置

1. `security/secure-config-plan.md`
  - 配置中心与敏感配置方案。
  - 说明配置分层、字段范围和落地计划。
2. `security/sensitive-config-management-design.md`
  - 重要信息脱敏与配置中心设计方案。
  - 说明登录、权限、配置中心、数据库持久化、TAPD / Langfuse / 钉钉参数来源。

### 集成方案

1. `integrations/tapd-import-guide.md`
  - TAPD 导入说明文档。
  - 说明 API 凭据配置、导入步骤与常见问题处理。
2. `integrations/dingding-voice-test-notifications.md`
  - 钉钉语音测试通知方案。
  - 说明通知事件、消息字段和触发范围。
3. `doubao-v3-tts-plan.md`
  - 豆包 V3 TTS 专项方案。
  - 说明后端代理、配置字段、Resource ID 与音色约束。

### 部署运维

1. `deployment/server-deployment-guide.md`
  - 服务器部署指南。
  - 说明从本地构建到公网访问（IP/域名/HTTPS）的完整流程。

### 变更记录

1. `changelog/bugfix.md`
  - Bug 修复持续记录。
  - 按日期分组沉淀问题现象、根因与修复方案。
2. `changelog/feature-optimization.md`
  - 功能优化持续记录。
  - 按日期分组沉淀新增能力、交互优化与代码结构优化。
3. `changelog/2026-07-24-development-supplement.md`
  - 阶段性开发补充说明。
  - 归档 2026-07-23 至 2026-07-24 已落地的后端接口、配置表、UI 参数来源和部署变化。

## 其他目录

- `superpowers/plans/`：阶段性实现计划与开发记录。
- `deploy/scripts/`：部署包构建脚本（产物输出到项目外目录）。
- `deploy/nginx/`：Nginx 站点与代理配置模板。
- `deploy/docker/`：Docker 镜像与编排配置。

## 维护约定

- 文档应按主题放入对应子目录。
- Bug 与功能优化不再按日期创建新文件，持续更新对应记录文件。
- 周报可按周单独生成带日期文件，便于归档和复制。
- 记录文件不重复维护“验证”段落，统一遵循 `.claude/CLAUDE.md`。
- 修改文档时优先补充影响范围和结论，避免冗长叙述。
