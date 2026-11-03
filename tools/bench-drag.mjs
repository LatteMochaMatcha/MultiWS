#!/usr/bin/env node
/**
 * 量拖动跟不跟手（docs/perf-plan.md 里那几张表的数）。
 *
 * 另开一个无界面的 Chrome（用户目录在系统的临时目录里，每次清空：不碰正在用的页面，也不碰存下来的设定。
 * 不能放进项目里：Chrome 会往里写 html 文件，开发服务器看见了就让所有连着的页面刷新），
 * 打开开发服务器上的工坊，载入一副身体，再用脚本：
 * - 造型：选中一条手臂，每一帧动一次操纵杆，连拖几秒；记主线程每次花多少、帧率、身体网格拖着时换了几次、
 *   拖着时身体有几帧是跟着操纵杆挪过去的（「整块挪」）、松手以后多久出预览 / 精细网格；
 * - 摆姿势：拖手上的圆点画个圈；记每次拖动花多少、帧率、松手后多久换上重新融合的那张。
 *
 *   node tools/bench-drag.mjs                         页面上现在这副身体，三种样式，造型和摆姿势都量
 *   node tools/bench-drag.mjs --styles anime --drag shape
 *   node tools/bench-drag.mjs --spec complex          三头三对手九条尾巴三对翅膀（同 bench-fusion.mjs）
 *   node tools/bench-drag.mjs --spec 文件.json         设定从文件里读
 *
 * 选项
 *   --url <地址>        开发服务器，缺省在 5173–5179 上找
 *   --spec page|default|complex|fork3|<文件>   缺省 page：问开发服务器要正在用的那一页的设定（只读）
 *   --styles a,b        anime、mannequin、character，缺省三种都量
 *   --drag shape,pose   缺省两样都量；chest 是改一下胸围（胸要重新烤）多久出预览、精细
 *   --part <部件名>      造型里拖哪个部件，缺省第一条左手臂
 *   --seconds <秒>      拖多久，缺省 3
 *   --reach <米>        摆姿势时手画的圈多大，缺省 0.15（手臂伸得直时常常够不着，身体跟过去，全身都动）
 *   --bend              摆姿势时改成弯肘：手往肩膀那边收一半再伸回去（够得着，只有这条手臂动）
 *   --save <文件>        结果存成 JSON
 *   --compare <文件>     和存下来的结果对比
 *   --chrome <路径>      Chrome 在哪
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const PORTS = [5173, 5174, 5175, 5176, 5177, 5178, 5179];
const styles = option('--styles', 'anime,mannequin,character').split(',');
const drags = option('--drag', 'shape,pose').split(',');
const seconds = Number(option('--seconds', '3'));
const reach = Number(option('--reach', '0.15'));
const bend = args.includes('--bend');
const specFrom = option('--spec', 'page');
const chromePath =
  option('--chrome') ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) =>
    existsSync(p),
  );
if (!chromePath) fail('找不到 Chrome，用 --chrome 指定');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function findServer() {
  const given = option('--url');
  if (given) return given.replace(/\/+$/, '');
  for (const port of PORTS) {
    try {
      const res = await fetch(`http://localhost:${port}/__agent/server`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return `http://localhost:${port}`;
    } catch {
      // 这个端口上没有
    }
  }
  fail('本机 5173–5179 上没找到工坊的开发服务器：先 npm run serve，或用 --url 指定');
}

/** 要量的这副身体：null 是工坊的缺省设定，再按 counts 改部件数量 */
async function loadSpec(base) {
  if (specFrom === 'page') {
    const res = await fetch(`${base}/__agent/spec?cached=1`);
    const body = await res.json();
    if (!body.spec) fail('开发服务器上没有正在用的页面的设定：换 --spec default');
    return { spec: body.spec };
  }
  if (specFrom === 'default') return { spec: null };
  if (specFrom === 'complex') return { spec: null, counts: { heads: 3, armPairs: 3, tails: 9, wingPairs: 3 }, armLayout: 'fan' };
  if (specFrom === 'fork3') return { spec: null, counts: { torsos: 3 }, armLayout: 'fan' };
  // 文件里是设定本身，或者是 node tools/agent.mjs spec 打出来的那种（设定在 spec 底下）
  const saved = JSON.parse(readFileSync(resolve(specFrom), 'utf8'));
  return { spec: saved.spec ?? saved };
}

