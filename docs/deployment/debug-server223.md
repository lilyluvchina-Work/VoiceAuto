# VoiceAuto 独立开发调试环境

更新日期：2026-10-19（Asia/Shanghai）。

- 地址：http://10.10.64.223:8890/
- 目录：`/opt/voiceauto-debug`，包含源代码和构建产物。
- 应用容器：`voiceauto-debug-web`。
- 数据库容器：`voiceauto-debug-db`，PostgreSQL 16，未映射主机端口。
- 数据库：`voiceauto_debug`，独立 Docker 数据卷 `voiceauto-debug_debug-db`。
- 管理账号：`debugadmin`；凭据仅保存在服务器 `/opt/voiceauto-debug/debug-login.txt`，权限 600。
- 配置：`compose.yml`、`backend.env`、`database.env` 位于上述目录；环境文件权限 600。
- 仅从原环境只读复制表结构，未复制业务数据、账号及集成凭据。初始只有独立调试管理员。
- 前端基于提交 `a8621ae`，叠加本次报告调整；其余本地未提交功能未发布。
- 后端沿用已有镜像 `voiceauto-web:20261012-server223`，前端独立挂载。配置外部集成时须使用调试专用账号及目标。
- 原 `8888` 服务、容器及数据库未变更；不同端口隔离浏览器 localStorage/IndexedDB，服务端会话使用独立签名密钥。

验证：首页 HTTP 200，加载 `index-Ca4mTBhk.js`；数据库健康检查通过；调试管理员 API 登录成功。原服务数据库健康检查通过。未进行设备联调或浏览器视觉检查。

运维：在服务器执行 `cd /opt/voiceauto-debug && docker compose ps` 查看状态，`docker compose logs --tail 100 web` 查看日志，`docker compose restart web` 重启调试应用。不要执行 `down -v`，以免删除调试数据卷。
