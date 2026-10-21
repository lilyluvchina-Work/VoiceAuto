# VoiceAuto 服务器部署参数与工具

更新日期：2026-10-12（Asia/Shanghai）。

## 部署参数

| 参数 | 当前配置 |
| --- | --- |
| 服务器 IP | `10.10.64.223` |
| SSH 用户 / 端口 | `root` / `22` |
| 服务器系统 | Rocky Linux 9.7 |
| 访问地址 | http://10.10.64.223:8888/ |
| 容器名 | `voiceauto-web` |
| 镜像 | `voiceauto-web:20261012-server223` |
| 端口映射 | `8888:3000` |
| 发布目录 | `/opt/voiceauto/releases/voiceauto-20261012-server223` |
| 当前版本链接 | `/opt/voiceauto/current` |
| Compose 配置 | `/opt/voiceauto/current/compose.yml` |
| 环境文件 | `/opt/voiceauto/current/backend.env`，权限 `600` |
| 数据库 | 沿用原服务器 PostgreSQL：`10.10.64.202:5432/voiceauto` |
| 数据库连接配置 | `DATABASE_URL`，具体凭据保存在服务器环境文件中 |
| 数据库连接池 | `DB_POOL_SIZE=10` |
| 运行环境 | `NODE_ENV=production` |
| 后端端口 | `PORT=3000` |
| 重启策略 | `unless-stopped` |
| 容器工作目录 | `/app` |
| 后端启动命令 | `node server/index.js` |

服务器密码和数据库凭据不记录在本文。

## 使用的工具

| 工具 | 版本 / 用途 |
| --- | --- |
| Docker | 29.8.0；构建镜像、运行容器 |
| Docker Compose | v5.5.1；保存可复用的服务配置 |
| Node.js | 容器内 v20.20.2，基础镜像 `node:20-alpine` |
| npm | 容器构建时执行 `npm ci --omit=dev` 安装运行依赖 |
| Vite | 本地构建版本 5.4.21，执行 `npm run build` 生成前端资源 |
| PostgreSQL | 使用现有数据库，服务器版本未核验 |
| SSH / SFTP | 本次远程操作及部署包上传使用 Paramiko |

当前服务由 Node 直接提供静态页面和 API，新部署未配置 Nginx 或 HTTPS。

## 验证结果

- 外部首页返回 HTTP 200。
- `/api/health/database` 返回 `success: true` 和“数据库连接正常”。
- 未登录访问 `/api/auth/profile` 返回预期的 HTTP 401。
- 已只读确认现有数据库包含 6 个账号，以及 `dingtalk`、`doubaoTts`、`langfuse`、`minimax`、`server`、`tapd` 配置记录。
- 容器运行正常，Compose 配置校验通过。
- 尚未使用用户账号实测登录，也未执行设备测试及外部集成全流程。

## 运维命令

```bash
# 查看状态
 docker ps --filter name=voiceauto-web

# 查看日志
 docker logs --tail 100 voiceauto-web

# 重启
 docker restart voiceauto-web

# 使用已保存配置重建服务容器
 cd /opt/voiceauto/current
 docker compose -f compose.yml up -d
```

本次使用独立容器和空闲端口进行新部署。原服务器 `10.10.64.202:8888` 未停止；新服务依赖原服务器数据库可达，两个站点共享账号及配置数据。客户端设备桥接更新需单独处理。新站点来源 `http://10.10.64.223:8888` 需加入测试电脑桥接的 `VOICEAUTO_AUDIO_ORIGINS`，才能使用原生音频采集。