/* ---------------- Chrome ---------------- */

const profile = join(tmpdir(), 'oc-bench-drag');

async function launch(url) {
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--use-angle=d3d11',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--window-size=1400,1000',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      url,
    ],
    { stdio: 'ignore' },
  );
  // 端口是 Chrome 自己挑的，写在用户目录里
  const portFile = resolve(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) fail('Chrome 没起来');
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && t.url.startsWith(url));
    if (!page) await sleep(100);
  }
  if (!page) fail('Chrome 里没打开工坊的页面');
  return { chrome, cdp: await connect(page.webSocketDebuggerUrl) };
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, no) => {
    ws.onopen = ok;
    ws.onerror = no;
  });
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const w = msg.id && waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.no(new Error(JSON.stringify(msg.error)));
    else w.ok(msg.result);
  };
  const send = (method, params = {}) =>
    new Promise((ok, no) => {
      const id = ++seq;
      waiting.set(id, { ok, no });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    send,
    close: () => ws.close(),
    /** 在页面里跑一段异步代码（能用 PAGE_HELPERS 里的东西），给回结果 */
    async run(src) {
      const res = await send('Runtime.evaluate', {
        expression: `(async () => { ${PAGE_HELPERS}\n${src} })()`,
        awaitPromise: true,
        returnByValue: true,
        timeout: 600_000,
      });
      if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 1500));
      return res.result.value;
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 页面里跑的 ---------------- */

const PAGE_HELPERS = String.raw`
const oc = window.__oc;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
const stats = (a) => a.length ? { n: a.length, p50: q(a, 0.5), p90: q(a, 0.9), max: q(a, 1), mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) } : { n: 0 };
// 融合网格每换一次记一笔
if (!oc.fused.__bench) {
  oc.fused.__bench = true;
  const update = oc.fused.onUpdate;
  oc.fused.onUpdate = (s) => { window.__updates.push({ at: performance.now(), draft: s.draft, fine: s.fine, tris: s.triangles, ms: s.info.ms, voxel: s.info.voxel }); update(s); };
  const posed = oc.fused.onPosed;
  oc.fused.onPosed = () => { window.__posed.push(performance.now()); posed(); };
  window.__updates = []; window.__posed = []; window.__longs = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longs.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask' });
}
const tag = (u) => (u.draft ? 'D' : u.fine ? 'F' : 'P') + (u.voxel ? '/' + (u.voxel * 1000).toFixed(1) : '');
async function until(test, timeout = 60000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) { if (test()) return Math.round(performance.now() - t0); await sleep(50); }
  return -1;
}
`;

/** 换上要量的身体和样式，等最细的网格出来 */
const SETUP = String.raw`
oc.setMode('shape');
const base = SPEC.spec ?? oc.spec();
const next = { ...base, bodyStyle: STYLE, meshMode: 'fused', counts: { ...base.counts, ...(SPEC.counts ?? {}) } };
if (SPEC.armLayout) next.armLayout = SPEC.armLayout;
oc.set(next);
await sleep(300);
// 二次元素体的数据取回来之前是先照白模人台显示的：等真的换成素体
const anime = () => oc.figure()?.parts.some((p) => p.prims.some((s) => s.kind === 'grid' && s.grid.startsWith('anime/')));
const wait = await until(() => STYLE === 'character' ? Boolean(oc.character()) : (STYLE !== 'anime' || anime()) && oc.fused.settled && oc.fusedStats()?.fine, 120000);
await sleep(1500);
const fig = oc.figure();
return { wait, parts: fig ? fig.parts.length : null, tris: oc.fusedStats()?.triangles ?? null };
`;

/** 造型：选中一条手臂，每帧动一次操纵杆 */
const SHAPE = String.raw`
oc.setMode('shape');
await sleep(300);
const names = oc.figure() ? oc.figure().parts.map((p) => p.name) : [];
const part = PART ?? names.find((n) => /^Arm_\d+_L$/.test(n)) ?? 'Arm_01_L';
oc.select(part);
await sleep(300);
const g = oc.gizmo;
const follows0 = oc.fused.follows ?? 0;
const ups0 = window.__updates.length;
const t0 = performance.now();
g.onDrag(true);
const handler = [], frames = [];
let last = performance.now();
const N = Math.round(SECONDS * 60);
for (let i = 0; i < N; i++) {
  await frame();
  const now = performance.now();
  frames.push(now - last);
  last = now;
  const a = performance.now();
  g.onChange({ position: [0.001 * i, 0.0005 * i, 0] });
  handler.push(performance.now() - a);
}
await frame();
const dragEnd = performance.now();
const follows = (oc.fused.follows ?? 0) - follows0;
g.onDrag(false);
const fineAt = await until(() => STYLE === 'character' || window.__updates.slice(ups0).some((u) => u.fine && u.at > dragEnd), 20000);
await sleep(300);
const during = window.__updates.slice(ups0).filter((u) => u.at <= dragEnd);
const gaps = during.map((u, i) => u.at - (i ? during[i - 1].at : t0));
const after = window.__updates.slice(ups0).filter((u) => u.at > dragEnd);
return {
  part,
  handlerMs: stats(handler),
  fps: +(N / ((dragEnd - t0) / 1000)).toFixed(1),
  meshUpdatesDuringDrag: during.length,
  meshPerSecond: +(during.length / ((dragEnd - t0) / 1000)).toFixed(1),
  meshGapMs: stats(gaps),
  meshDuringDrag: during.map((u) => tag(u) + ':' + Math.round(u.ms)).join(' '),
  followFrames: follows,
  afterRelease: after.map((u) => tag(u) + '@' + Math.round(u.at - dragEnd) + '(' + Math.round(u.ms) + ')').join(' '),
  previewAfterReleaseMs: (() => { const u = after.find((x) => !x.draft); return u ? Math.round(u.at - dragEnd) : -1; })(),
  fineAfterReleaseMs: (() => { const u = after.find((x) => x.fine); return u ? Math.round(u.at - dragEnd) : -1; })(),
  longTasksOver50: window.__longs.filter((l) => l.at >= t0 && l.ms > 50).length,
};
`;

/** 摆姿势：拖手上的圆点画个圈 */
const POSE = String.raw`
oc.setMode('pose');
const wait = await until(() => oc.pose.posed() && (oc.character() || oc.fusedStats()?.fine));
await sleep(1500);
const kit = oc.pose.kit();
const h = kit.handles.find((x) => x.kind === 'reach' && /Hand_L/.test(x.id)) ?? kit.handles.find((x) => x.kind === 'reach');
const ph = oc.pose.handles;
const anchor = oc.pose.frame().pos[h.anchor];
// 弯肘：手往肩膀那边收一半再伸回去（一定够得着，只有这条手臂动）
const shoulder = oc.pose.frame().pos[kit.solver.limbs[h.limb].upper];
const t0 = performance.now();
ph.onGrab(h);
const handler = [], frames = [];
let last = performance.now();
const N = Math.round(SECONDS * 60);
for (let i = 0; i < N; i++) {
  await frame();
  const now = performance.now();
  frames.push(now - last);
  last = now;
  const a = performance.now();
  const k = (i / N) * Math.PI * 2;
  if (BEND) {
    const t = 0.25 * (1 - Math.cos(k));
    ph.onDrag(h, [0, 1, 2].map((a) => anchor[a] + (shoulder[a] - anchor[a]) * t));
  } else {
    ph.onDrag(h, [anchor[0] + REACH * Math.sin(k), anchor[1] + REACH * (1 - Math.cos(k)), anchor[2] + REACH * 0.67 * Math.sin(k)]);
  }
  handler.push(performance.now() - a);
}
const dragEnd = performance.now();
ph.onRelease(h, true);
// 松手以后照姿势重新融合的那张（第一次那个网格 Worker 要先烤胸）
await sleep(10000);
const posed = window.__posed.filter((x) => x > dragEnd).map((x) => Math.round(x - dragEnd));
// 换回造型时姿势不留着：下一样式重新从存下来的姿势开始
return {
  handle: h.id,
  enterPoseMs: wait,
  vertices: oc.fusedStats()?.info.vertices ?? null,
  handlerMs: stats(handler),
  fps: +(N / ((dragEnd - t0) / 1000)).toFixed(1),
  posedAfterRelease: posed.join(' '),
  longTasksOver50: window.__longs.filter((l) => l.at >= t0 && l.ms > 50).length,
};
`;

/** 改一下胸围（胸换了样子，各档都要重新烤胸）：多久出预览、精细 */
const CHEST = String.raw`
oc.setMode('shape');
await sleep(300);
const ups0 = window.__updates.length;
const base = oc.spec();
const t0 = performance.now();
// 往小改：大的那头常常已经顶到上限，改了等于没改
oc.set({ shape: { ...base.shape, bust: Math.round((base.shape.bust - 0.13) * 100) / 100 } });
await until(() => window.__updates.slice(ups0).some((u) => u.fine), 30000);
await sleep(300);
const after = window.__updates.slice(ups0);
const when = (test) => { const u = after.find(test); return u ? Math.round(u.at - t0) : -1; };
return {
  previewMs: when((u) => !u.draft),
  fineMs: when((u) => u.fine),
  updates: after.map((u) => tag(u) + '@' + Math.round(u.at - t0) + '(' + Math.round(u.ms) + ')').join(' '),
};
`;

/* ---------------- 主流程 ---------------- */

const base = await findServer();
const spec = await loadSpec(base);
const { chrome, cdp } = await launch(`${base}/`);
const results = {};
try {
  await cdp.send('Runtime.enable');
  for (let i = 0; i < 200; i++) {
    if (await cdp.run('return Boolean(window.__oc?.gizmo)').catch(() => false)) break;
    await sleep(100);
  }
  const env = await cdp.run(String.raw`
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return { cores: navigator.hardwareConcurrency, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?' };`);
  console.error(`（${base}，${env.cores} 线程，${env.gpu}）`);
  const vars = (style) =>
    `const SPEC = ${JSON.stringify(spec)}; const STYLE = ${JSON.stringify(style)}; const SECONDS = ${seconds}; const REACH = ${reach}; const BEND = ${bend}; const PART = ${JSON.stringify(option('--part') ?? null)};\n`;
  for (const style of styles) {
    const setup = await cdp.run(vars(style) + SETUP);
    const row = { setup };
    if (drags.includes('shape')) row.shape = await cdp.run(vars(style) + SHAPE);
    if (drags.includes('pose')) row.pose = await cdp.run(vars(style) + POSE);
    if (drags.includes('chest')) row.chest = await cdp.run(vars(style) + CHEST);
    results[style] = row;
    console.log(JSON.stringify({ style, ...row }, null, 1));
  }
} finally {
  cdp.close();
  chrome.kill();
}

if (option('--save')) writeFileSync(resolve(option('--save')), JSON.stringify(results, null, 1));
if (option('--compare')) {
  const before = JSON.parse(readFileSync(resolve(option('--compare')), 'utf8'));
  const rows = [];
  const pick = {
    shape: ['handlerMs.p50', 'fps', 'meshPerSecond', 'followFrames', 'previewAfterReleaseMs', 'fineAfterReleaseMs'],
    pose: ['handlerMs.p50', 'fps', 'enterPoseMs'],
    chest: ['previewMs', 'fineMs'],
    setup: ['wait'],
  };
  const get = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
  for (const style of Object.keys(results)) {
    for (const kind of ['setup', 'shape', 'pose', 'chest']) {
      if (!results[style][kind]) continue;
      for (const path of pick[kind]) {
        rows.push(`${style.padEnd(10)} ${kind.padEnd(6)} ${path.padEnd(22)} ${String(get(before[style]?.[kind], path) ?? '—').padStart(8)} → ${String(get(results[style][kind], path)).padStart(8)}`);
      }
    }
  }
  console.log(rows.join('\n'));
}
