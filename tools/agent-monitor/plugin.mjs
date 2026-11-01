/**
 * 给 agent 用的监控、测试接口（只挂在开发服务器上，`vite build` 打出来的东西里没有它）。
 *
 * 服务器这一头：在 /__agent/ 下开几个 HTTP 接口，记下服务器自己的日志和改过的文件；
 * 页面那一头是 src/dev/agentBridge.ts（这里把它塞进 index.html），借 Vite 的 HMR 连接把页面里的模型报上来，
 * 替接口在页面里跑代码、截图。agent 只要 curl（或 `npm run agent -- 命令`）就能读到正在跑的模型和服务器，
 * 不用开浏览器工具。接口一览：curl http://localhost:5173/__agent/ ；说明见 docs/agent-monitor.md。
 *
 * 只认本机来的请求；带着别的网站的 Origin 的一律拒绝（别的网页不能借用户的浏览器来调它）。
 */
import { version as viteVersion } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFIX = '/__agent';
const BRIDGE = '/src/dev/agentBridge.ts';
/** 日志、模型变化、改过的文件各留多少条 */
const LOG_LIMIT = 600;
const HISTORY_LIMIT = 120;
const FILE_LIMIT = 60;
/** 断开的页面留几个（看「刚才那个页面最后是什么样」用） */
const GONE_LIMIT = 8;
/** 问页面的默认等待时间：标签页在后台时浏览器会把它压慢 */
const CALL_TIMEOUT = 15_000;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

const ENDPOINTS = {
  'GET  /__agent/': '这张表',
  'GET  /__agent/server': '开发服务器：进程、端口、运行多久、内存、最近改过的文件、日志计数',
  'GET  /__agent/pages': '连着服务器的页面：哪个在前台、多久没人动、最后一次报上来的模型',
  'GET  /__agent/model': '页面里现在的模型（实时问页面；页面没回就给最后一次的快照，带 stale: true）',
  'GET  /__agent/spec': '只要设定（BodySpec）',
  'GET  /__agent/settle': '等页面把模型算完（网格不再变）再给快照；?quiet=毫秒 &timeout=毫秒',
  'GET  /__agent/screenshot': '3D 视图的 PNG（透明背景）；?view=front|side|back|three|right|top|bottom &width= &height=（页面藏着时缺省 900×1200）；画完镜头还原',
  'GET  /__agent/history': '最近的模型变化（谁、什么时候、改成了什么）；?limit=',
  'GET  /__agent/logs': '服务器和页面的日志；?level=error|warn|info &source=server|page &since=序号 &limit=',
  'POST /__agent/eval': '请求体是一段 JS，在页面里跑（能用 oc = window.__oc、settle()、snapshot()），回结果',
  '通用参数': '?page=页面 id（或开头几位）选页面，缺省选前台、最近有人动过的那个；?timeout=毫秒',
};

