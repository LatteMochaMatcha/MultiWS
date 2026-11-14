/**
 * 开发服务器上的 AI 助手转发（只挂在开发服务器上，`vite build` 打出来的东西里没有它；正式版由 exe 外壳的 AiForward.cs 做同样的事）。
 *
 * 浏览器直接连 DeepSeek 这些服务商常被跨域挡住，页面就把请求发到同一个网站下的 /__ai/fwd/<http|https>/<主机>/<路径>，
 * 这里替它发出去，流式的回答原样一段段交回（见 src/ai/transport.ts）。
 * - GET /__ai/ping 回一句 oc-ai：页面靠它知道有转发；
 * - 转发要带 X-Shell: 1（照 /__shell/ 的规矩：别的网站在浏览器里发不出带这种头的跨站请求）；
 * - 只接受本机来的请求（借 agent-monitor 的 refuse）；只转发到 https，http 只许本机（Ollama）；
 * - 不带 cookie、Origin、Referer 出去。
 */
import { refuse } from '../agent-monitor/plugin.mjs';

const PREFIX = '/__ai/';
const FWD = '/__ai/fwd/';
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
/** 不往外带的请求头（逐跳的、浏览器自己的、我们自己的） */
const DROP_OUT = new Set(['host', 'origin', 'referer', 'cookie', 'x-shell', 'connection', 'content-length', 'accept-encoding', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-connection']);
/** 不往回带的回答头（fetch 已经解过压缩、长度会变） */
const DROP_BACK = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'set-cookie']);

/** /__ai/fwd/ 后面那段换回服务商的地址；不合规矩的返回 null */
export function targetOf(rest) {
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const scheme = rest.slice(0, slash);
  let url;
  try {
    url = new URL(`${scheme}://${rest.slice(slash + 1)}`);
  } catch {
    return null;
  }
  if (scheme === 'https') return url;
  if (scheme === 'http' && LOCAL.has(url.hostname)) return url;
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function fail(res, status, message) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ error: { type: 'forward_error', message } }));
}

async function handle(req, res, next) {
  const path = req.url ?? '';
  if (!path.startsWith(PREFIX)) return next();
  const why = refuse(req);
  if (why) return fail(res, 403, why);
  if (path === '/__ai/ping') {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end('oc-ai');
    return;
  }
  if (!path.startsWith(FWD)) return fail(res, 404, 'not found');
  if (req.headers['x-shell'] !== '1') return fail(res, 403, 'forbidden');
  const target = targetOf(path.slice(FWD.length));
  if (!target) return fail(res, 400, 'only https targets (or http on this computer) can be forwarded');

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || DROP_OUT.has(name) || name.startsWith('sec-')) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  const controller = new AbortController();
  // 页面停下（关了页面、点了「停」）：外面那个请求也断掉
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const upstream = await fetch(target, { method: req.method, headers, body, signal: controller.signal, redirect: 'manual' });
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, name) => {
      if (!DROP_BACK.has(name)) res.setHeader(name, value);
    });
    res.setHeader('cache-control', 'no-store');
    if (!upstream.body) {
      res.end();
      return;
    }
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (err) {
    if (controller.signal.aborted) return;
    if (!res.headersSent) fail(res, 502, `cannot reach ${target.host}: ${err?.cause?.code ?? err?.message ?? err}`);
    else res.end();
  }
}

export function aiForward() {
  return {
    name: 'oc-ai-forward',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(handle);
    },
  };
}
