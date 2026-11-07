import { defineConfig } from 'vitest/config';
import { agentMonitor } from './tools/agent-monitor/plugin.mjs';

export default defineConfig({
  // 打包出来的网页里全用相对地址：放在网站的根上、某个子文件夹里都能用
  base: './',
  // 开发服务器上给 agent 用的监控测试接口 /__agent/（打包时不生效），见 docs/agent-monitor.md
  plugins: [agentMonitor()],
  server: { port: 5173 },
  worker: { format: 'es' },
  build: {
    // 手机上自带的浏览器内核常常偏旧（装成安卓应用时用的就是它）：语法只用到 2020 年前后的浏览器都认的。
    // 没装 Google Play 的国行安卓 10 手机 WebView 停在 83（vivo Y30 标准版）；线程要用 module Worker，最低就是 Chrome 80。
    // 新加的函数改写不了，缺的在 src/polyfill.ts 里补
    target: ['es2020', 'chrome80', 'edge80', 'firefox78', 'safari14'],
    // three.js 本身就有几百 KB，不用为这个报警
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // 融合网格的测试要算好几秒：电脑同时在忙别的事（拷大文件之类）时会慢上几倍，默认的 5 秒不够
    testTimeout: 30_000,
  },
});