/** @returns {import('vite').Plugin} */
export function agentMonitor() {
  const startedAt = Date.now();
  /** @type {{seq:number, at:number, source:'server'|'page', level:'error'|'warn'|'info', text:string, page?:string}[]} */
  const logs = [];
  let logSeq = 0;
  /** @type {Map<string, any>} 页面 id → 页面 */
  const pages = new Map();
  /** @type {{at:number, page:string, change:Record<string, unknown>}[]} */
  const history = [];
  /** @type {{at:number, event:string, file:string}[]} */
  const files = [];
  /** @type {Map<number, {resolve:Function, reject:Function, timer:any}>} */
  const calls = new Map();
  let callSeq = 0;
  /** @type {import('vite').ViteDevServer | null} */
  let server = null;
  /** @type {import('vite').ResolvedConfig | null} */
  let config = null;

  function record(source, level, text, page) {
    logs.push({ seq: ++logSeq, at: Date.now(), source, level, text: String(text).replace(ANSI, '').slice(0, 8000), page });
    if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT);
  }

  /** 页面对外的样子（不带连接对象和快照全文） */
  function pageInfo(p) {
    const now = Date.now();
    return {
      id: p.id,
      connected: p.connected,
      url: p.url,
      title: p.title,
      visible: p.visible,
      focused: p.focused,
      size: p.size,
      userAgent: p.userAgent,
      connectedAt: iso(p.connectedAt),
      lastSeenSec: sec(now - p.lastSeen),
      lastInputSec: p.lastInput ? sec(now - p.lastInput) : null,
      snapshotSec: p.snapshotAt ? sec(now - p.snapshotAt) : null,
      ...(p.goneAt ? { goneAt: iso(p.goneAt) } : {}),
    };
  }

  /** 缺省选哪个页面：连着的 → 在前台的 → 有焦点的 → 最近有人动过的 → 最近说过话的 */
  function pickPage(want) {
    const all = [...pages.values()];
    if (want) {
      const hit = all.filter((p) => p.id === want || p.id.startsWith(want));
      if (hit.length === 1) return hit[0];
      throw httpError(404, hit.length ? `页面 id「${want}」对上了好几个，写长一点` : `没有 id 是「${want}」的页面；看 /__agent/pages`);
    }
    const score = (p) => [p.connected, p.visible, p.focused, p.lastInput ?? 0, p.lastSeen];
    all.sort((a, b) => {
      const sa = score(a), sb = score(b);
      for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] > sb[i] ? -1 : 1;
      return 0;
    });
    if (!all.length) throw httpError(503, '还没有页面连上开发服务器：在浏览器里打开工坊页面（开发服务器的地址）再试');
    return all[0];
  }

  /** 让页面做一件事，等它回话 */
  function call(page, op, args, timeout) {
    if (!page.connected) return Promise.reject(httpError(503, `页面 ${page.id} 已经断开了`));
    return new Promise((resolveCall, rejectCall) => {
      const id = ++callSeq;
      const timer = setTimeout(() => {
        calls.delete(id);
        rejectCall(httpError(504, `页面 ${page.id} 在 ${timeout} 毫秒内没回话（标签页在后台被浏览器压慢了，或者正忙着算网格）；可以加 ?timeout= 再等久一点`));
      }, timeout);
      calls.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      page.client.send('oc-agent:call', { id, op, args });
    });
  }

  function onReply({ id, ok, value, error }) {
    const pending = calls.get(id);
    if (!pending) return;
    calls.delete(id);
    clearTimeout(pending.timer);
    if (ok) pending.resolve(value);
    else pending.reject(httpError(500, `页面里出错：${error}`));
  }

  /** 页面每次报上来新的快照，记一笔「变了什么」 */
  function noteChange(page, snap) {
    const before = page.snapshot;
    page.snapshot = snap;
    page.snapshotAt = Date.now();
    if (!snap?.ready) return;
    const now = summary(snap);
    const prev = before?.ready ? summary(before) : {};
    const change = {};
    for (const key of Object.keys(now)) if (JSON.stringify(now[key]) !== JSON.stringify(prev[key])) change[key] = now[key];
    if (!Object.keys(change).length) return;
    history.push({ at: Date.now(), page: page.id, change });
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  }

  function serverInfo() {
    const mem = process.memoryUsage();
    const count = (level) => logs.filter((l) => l.level === level).length;
    let pkg = {};
    try {
      pkg = JSON.parse(readFileSync(resolve(config.root, 'package.json'), 'utf8'));
    } catch {
      // 读不到就不写
    }
    return {
      app: pkg.name ? `${pkg.name}@${pkg.version}` : null,
      pid: process.pid,
      node: process.version,
      vite: viteVersion,
      platform: `${process.platform} ${process.arch}`,
      root: config.root,
      mode: config.mode,
      urls: server?.resolvedUrls ?? null,
      startedAt: iso(startedAt),
      uptimeSec: sec(Date.now() - startedAt),
      memoryMB: { rss: mb(mem.rss), heapUsed: mb(mem.heapUsed) },
      pages: { connected: [...pages.values()].filter((p) => p.connected).length, total: pages.size },
      logs: { errors: count('error'), warnings: count('warn'), lastSeq: logSeq },
      recentFiles: files.slice(-20).reverse().map((f) => ({ at: iso(f.at), event: f.event, file: f.file })),
    };
  }

  async function handle(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return next();
    const route = url.pathname.slice(PREFIX.length).replace(/\/+$/, '') || '/';
    const q = url.searchParams;
    const timeout = clampInt(q.get('timeout'), CALL_TIMEOUT, 500, 300_000);
    try {
      const refusal = refuse(req);
      if (refusal) throw httpError(403, refusal);
      const method = req.method ?? 'GET';
      const want = (m) => {
        if (method !== m) throw httpError(405, `这个接口要用 ${m}`);
      };
      switch (route) {
        case '/':
          return json(res, 200, { endpoints: ENDPOINTS, docs: 'docs/agent-monitor.md' });
        case '/server':
          want('GET');
          return json(res, 200, serverInfo());
        case '/pages':
          want('GET');
          return json(res, 200, [...pages.values()].map((p) => ({ ...pageInfo(p), summary: p.snapshot?.ready ? summary(p.snapshot) : null })));
        case '/model':
        case '/spec': {
          want('GET');
          const page = pickPage(q.get('page'));
          let snap;
          let stale = null;
          if (q.get('cached') === '1') stale = '要的就是缓存';
          else {
            try {
              snap = await call(page, 'snapshot', {}, timeout);
              noteChange(page, snap);
            } catch (err) {
              stale = err.message;
            }
          }
          if (!snap) {
            snap = page.snapshot;
            if (!snap) throw httpError(504, `页面 ${page.id} 没回话，也还没报过快照：${stale}`);
          }
          const meta = { page: page.id, stale: Boolean(stale), ...(stale ? { staleReason: stale, snapshotAgeSec: sec(Date.now() - page.snapshotAt) } : {}) };
          return json(res, 200, route === '/spec' ? { ...meta, spec: snap.spec ?? null } : { ...meta, ...snap });
        }
        case '/settle': {
          want('GET');
          const page = pickPage(q.get('page'));
          const quiet = clampInt(q.get('quiet'), 600, 50, 60_000);
          const wait = clampInt(q.get('timeout'), 30_000, 500, 300_000);
          // 页面那边自己数 wait 毫秒，这边多等一会儿收它的回话
          const snap = await call(page, 'settle', { quiet, timeout: wait }, wait + 5_000);
          noteChange(page, snap.snapshot);
          return json(res, 200, { page: page.id, settled: snap.settled, waitedMs: snap.waitedMs, ...snap.snapshot });
        }
        case '/screenshot': {
          want('GET');
          const page = pickPage(q.get('page'));
          const size = (key) => (q.has(key) ? clampInt(q.get(key), 0, 16, 4096) : undefined);
          const shot = await call(page, 'screenshot', { width: size('width'), height: size('height'), view: q.get('view') ?? undefined }, timeout);
          const png = Buffer.from(shot.base64, 'base64');
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': png.length,
            'cache-control': 'no-store',
            'x-oc-page': page.id,
            'x-oc-size': `${shot.width}x${shot.height}`,
          });
          return res.end(png);
        }
        case '/history':
          want('GET');
          return json(res, 200, history.slice(-clampInt(q.get('limit'), 30, 1, HISTORY_LIMIT)).map((h) => ({ at: iso(h.at), page: h.page, change: h.change })));
        case '/logs': {
          want('GET');
          const levels = { error: ['error'], warn: ['error', 'warn'], info: ['error', 'warn', 'info'] }[q.get('level') ?? 'info'] ?? ['error', 'warn', 'info'];
          const since = clampInt(q.get('since'), 0, 0, Number.MAX_SAFE_INTEGER);
          const source = q.get('source');
          const pageId = q.get('page');
          const hit = logs.filter(
            (l) => l.seq > since && levels.includes(l.level) && (!source || l.source === source) && (!pageId || l.page?.startsWith(pageId)),
          );
          const limit = clampInt(q.get('limit'), 100, 1, LOG_LIMIT);
          return json(res, 200, { lastSeq: logSeq, logs: hit.slice(-limit).map((l) => ({ ...l, at: iso(l.at) })) });
        }
        case '/eval': {
          want('POST');
          const body = await readBody(req);
          let code = body;
          let pageWant = q.get('page');
          if (/^\s*\{/.test(body) && (req.headers['content-type'] ?? '').includes('json')) {
            const parsed = JSON.parse(body);
            code = parsed.code;
            pageWant = parsed.page ?? pageWant;
          }
          if (!code?.trim()) throw httpError(400, '请求体里没有代码');
          const page = pickPage(pageWant);
          record('page', 'info', `[agent eval] ${code.length > 300 ? `${code.slice(0, 300)}…` : code}`, page.id);
          const value = await call(page, 'eval', { code }, timeout);
          return json(res, 200, { page: page.id, value });
        }
        default:
          throw httpError(404, `没有这个接口：${url.pathname}；看 ${PREFIX}/`);
      }
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) record('server', 'warn', `[agent] ${req.method} ${url.pathname}: ${err.message}`);
      return json(res, status, { error: err.message });
    }
  }

  return {
    name: 'oc-agent-monitor',
    apply: 'serve',

    configResolved(resolved) {
      config = resolved;
      // 把开发服务器自己的输出（热更新、编译出错、警告）也记下来
      const { logger } = resolved;
      for (const [method, level] of [['info', 'info'], ['warn', 'warn'], ['warnOnce', 'warn'], ['error', 'error']]) {
        const original = logger[method].bind(logger);
        logger[method] = (msg, options) => {
          record('server', level, msg);
          return original(msg, options);
        };
      }
    },

    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: BRIDGE }, injectTo: 'body' }];
    },

    configureServer(devServer) {
      server = devServer;
      const { ws } = devServer;

      ws.on('oc-agent:hello', (data, client) => {
        const old = pages.get(data.id);
        const page = {
          ...(old ?? {}),
          ...data,
          client,
          connected: true,
          connectedAt: old?.connected && old.client === client ? old.connectedAt : Date.now(),
          lastSeen: Date.now(),
          goneAt: undefined,
        };
        pages.set(data.id, page);
        // 页面刚打开时可能连报两次到（模块跑起来一次、连接建好一次）
        if (!old?.connected || old.client !== client) record('page', 'info', `[agent] 页面连上了：${data.id} ${data.url}`, data.id);
      });
      ws.on('oc-agent:page', (data, client) => {
        const page = pages.get(data.id);
        if (!page) return;
        Object.assign(page, data, { client, lastSeen: Date.now() });
      });
      ws.on('oc-agent:state', ({ id, snapshot }) => {
        const page = pages.get(id);
        if (!page) return;
        page.lastSeen = Date.now();
        noteChange(page, snapshot);
      });
      ws.on('oc-agent:log', ({ id, level, text }) => {
        const page = pages.get(id);
        if (page) page.lastSeen = Date.now();
        record('page', level, text, id);
      });
      ws.on('oc-agent:reply', (data) => onReply(data));
      ws.on('vite:client:disconnect', (_data, client) => {
        for (const page of pages.values()) {
          if (page.client !== client || !page.connected) continue;
          page.connected = false;
          page.goneAt = Date.now();
          record('page', 'info', `[agent] 页面断开了：${page.id}`, page.id);
        }
        const gone = [...pages.values()].filter((p) => !p.connected).sort((a, b) => b.goneAt - a.goneAt);
        for (const page of gone.slice(GONE_LIMIT)) pages.delete(page.id);
      });

      devServer.watcher.on('all', (event, file) => {
        if (file.includes('node_modules')) return;
        files.push({ at: Date.now(), event, file: file.startsWith(config.root) ? file.slice(config.root.length + 1) : file });
        if (files.length > FILE_LIMIT) files.splice(0, files.length - FILE_LIMIT);
      });

      // 直接挂上（不等 Vite 自己的中间件）：/__agent/ 不该被当成页面或模块去处理
      devServer.middlewares.use((req, res, next) => {
        handle(req, res, next).catch(next);
      });
    },
  };
}

