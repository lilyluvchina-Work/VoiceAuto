# DOCX 文档说明

## 文档定位

- 用途：说明 `docx` 目录下文档职责与维护方式。

## 文件说明

1. `PRODUCT_ARCH.md`
  - 项目架构总文档。
  - 说明系统分层、主链路、模块边界、目录约定与协作上下文。
2. `PRODUCT_INTRODUCE.md`
  - 产品视角文档。
  - 说明目标用户、核心价值、业务流程、功能说明和非功能要求。
3. `PRODUCT_USE_GUIDE.md`
  - 用户使用指引。
  - 面向测试工程师与客户的操作流程文档。
4. `TAPD_IMPORT_GUIDE.md`
  - TAPD 导入说明文档。
  - 说明 API 凭据配置、导入步骤与常见问题处理。
5. `BUGFIX.md`
  - Bug 修复持续记录。
  - 按日期分组沉淀问题现象、根因与修复方案。
6. `FEATURE_OPTIMIZATION.md`
  - 功能优化持续记录。
  - 按日期分组沉淀新增能力、交互优化与代码结构优化。
7. `SERVER_DEPLOYMENT_GUIDE.md`
  - 服务器部署指南。
  - 说明从本地构建到公网访问（IP/域名/HTTPS）的完整流程。
8. `sensitive-config-management-design.md`
  - 重要信息脱敏与配置中心设计方案。
  - 说明登录、权限、配置中心、数据库持久化、TAPD / Langfuse / 钉钉参数来源。
9. `2026-07-24_DEVELOPMENT_SUPPLEMENT.md`
  - 阶段性开发补充说明。
  - 归档 2026-07-23 至 2026-07-24 已落地的后端接口、配置表、UI 参数来源和部署变化。
10. `WEEKLY_REPORT.md`
  - 项目周报。
  - 按周汇总项目更新、Bug 修复、影响范围与风险建议。
11. `WEEKLY_REPORT_YYYY-MM-DD.md`
  - 带日期的项目周报。
  - 用于阶段性汇报，可直接复制粘贴到周报系统。

## 部署资产目录

- `deploy/scripts/`：部署包构建脚本（产物输出到项目外目录）。
- `deploy/nginx/`：Nginx 站点与代理配置模板。
- `deploy/docker/`：Docker 镜像与编排配置。

## 维护约定

- 文件命名统一使用大写。
- Bug 与功能优化不再按日期创建新文件，持续更新对应记录文件。
- 周报可按周单独生成带日期文件，便于归档和复制。
- 记录文件不重复维护“验证”段落，统一遵循 `.claude/CLAUDE.md`。
- 修改文档时优先补充影响范围和结论，避免冗长叙述。
