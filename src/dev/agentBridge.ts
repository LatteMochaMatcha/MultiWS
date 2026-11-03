/**
 * 给 agent 用的监控、测试接口，页面这一头。只在开发服务器上由 tools/agent-monitor/plugin.mjs 塞进页面，
 * main.ts 不引用它，所以正式打包的版本里没有。
 *
 * 借 Vite 的 HMR 连接跟服务器说话：
 * - 连上时报一声（页面 id、地址、在不在前台），模型一变就把快照报上去（每秒查一次变没变）；
 * - 把控制台的警告、出错，没接住的异常转给服务器；
 * - 服务器转来 agent 的请求（要快照、跑一段代码、截图、等模型算完），做完回话。
 * 模型的状态全是从 main.ts 开发时挂在 window 上的 __oc 读的。
 */
import { Vector2 } from 'three';
import type { ViteHotContext } from 'vite/types/hot.d.ts';
import type { Viewport, ViewName } from '../view/viewport';
import { startAnnotate } from './annotate';
import { toPlain } from './plain';

/** main.ts 里 __oc 用到的那几样（只读它们，别的照原样交给 eval） */
interface OcHooks {
  spec(): Record<string, unknown>;
  mode(): string;
  buildMs(): number;
  fusedStats(): {
    triangles: number;
    box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
    info: Record<string, number>;
    draft: boolean;
    fine: boolean;
  } | null;
  figure(): { parts: { name: string; type: string }[]; scale: number; metrics: Record<string, unknown> } | null;
  character(): {
    bones: unknown[];
    meshes: unknown[];
    materials: unknown[];
    faces: unknown[];
    metrics: Record<string, unknown>;
    ignored: string[];
  } | null;
  selected(): string | null;
  rebuild(): void;
  viewport: Viewport | null;
  pose: {
    state(): { local: unknown[] } | null;
    kit(): { handles: unknown[] } | null;
  };
}

const PAGE_KEY = 'oc-agent-page';
const VIEWS: string[] = ['front', 'side', 'back', 'three', 'right', 'top', 'bottom'] satisfies ViewName[];
/** 多久查一次模型变没变 */
const POLL_MS = 1000;

const hot = import.meta.hot;
if (hot) start(hot);

