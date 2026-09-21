# 新增 Langfuse 环境返回 HTML

原因：配置中心新增环境会生成 `/langfuse-api-env-7` 等代理前缀，旧版后端及 Nginx 只识别六个内置环境。未命中的请求回退到 `index.html`，并未取得 Langfuse JSON。

## 更新部署

1. 更新 `server/app.js` 并重启 Node 服务。Docker 部署在项目根目录运行 `docker compose -f deploy/docker/docker-compose.yml up -d --build`。
2. 如果外层 Nginx 自己提供静态首页，在对应 `server` 中加入以下通用代理（已有六个环境规则可保留）：

   ```nginx
   location /langfuse-api- {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_read_timeout 60s;
   }
   ```

   将端口改为实际后端端口；本仓库 Docker Compose 映射到宿主机的是 **8080**。`proxy_pass` 后不要加 `/`，需要保留完整请求前缀。执行 `nginx -t`，成功后执行 `nginx -s reload`。若所有请求本来就代理给 Node，则无需添加此规则。
3. 在配置中心保存 Gracy 环境，确认 `envKey` 为 `ENV_7`、代理前缀为 `/langfuse-api-env-7`，Base URL 为该环境实际 Langfuse HTTP(S) 服务地址，并填写相应 Public Key / Secret Key。配置必须保存到服务端数据库，不能仅保留在浏览器本地。
4. 重新获取日志，在浏览器网络面板检查 `/langfuse-api-env-7/api/public/traces` 的响应。应返回 JSON；未知或禁用环境返回 JSON 404，无效 Base URL 返回 JSON 400。401/403 应检查 Langfuse 密钥，502 应检查服务器至 Langfuse 的连通性。

新增环境由后端读取数据库配置解析，每次请求读取最新配置，无需为后续环境逐条增加代理规则。六个内置环境继续使用原有路由。

## 本地验证

```sh
node --test tests/backendDynamicLangfuseProxy.test.mjs tests/backendLangfuseProxy.test.mjs
npm run build
```
