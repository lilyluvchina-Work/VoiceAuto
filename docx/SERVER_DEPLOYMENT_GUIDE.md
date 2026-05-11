# VoiceAuto 服务器部署指南（公网 IP / 域名访问）

## 1. 文档目标

- 目标：把本地 VoiceAuto 项目部署到服务器，让他人可通过公网 IP 或域名访问。
- 适用范围：当前仓库（Vite 前端项目）。
- 结果形态：Nginx 托管前端静态资源，并代理项目所需接口。

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

## 3. 部署方式说明（按本项目实际）

当前项目是 Vite 前端，生产部署建议如下：

- 前端：`npm run build` 后的 `dist` 目录，交给 Nginx 直接托管。
- API：使用 Nginx 反向代理处理以下路径：
  - `/langfuse-api-uat`
  - `/langfuse-api-test`
  - `/langfuse-api-prod`
  - `/tapd-api`

说明：以上代理在本地开发时由 Vite 处理；上线后需由 Nginx 接管，否则接口会跨域或 404。

## 4. 标准部署步骤

### 步骤 1：本地构建前端产物

在本地项目根目录执行：

```bash
npm install
npm run build
```

构建完成后，确认存在 `dist` 目录。

### 步骤 2：安装服务器基础环境

登录服务器执行：

```bash
sudo apt update
sudo apt install -y nginx rsync
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 步骤 3：上传前端文件到服务器

在本地机器执行（将 IP 改为你的服务器 IP）：

```bash
rsync -avz --delete dist/ root@YOUR_SERVER_IP:/var/www/voice-auto/
```

若你使用普通用户：

```bash
rsync -avz --delete dist/ your_user@YOUR_SERVER_IP:/var/www/voice-auto/
```

### 步骤 4：配置 Nginx 站点

在服务器创建配置文件：

```bash
sudo nano /etc/nginx/sites-available/voice-auto
```

写入以下配置（替换 `server_name`）：

```nginx
server {
    listen 80;
    server_name YOUR_SERVER_IP_OR_DOMAIN;

    root /var/www/voice-auto;
    index index.html;

    # 前端路由回退（SPA）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Langfuse 代理（与前端路径保持一致）
    location /langfuse-api-uat/ {
        proxy_pass https://monitor-live-test-cedar.sdmc.tv/;
        proxy_set_header Host monitor-live-test-cedar.sdmc.tv;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /langfuse-api-test/ {
        proxy_pass https://monitor-live-test-cedar.sdmc.tv/;
        proxy_set_header Host monitor-live-test-cedar.sdmc.tv;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /langfuse-api-prod/ {
        proxy_pass https://monitor-live-test-cedar.sdmc.tv/;
        proxy_set_header Host monitor-live-test-cedar.sdmc.tv;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # TAPD API 代理
    location /tapd-api/ {
        proxy_pass https://api.tapd.cn/;
        proxy_set_header Host api.tapd.cn;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

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

- 检查 `/langfuse-api-*` 和 `/tapd-api` 的 `location` 是否存在
- 检查目标域名网络可达性（服务器可否访问外网）

### 7.3 刷新后白屏或 404

- 确认已配置：`try_files $uri $uri/ /index.html;`

## 8. 一键检查清单（上线前）

- 已完成 `npm run build`
- `dist` 已上传到 `/var/www/voice-auto`
- Nginx 配置已启用并 `nginx -t` 通过
- 安全组已开放 80/443/22
- 公网 IP 可访问主页
- 域名解析已生效（如使用域名）
- HTTPS 可用（如已申请证书）
