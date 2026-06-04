# VoiceAuto 部署文档

## 1. 目标

本文件用于提供一份可直接执行的部署说明，适用于当前 VoiceAuto 前端项目（Vite + React）。

部署结果：

- 通过 Nginx 或 Docker 提供静态页面服务
- 支持前端路由刷新
- 通过反向代理转发 Langfuse 与 TAPD 接口

## 2. 部署方式

本项目支持两种生产部署方式：

1. 服务器 Nginx（推荐）
2. Docker Compose（可选）

建议：已有统一运维环境时使用 Nginx；希望快速拉起一致环境时使用 Docker。

## 3. 前置条件

- 已安装 Node.js 18+
- 已执行依赖安装：npm install
- 服务器已开放端口：22, 80, 443（如启用 HTTPS）

## 4. 方式一：Nginx 部署（推荐）

### 4.1 本地打包

在项目根目录执行：

```bash
npm run build
```

构建产物目录为：

```text
dist/
```

### 4.2 生成交付包（可选）

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File deploy/scripts/build_deploy_bundle.ps1
```

Linux/macOS：

```bash
bash deploy/scripts/build_deploy_bundle.sh
```

说明：

- 交付包默认输出到项目目录外
- 建议不要将 deploy-bundles 放在仓库内

### 4.3 服务器安装 Nginx

```bash
sudo apt update
sudo apt install -y nginx rsync
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 4.4 上传静态文件

```bash
rsync -avz --delete dist/ root@YOUR_SERVER_IP:/var/www/voice-auto/
```

如使用普通用户：

```bash
rsync -avz --delete dist/ your_user@YOUR_SERVER_IP:/var/www/voice-auto/
```

### 4.5 配置站点

将模板文件 deploy/nginx/voice-auto.server.conf.template 复制到服务器：

```bash
sudo nano /etc/nginx/sites-available/voice-auto
```

替换模板中的 YOUR_SERVER_IP_OR_DOMAIN 后，执行：

```bash
sudo ln -sf /etc/nginx/sites-available/voice-auto /etc/nginx/sites-enabled/voice-auto
sudo nginx -t
sudo systemctl reload nginx
```

### 4.6 验证

检查以下项目：

- 页面可访问
- 前端路由刷新不 404
- /langfuse-api-uat, /langfuse-api-test, /langfuse-api-prod, /tapd-api 请求正常

## 5. 方式二：Docker Compose 部署（可选）

使用文件：

- deploy/docker/Dockerfile
- deploy/docker/docker-compose.yml
- deploy/docker/nginx.default.conf

在项目根目录执行：

```bash
docker compose -f deploy/docker/docker-compose.yml up -d --build
```

默认访问：

```text
http://SERVER_IP:8080
```

## 6. HTTPS（推荐）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

## 7. 发布与回滚建议

发布建议：

1. 本地执行 npm run build
2. 上传到服务器新目录（例如 /var/www/voice-auto-release-vX）
3. 验证通过后切换软链接
4. 重载 Nginx

回滚建议：

1. 保留上一版本目录
2. 将软链接切回上一版本
3. 执行 sudo systemctl reload nginx

## 8. 常见问题

### 8.1 页面 404 或白屏

- 检查 Nginx 是否配置 try_files $uri $uri/ /index.html;
- 检查 /var/www/voice-auto 下是否存在 index.html

### 8.2 接口失败

- 检查 Nginx 反向代理 location 配置是否完整
- 检查服务器到上游域名连通性

## 9. 关联文档

- 详细版服务器部署指南：docx/SERVER_DEPLOYMENT_GUIDE.md
- 项目总览：docx/README.md
