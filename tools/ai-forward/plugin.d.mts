import type { Plugin } from 'vite';

/** 开发服务器上的 AI 助手转发：/__ai/ping、/__ai/fwd/，见 plugin.mjs 开头的说明 */
export function aiForward(): Plugin;

/** /__ai/fwd/ 后面那段换回服务商的地址；不是 https（也不是本机的 http）就返回 null */
export function targetOf(rest: string): URL | null;
