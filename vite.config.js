import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react';

// Langfuse 各环境目标地址（与后端约定保持一致）
const LANGFUSE_HOSTS = {
  uat:  'https://monitor-live-test-cedar.sdmc.tv',
  test: 'https://monitor-live-test-cedar.sdmc.tv',
  prod: 'https://monitor-live-test-cedar.sdmc.tv',
};

function langfuseProxy(envSuffix) {
  return {
    target: LANGFUSE_HOSTS[envSuffix],
    changeOrigin: true,
    rewrite: (path) => path.replace(new RegExp(`^/langfuse-api-${envSuffix}`), ''),
    secure: false,
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    open: true,
    proxy: {
      '/langfuse-api-uat':  langfuseProxy('uat'),
      '/langfuse-api-test': langfuseProxy('test'),
      '/langfuse-api-prod': langfuseProxy('prod'),
      // TAPD API 代理（避免跨域限制）
      '/tapd-api': {
        target: 'https://api.tapd.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tapd-api/, ''),
        secure: false,
      },
    }
  }
})