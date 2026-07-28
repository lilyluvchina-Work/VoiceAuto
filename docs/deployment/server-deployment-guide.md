# VoiceAuto 服务器部署指南（公网 IP / 域名访问）

## 1. 文档目标

- 目标：把本地 VoiceAuto 项目部署到服务器，让他人可通过公网 IP 或域名访问。
- 适用范围：当前仓库（Vite 前端 + Node 后端 + PostgreSQL）。
- 结果形态：推荐 Docker 运行 Node 后端服务，由后端同时提供前端静态资源、登录接口、用户接口和配置接口；也可使用服务器 Nginx 托管静态资源并反向代理接口。
- 交接要求：部署资产放在项目内维护，但部署包输出到项目目录外。

## 1.1 部署资产目录（项目内，便于复用和交接）

```text
deploy/
├── scripts/
│   ├── build_deploy_bundle.ps1
│   └── build_deploy_bundle.sh
├── nginx/
│   ├── voice-auto.server.conf.template
│   └── langfuse-proxy.conf.example
└── docker/
    ├── Dockerfile
    ├── nginx.default.conf
    └── docker-compose.yml
```

说明：

- 上述文件全部保留在项目里，作为标准部署资产。
- 真正用于发版/交付的部署包由脚本生成到项目外目录（避免污染仓库）。

## 2. 你需要准备的东西

### 2.1 基础资源

- 一台 Linux 云服务器（推荐 Ubuntu 22.04）
- 服务器公网 IP
- 能登录服务器的 SSH 账号（root 或 sudo 用户）
- 项目代码（本地仓库）

建议最低配置：

- 1 核 2G（测试环境）
- 2 核 4G（多人并发体验更稳定）

### 2.2 网络与安全

云服务器安全组放行：

- 22（SSH）
- 80（HTTP）
- 443（HTTPS，可选但推荐）

### 2.3 可选资源

- 域名（如 `voiceauto.example.com`）
- 证书申请能力（Certbot）

### 2.4 数据库资源

当前系统登录账号、用户管理和配置中心依赖 PostgreSQL。部署前需要准备：

- PostgreSQL 15+ 或服务器已安装的兼容版本
- `DATABASE_URL`，格式示例：`postgresql://voiceauto_app:<password>@127.0.0.1:5432/voiceauto`
- 已创建系统登录账号，例如 `LilyLuv`

## 3. 部署方式说明（按本项目实际）

当前项目包含 Vite 前端和 Node 后端，生产部署建议如下：

- 推荐方式：Docker 启动 Node 后端服务，镜像内包含 `dist`、`server`、`scripts` 和默认配置文件。
- 后端职责：提供 `/api/auth/*`、`/api/users`、`/api/configs/*`，并托管前端构建产物。
- 数据库存储：配置中心数据保存到 PostgreSQL `app_config` 表，应用访问配置接口时会自动建表。

如果使用传统服务器 Nginx 静态部署：

- 前端：`npm run build` 后的 `dist` 目录，交给 Nginx 直接托管。
- API：使用 Nginx 反向代理处理以下路径：
  - `/api/auth`
  - `/api/users`
  - `/api/configs`
  - `/langfuse-api-uat`
  - `/langfuse-api-test`
  - `/langfuse-api-prod`
  - `/tapd-api`

说明：以上代理在本地开发时由 Vite 处理；上线后需由 Nginx 接管，否则接口会跨域或 404。

## 4. 标准部署步骤

### 步骤 1：本地生成部署包（输出到项目外目录）

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File deploy/scripts/build_deploy_bundle.ps1
```

Linux/macOS：

```bash
bash deploy/scripts/build_deploy_bundle.sh
```

脚本默认输出目录：

- Windows: `%USERPROFILE%/voiceauto-deploy-bundles`
- Linux/macOS: `$HOME/voiceauto-deploy-bundles`

可自定义输出目录（必须是项目目录外）：

```powershell
powershell -ExecutionPolicy Bypass -File deploy/scripts/build_deploy_bundle.ps1 -OutputRoot "D:\deploy-output"
```

```bash
bash deploy/scripts/build_deploy_bundle.sh /data/deploy-output
```

生成结果目录示例：

```text
D:\deploy-output\voiceauto-20260511-220000
```

或：

```text
/data/deploy-output/voiceauto-20260511-220000
```

目录内容包括：

```text
dist/
deploy/nginx/
deploy/docker/
server-deployment-guide.md
```

### 步骤 2：安装服务器基础环境

登录服务器执行：

```bash
sudo apt update
sudo apt install -y nginx rsync
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 步骤 3：上传部署包中的 dist 到服务器