/** 不是本机、不是 localhost 的地址、或者是别的网页借浏览器发来的，就拒绝；能接受就返回 null */
export function refuse(req) {
  const remote = req.socket?.remoteAddress ?? '';
  if (!LOOPBACK.has(remote)) return `只接受本机的请求（这次来自 ${remote}）`;
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host) && !host.endsWith('.localhost')) return `Host 不是本机地址：${host}`;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return `不接受别的网页发来的请求（Origin: ${origin}）`;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return `不接受别的网页发来的请求（Sec-Fetch-Site: ${site}）`;
  return null;
}

/** 历史里比的那几项：看一眼就知道「这次变了什么」 */
function summary(snap) {
  const spec = snap.spec ?? {};
  return {
    mode: snap.mode,
    description: snap.description,
    bodyStyle: spec.bodyStyle,
    character: spec.bodyStyle === 'character' ? spec.character : undefined,
    meshMode: spec.meshMode,
    readout: snap.readout,
    warnings: snap.warnings?.length ? snap.warnings : undefined,
    status: snap.status,
    selected: snap.selected,
    triangles: snap.mesh?.triangles,
    components: snap.mesh?.components,
  };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function json(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectBody(httpError(413, '请求体太大'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

function clampInt(raw, fallback, lo, hi) {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const sec = (ms) => Math.round(ms / 100) / 10;
const mb = (bytes) => Math.round(bytes / 1048576);
