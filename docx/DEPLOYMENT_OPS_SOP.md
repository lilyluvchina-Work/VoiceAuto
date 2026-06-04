# VoiceAuto 运维部署精简 SOP

## 1. 适用范围

- 适用于 VoiceAuto 前端生产发布与紧急回滚。
- 目标是 10-15 分钟完成一次标准上线。

## 2. 上线前检查

- 服务器安全组已放行 22/80/443。
- 服务器已安装 Nginx 与 rsync。
- 本地代码已拉取目标分支并完成构建。
- 已确认 Nginx 站点配置包含以下代理路径：
  - /langfuse-api-uat/
  - /langfuse-api-test/
  - /langfuse-api-prod/
  - /tapd-api/

## 3. 标准上线流程

### 步骤 1：本地构建

```bash
npm install
npm run build
```

### 步骤 2：上传新版本

```bash
rsync -avz --delete dist/ root@YOUR_SERVER_IP:/var/www/voice-auto-release-v20260601/
```

说明：目录名按版本号或时间戳递增，避免覆盖旧版本。

### 步骤 3：切换线上目录

```bash
ssh root@YOUR_SERVER_IP
ln -sfn /var/www/voice-auto-release-v20260601 /var/www/voice-auto
```

### 步骤 4：校验并重载 Nginx

```bash
nginx -t
systemctl reload nginx
```

### 步骤 5：上线验证

- 访问首页：页面可打开。
- 刷新业务路由：不出现 404。
- 打开浏览器网络面板：
  - /langfuse-api-* 请求返回 2xx/3xx。
  - /tapd-api/ 请求返回 2xx/3xx。

## 4. 紧急回滚 SOP

### 场景

- 上线后出现白屏、核心功能不可用、接口大量失败。

### 回滚步骤

```bash
ssh root@YOUR_SERVER_IP
ln -sfn /var/www/voice-auto-release-vPREVIOUS /var/www/voice-auto
nginx -t
systemctl reload nginx
```

### 回滚后检查

- 首页恢复正常。
- 关键功能链路恢复。
- Nginx error.log 无持续新增严重错误。

## 5. 常见故障快速排查

### 页面 404 或白屏

- 检查 /var/www/voice-auto/index.html 是否存在。
- 检查站点配置是否包含 try_files $uri $uri/ /index.html;

### 代理接口失败

- 检查 Nginx 配置中四条代理 location 是否存在。
- 检查服务器到上游域名连通性。

### Nginx 重载失败

```bash
nginx -t
journalctl -u nginx --since "10 min ago"
```

## 6. 值班交接模板

- 发布版本：
- 发布时间：
- 发布人：
- 变更摘要：
- 验证结果：
- 是否回滚：
- 回滚时间（如有）：
- 遗留风险：

## 7. 关联文档

- 详细部署说明：docx/DEPLOYMENT.md
- 服务器部署指南：docx/SERVER_DEPLOYMENT_GUIDE.md