function start(hot: ViteHotContext) {
  const id = pageId();
  let lastInput: number | null = null;
  let lastSent = '';

  const oc = () => (window as unknown as { __oc?: OcHooks }).__oc ?? null;
  const pageInfo = () => ({
    id,
    url: location.href,
    title: document.title,
    visible: document.visibilityState === 'visible',
    focused: document.hasFocus(),
    lastInput,
    size: [innerWidth, innerHeight],
    userAgent: navigator.userAgent,
  });
  const text = (elementId: string) => document.getElementById(elementId)?.textContent?.trim() ?? null;
  /** 左上角的读数是一格一格的 span：分开取，带 warn 的（网格断开、穿模之类）另外列出来 */
  const readout = () => {
    const cells = [...(document.getElementById('readout')?.children ?? [])];
    return {
      readout: cells.filter((c) => !c.classList.contains('warn')).map((c) => c.textContent?.trim() ?? ''),
      warnings: cells.filter((c) => c.classList.contains('warn')).map((c) => c.textContent?.trim() ?? ''),
    };
  };

  /** 页面里现在的模型：设定、读数、网格、部件、成品角色、姿势、镜头 */
  function snapshot() {
    const hooks = oc();
    const base = { at: new Date().toISOString(), pageInfo: pageInfo() };
    if (!hooks) return { ...base, ready: false, note: '页面还没跑完 main.ts（没有 window.__oc）' };
    const spec = hooks.spec();
    const stats = hooks.fusedStats();
    const figure = hooks.figure();
    const character = hooks.character();
    const canvas = hooks.viewport?.renderer.domElement;
    const pose = hooks.pose.state();
    const types: Record<string, number> = {};
    for (const part of figure?.parts ?? []) types[part.type] = (types[part.type] ?? 0) + 1;
    return {
      ...base,
      ready: true,
      mode: hooks.mode(),
      description: (document.getElementById('desc') as HTMLTextAreaElement | null)?.value ?? null,
      ...readout(),
      status: text('status'),
      selected: hooks.selected(),
      buildMs: round(hooks.buildMs()),
      // 屏幕上的融合网格（白模、素体在「融合」时）；成品角色、分部件时不显示它
      mesh:
        stats && spec.meshMode === 'fused' && !character
          ? {
              triangles: stats.triangles,
              vertices: stats.info.vertices,
              components: stats.info.components,
              voxel: stats.info.voxel,
              draft: stats.draft,
              fine: stats.fine,
              size: [stats.box.max.x - stats.box.min.x, stats.box.max.y - stats.box.min.y, stats.box.max.z - stats.box.min.z].map(round),
              info: stats.info,
            }
          : null,
      figure: figure && !character ? { scale: round(figure.scale), metrics: figure.metrics, partTypes: types, parts: figure.parts.map((p) => p.name) } : null,
      character: character
        ? {
            bones: character.bones.length,
            meshes: character.meshes.length,
            materials: character.materials.length,
            faces: character.faces.length,
            metrics: character.metrics,
            ignored: character.ignored,
          }
        : null,
      pose: hooks.mode() === 'pose' ? { bones: pose?.local.length ?? 0, handles: hooks.pose.kit()?.handles.length ?? 0 } : null,
      camera: hooks.viewport?.cameraState() ?? null,
      canvas: canvas ? [canvas.width, canvas.height] : null,
      spec,
    };
  }

  /** 变没变只看这些：快照里的时间、页面信息每次都不一样 */
  const signature = () => {
    const hooks = oc();
    if (!hooks) return 'not-ready';
    return JSON.stringify([hooks.spec(), hooks.mode(), hooks.buildMs(), hooks.fusedStats()?.triangles, hooks.fusedStats()?.draft, text('readout'), text('status'), hooks.selected(), Boolean(hooks.character())]);
  };

  /** 等模型算完：签名连着 quiet 毫秒没变、读数不是「正在生成」、屏幕上不是拖动时的粗网格 */
  async function settle({ quiet = 600, timeout = 30_000 } = {}) {
    const t0 = performance.now();
    // 标签页在后台时 requestAnimationFrame 不跑，改了设定也不会重建：替它建一次
    if (document.hidden) oc()?.rebuild();
    let last = signature();
    let since = performance.now();
    while (performance.now() - t0 < timeout) {
      await new Promise((r) => setTimeout(r, 100));
      const now = signature();
      if (now !== last) {
        last = now;
        since = performance.now();
        continue;
      }
      const busy = /正在|生成网格/.test(text('readout') ?? '') || oc()?.fusedStats()?.draft;
      if (!busy && performance.now() - since >= quiet) return { settled: true, waitedMs: Math.round(performance.now() - t0), snapshot: toPlain(snapshot()) };
    }
    return { settled: false, waitedMs: Math.round(performance.now() - t0), snapshot: toPlain(snapshot()) };
  }

  /**
   * 3D 视图的 PNG。给了 width / height、或者页面藏着（画布是 0 宽）时临时换个大小画一张；给了 view 就临时换到那个视角。
   * 画完把画布大小、镜头都还原，用户看着的画面不变。
   */
  async function screenshot({ width, height, view }: { width?: number; height?: number; view?: string }) {
    const hooks = oc();
    const vp = hooks?.viewport;
    if (!vp) throw new Error('页面里还没有 3D 视图');
    if (view && !VIEWS.includes(view)) throw new Error(`view 只能是 ${VIEWS.join(' / ')}`);
    const { renderer, camera } = vp;
    const canvas = renderer.domElement;
    const inner = vp as unknown as { pendingDir: unknown; lookFrom(dir: unknown): void };
    const before = renderer.getSize(new Vector2());
    const hidden = !canvas.width || !canvas.height;
    const size = width || height || hidden ? [width || height || 900, height || (width ? width : 1200)] : null;
    const saved = { camera: vp.cameraState(), aspect: camera.aspect, pending: inner.pendingDir };
    let shot: Promise<Blob>;
    const shotSize = [0, 0];
    // 换大小、画、取图、还原都在同一段同步代码里（toBlob 当场就把画面拷走了），看着的画面不会闪
    try {
      if (size) {
        renderer.setSize(size[0], size[1], false);
        camera.aspect = size[0] / size[1];
        camera.updateProjectionMatrix();
      }
      // 页面从打开起就没露过面：镜头还没按真实比例摆过，照它本来要摆的方向摆一次
      if (view) vp.frame(view as ViewName);
      else if (saved.pending) inner.lookFrom(saved.pending);
      shotSize[0] = canvas.width;
      shotSize[1] = canvas.height;
      shot = vp.snapshot();
    } finally {
      if (size) {
        renderer.setSize(before.x, before.y, false);
        camera.aspect = saved.aspect;
        camera.updateProjectionMatrix();
      }
      vp.setCamera(saved.camera);
      inner.pendingDir = saved.pending;
      if (!hidden) renderer.render(vp.scene, camera);
    }
    const bytes = new Uint8Array(await (await shot).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(binary), width: shotSize[0], height: shotSize[1] };
  }

  /** 跑 agent 送来的一段代码：能写成表达式就当表达式，不然当函数体（自己写 return） */
  async function run(code: string) {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
    const params = ['oc', 'settle', 'snapshot', 'toPlain'];
    let fn;
    try {
      fn = new AsyncFunction(...params, `return (${code}\n);`);
    } catch {
      fn = new AsyncFunction(...params, code);
    }
    return toPlain(await fn(oc(), settle, snapshot, toPlain));
  }

  const ops: Record<string, (args: Record<string, unknown>) => unknown> = {
    snapshot: () => toPlain(snapshot()),
    settle: (args) => settle(args as { quiet?: number; timeout?: number }),
    screenshot: (args) => screenshot(args as { width?: number; height?: number; view?: string }),
    eval: (args) => run(String(args.code)),
  };

  hot.on('oc-agent:call', async ({ id: callId, op, args }: { id: number; op: string; args: Record<string, unknown> }) => {
    try {
      const handler = ops[op];
      if (!handler) throw new Error(`页面不认识这个请求：${op}`);
      hot.send('oc-agent:reply', { id: callId, ok: true, value: await handler(args ?? {}) });
    } catch (err) {
      // 栈里 Vite 客户端和这个文件自己的那几层对 agent 没用
      const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
      const error = stack
        .split('\n')
        .filter((line) => line.includes('<anonymous>:') || !/@vite\/client|agentBridge\.ts|^\s+at Array\.map/.test(line))
        .join('\n');
      hot.send('oc-agent:reply', { id: callId, ok: false, error });
    }
  });

  const hello = () => hot.send('oc-agent:hello', pageInfo());
  hello();
  // 服务器重启以后重新连上：再报一次到
  hot.on('vite:ws:connect', hello);

  const reportPage = () => hot.send('oc-agent:page', pageInfo());
  document.addEventListener('visibilitychange', reportPage);
  window.addEventListener('focus', reportPage);
  window.addEventListener('blur', reportPage);
  // 记下用户最后一次动页面的时间：agent 看这个分辨哪个页面有人在用，别去动别人正在用的
  for (const type of ['pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(type, () => (lastInput = Date.now()), { capture: true, passive: true });
  }

  window.setInterval(() => {
    let sig: string;
    try {
      sig = signature();
    } catch {
      return;
    }
    if (sig === lastSent) return;
    lastSent = sig;
    hot.send('oc-agent:state', { id, snapshot: toPlain(snapshot()) });
  }, POLL_MS);

  forwardConsole(hot, id);

  // 3D 视图左下角的「标注」：画红圈、写一句话，存成问题单（见 annotate.ts）
  startAnnotate(hot, {
    canvas: () => oc()?.viewport?.renderer.domElement ?? null,
    context: () => ({ page: pageInfo(), snapshot: toPlain(snapshot()) as Record<string, unknown> }),
  });
}

/** 控制台的输出、没接住的异常转给服务器（原样照常打印） */
function forwardConsole(hot: ViteHotContext, id: string) {
  const send = (level: 'error' | 'warn' | 'info', parts: unknown[]) => {
    const message = parts
      .map((part) => (typeof part === 'string' ? part : part instanceof Error ? (part.stack ?? part.message) : JSON.stringify(toPlain(part, { depth: 3, items: 20 }))))
      .join(' ');
    // Vite 自己的连接提示不用转
    if (message.startsWith('[vite]')) return;
    try {
      hot.send('oc-agent:log', { id, level, text: message.slice(0, 4000) });
    } catch {
      // 连接断着就算了
    }
  };
  for (const [method, level] of [['error', 'error'], ['warn', 'warn'], ['info', 'info'], ['log', 'info']] as const) {
    const original = console[method].bind(console);
    console[method] = (...parts: unknown[]) => {
      send(level, parts);
      original(...parts);
    };
  }
  window.addEventListener('error', (event) => send('error', [`[未捕获] ${event.message}`, event.error ?? `${event.filename}:${event.lineno}`]));
  window.addEventListener('unhandledrejection', (event) => send('error', ['[未处理的 Promise 拒绝]', event.reason]));
}

/** 同一个标签页刷新以后还是同一个 id */
function pageId() {
  try {
    const old = sessionStorage.getItem(PAGE_KEY);
    if (old) return old;
  } catch {
    // 存不了就每次新起一个
  }
  const id = Math.random().toString(36).slice(2, 8);
  try {
    sessionStorage.setItem(PAGE_KEY, id);
  } catch {
    // 同上
  }
  return id;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
