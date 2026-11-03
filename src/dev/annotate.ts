/**
 * 画红圈、存问题单。只在开发服务器上有：由 agentBridge 启动，main.ts 不引用它，正式打包的版本里没有。
 *
 * 3D 视图左下角多一个「标注」：点它，视图上盖一层透明的画布，用鼠标、手指画红圈，写一句话，点「存成问题单」。
 * 页面把当时屏幕上的 3D 视图（画着红圈的和不带的各一张）、红圈画在哪、页面和镜头、完整的设定和姿势、读数，
 * 借 HMR 连接送给开发服务器，服务器存进 notes/ 里的一个文件夹（tools/agent-monitor/notes.mjs）。
 * agent 用 `npm run agent -- notes` 列出来，打开图和 note.json 就能照原样复现。
 *
 * 画的时候：Ctrl+Z 撤一笔（不会撤到模型上），Esc 不存了。
 */
import type { ViteHotContext } from 'vite/types/hot.d.ts';
import { t } from '../i18n';

export interface AnnotateHooks {
  /** 3D 视图的画布（WebGL，带 preserveDrawingBuffer，读得出最后一帧） */
  canvas(): HTMLCanvasElement | null;
  /** 存的时候页面上的样子：页面、快照（设定、姿势、读数、镜头、选中的部件……） */
  context(): Record<string, unknown>;
}

/** 红笔：颜色，粗细（屏幕上的像素） */
const INK = '#e5322d';
const WIDTH = 4;
/** 存下来的图最长的一边不超过这么多像素 */
const MAX_SIDE = 1600;
/** 等服务器回话多久 */
const SAVE_TIMEOUT = 15_000;

const STYLE = `
.oc-annot{position:absolute;inset:0;z-index:30;touch-action:none}
.oc-annot canvas{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair}
.oc-annot-bar{position:absolute;left:50%;top:12px;transform:translateX(-50%);width:min(560px,calc(100% - 24px));
  display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:10px;background:var(--panel,#fff);
  box-shadow:0 2px 12px rgba(0,0,0,.18);font-size:13px;color:var(--ink,#1d2a2e)}
.oc-annot-bar textarea{font:inherit;resize:vertical;min-height:2.6em;padding:6px 8px;border-radius:6px;
  border:1px solid var(--edge,#c9d3d6);background:transparent;color:inherit}
.oc-annot-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.oc-annot-row button{font:inherit;padding:5px 10px;border-radius:6px;border:1px solid var(--edge,#c9d3d6);
  background:transparent;color:inherit;cursor:pointer}
.oc-annot-row button.main{background:var(--accent,#0f7b85);border-color:transparent;color:var(--accent-ink,#fff)}
.oc-annot-row button:disabled{opacity:.45;cursor:default}
.oc-annot-tip{color:var(--muted,#6b7a7e);font-size:12px;flex:1;min-width:10em}
`;

type Stroke = [number, number][];

