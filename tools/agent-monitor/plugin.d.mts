import type { Plugin } from 'vite';

/**
 * 给 agent 用的监控、测试接口：开发服务器上的 /__agent/，说明见 docs/agent-monitor.md。
 * notesDir：页面上画红圈存的问题单放在哪，缺省是项目里的 notes/
 */
export function agentMonitor(options?: { notesDir?: string }): Plugin;

/** 不是本机、不是 localhost 的地址、或者是别的网页借浏览器发来的，就返回拒绝的理由；能接受就返回 null */
export function refuse(req: {
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}): string | null;