先进入你本机生成的部署包目录（示例路径）：

```bash
cd /path/to/voiceauto-20260511-220000
```

上传前端文件：

```bash
rsync -avz --delete dist/ root@YOUR_SERVER_IP:/var/www/voice-auto/
```

若你使用普通用户：

```bash
rsync -avz --delete dist/ your_user@YOUR_SERVER_IP:/var/www/voice-auto/
```

### 步骤 4：配置 Nginx 站点

优先使用项目内模板：`deploy/nginx/voice-auto.server.conf.template`。

在服务器创建配置文件：

```bash
sudo nano /etc/nginx/sites-available/voice-auto
```

将模板内容复制进去，替换 `YOUR_SERVER_IP_OR_DOMAIN`。

启用配置并重载 Nginx：

```bash
sudo ln -sf /etc/nginx/sites-available/voice-auto /etc/nginx/sites-enabled/voice-auto
sudo nginx -t
sudo systemctl reload nginx
```

### 步骤 5：公网访问验证

浏览器访问：

- `http://YOUR_SERVER_IP`
- 或 `http://YOUR_DOMAIN`

检查点：

- 页面可正常打开
- 刷新任意前端路由不会 404
- Langfuse/TAPD 功能请求不报跨域

## 4.1 Docker 部署（可选）

当前版本推荐容器化部署，可直接使用项目内文件：

- `deploy/docker/Dockerfile`
- `deploy/docker/docker-compose.yml`
- `deploy/docker/nginx.default.conf`

在项目根目录执行：

```bash
docker compose -f deploy/docker/docker-compose.yml up -d --build
```

如果需要指定外部 PostgreSQL，请在 compose 环境变量或服务器环境中配置：

```bash
DATABASE_URL=postgresql://voiceauto_app:<password>@127.0.0.1:5432/voiceauto
```

首次部署或默认配置变更后，执行默认配置导入：

```bash
docker exec voiceauto-web-api-test node scripts/seedDefaultConfigs.js
```

默认访问：

- `http://SERVER_IP:8080`

## 4.2 服务器 Nginx 与 Docker 二选一建议

- 当前系统需要登录、用户管理和配置中心接口：优先 Docker 方式。
- 已有统一 Nginx 运维体系：可使用“静态文件 + Nginx 反向代理 Node 后端”方式。

## 5. 域名与 HTTPS（推荐）

### 5.1 域名解析

在域名服务商后台添加 A 记录：

- `@` -> 服务器公网 IP
- `www` -> 服务器公网 IP（可选）

### 5.2 申请 HTTPS

服务器执行：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

成功后访问：

- `https://YOUR_DOMAIN`

## 6. 发布与回滚建议

### 6.1 发布流程建议

1. 本地执行 `npm run build`
2. 上传到服务器新目录（如 `/var/www/voice-auto-release-<version>`）
3. 验证通过后再切换软链接到正式目录

### 6.2 回滚方式

- 保留上一版静态目录
- 将软链接切回上一版
- `sudo systemctl reload nginx`

## 7. 常见问题排查

### 7.1 打开页面 502 / 404

- 检查 Nginx 配置是否生效：`sudo nginx -t`
- 检查 `root` 目录是否有 `index.html`
- 检查站点配置是否正确链接到 `sites-enabled`

### 7.2 页面能开，接口失败

- 检查 Node 后端是否启动，容器方式可执行：`docker ps`
- 检查 `DATABASE_URL` 是否正确，数据库是否可连接
- 检查 `/api/auth/*`、`/api/users`、`/api/configs/*` 是否能访问
- 检查 `/langfuse-api-*` 和 `/tapd-api` 的 `location` 是否存在
- 检查目标域名网络可达性（服务器可否访问外网）

### 7.3 刷新后白屏或 404

- 确认已配置：`try_files $uri $uri/ /index.html;`

## 8. 一键检查清单（上线前）

- 已完成 `npm run build`
- Docker 镜像已重新构建并启动，或 `dist` 已上传到 `/var/www/voice-auto`
- `DATABASE_URL` 已配置，PostgreSQL 可连接
- 默认配置已导入：`node scripts/seedDefaultConfigs.js`
- 登录账号可用
- Nginx 配置已启用并 `nginx -t` 通过（如使用 Nginx）
- 安全组已开放 80/443/22
- 公网 IP 可访问主页
- 域名解析已生效（如使用域名）
- HTTPS 可用（如已申请证书）