export function startAnnotate(hot: ViteHotContext, hooks: AnnotateHooks) {
  const stage = document.getElementById('stage');
  const dock = stage?.querySelector('.dock');
  if (!stage || !dock) return;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const group = document.createElement('div');
  group.className = 'views';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t('问题单'));
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = t('标注');
  open.title = t('在 3D 视图上画红圈、写一句话，存成问题单给 Claude 看（只在开发服务器上有）');
  group.append(open);
  dock.append(group);

  /** 画好的几笔，坐标按画布的宽高算（0–1），换了窗口大小也画得回去 */
  let strokes: Stroke[] = [];
  let layer: { root: HTMLDivElement; canvas: HTMLCanvasElement; text: HTMLTextAreaElement; tip: HTMLSpanElement; save: HTMLButtonElement } | null = null;

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, lineWidth: number) => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokes) {
      ctx.beginPath();
      stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      // 只点了一下：画一个点
      if (stroke.length === 1) ctx.lineTo(stroke[0][0] * w + 0.01, stroke[0][1] * h);
      ctx.stroke();
    }
  };
  const redraw = () => {
    if (!layer) return;
    const { canvas } = layer;
    const ratio = devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * ratio);
    const h = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, WIDTH * ratio);
  };

  const close = () => {
    layer?.root.remove();
    layer = null;
    strokes = [];
    open.setAttribute('aria-pressed', 'false');
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', redraw);
  };
  // 画的时候 Ctrl+Z 撤的是一笔，Esc 不存了；都不交给工坊（不然撤到模型上）
  const onKey = (event: KeyboardEvent) => {
    if (!layer) return;
    const typing = event.target === layer.text;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.stopPropagation();
      strokes.pop();
      redraw();
    } else if (!typing) {
      event.stopPropagation();
    }
  };

  const begin = () => {
    if (layer) return;
    const root = document.createElement('div');
    root.className = 'oc-annot';
    const canvas = document.createElement('canvas');
    const bar = document.createElement('div');
    bar.className = 'oc-annot-bar';
    const text = document.createElement('textarea');
    text.placeholder = t('哪里不对？写一句（也可以不写，只画圈）');
    text.rows = 2;
    const row = document.createElement('div');
    row.className = 'oc-annot-row';
    const button = (label: string, onClick: () => void, main = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (main) b.className = 'main';
      b.addEventListener('click', onClick);
      row.append(b);
      return b;
    };
    const tip = document.createElement('span');
    tip.className = 'oc-annot-tip';
    tip.textContent = t('在 3D 视图上画红圈；Ctrl+Z 撤一笔，Esc 不存了');
    const save = button(t('存成问题单'), () => void submit(), true);
    button(t('撤一笔'), () => {
      strokes.pop();
      redraw();
    });
    button(t('清空'), () => {
      strokes = [];
      redraw();
    });
    button(t('不存了'), close);
    row.append(tip);
    bar.append(text, row);
    root.append(canvas, bar);
    stage.append(root);
    layer = { root, canvas, text, tip, save };
    open.setAttribute('aria-pressed', 'true');

    let current: Stroke | null = null;
    const at = (event: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [(event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height];
    };
    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      current = [at(event)];
      strokes.push(current);
      redraw();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!current) return;
      current.push(at(event));
      redraw();
    });
    const end = () => (current = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', redraw);
    redraw();
    text.focus();
  };

  /** 当时屏幕上的 3D 视图，铺上页面的底色；ink：画不画红圈 */
  const picture = (gl: HTMLCanvasElement, ink: boolean): string => {
    const k = Math.min(1, MAX_SIDE / Math.max(gl.width, gl.height));
    const w = Math.max(1, Math.round(gl.width * k));
    const h = Math.max(1, Math.round(gl.height * k));
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = background();
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(gl, 0, 0, w, h);
    if (ink) draw(ctx, w, h, Math.max(2, WIDTH * (devicePixelRatio || 1) * k));
    return out.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  };
  const background = () => {
    for (const el of [stage, document.body]) {
      const color = getComputedStyle(el).backgroundColor;
      if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color;
    }
    return '#e9eef0';
  };

  const submit = async () => {
    if (!layer) return;
    const gl = hooks.canvas();
    const { text, tip, save } = layer;
    if (!gl || !gl.width || !gl.height) {
      tip.textContent = t('3D 视图现在没有显示出来，存不了');
      return;
    }
    if (!strokes.length && !text.value.trim()) {
      tip.textContent = t('先画个圈，或者写一句');
      return;
    }
    save.disabled = true;
    tip.textContent = t('正在存…');
    const note = {
      createdAt: new Date().toISOString(),
      text: text.value.trim(),
      strokes: strokes.map((s) => s.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4])),
      view: { width: layer.canvas.clientWidth, height: layer.canvas.clientHeight, pixelRatio: devicePixelRatio || 1 },
      ...hooks.context(),
    };
    try {
      const images = { 'screen.png': picture(gl, true), 'clean.png': picture(gl, false) };
      const reply = await new Promise<{ ok: boolean; dir?: string; error?: string }>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(t('开发服务器没回话'))), SAVE_TIMEOUT);
        const onSaved = (data: { ok: boolean; dir?: string; error?: string }) => {
          window.clearTimeout(timer);
          hot.off?.('oc-agent:note-saved', onSaved);
          resolve(data);
        };
        hot.on('oc-agent:note-saved', onSaved);
        hot.send('oc-agent:note', { note, images });
      });
      if (!reply.ok) throw new Error(reply.error ?? t('没存成'));
      console.info(`[问题单] 存好了：${reply.dir}`);
      close();
      flash(t('问题单存好了：{dir}', { dir: String(reply.dir) }));
    } catch (err) {
      save.disabled = false;
      tip.textContent = t('没存成：{reason}', { reason: err instanceof Error ? err.message : String(err) });
    }
  };

  /** 存好以后在底下状态栏说一声（状态栏是 main.ts 管的，这里只借它显示一下） */
  const flash = (message: string) => {
    const status = document.getElementById('status');
    if (!status) return;
    status.textContent = message;
    status.removeAttribute('data-idle');
  };

  open.addEventListener('click', () => (layer ? close() : begin()));
}
