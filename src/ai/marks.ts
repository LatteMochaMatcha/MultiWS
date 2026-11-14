/**
 * 「圈出来」：在 3D 视图上画红圈告诉 AI 具体哪里要改（和开发版的问题单 src/dev/annotate.ts 一个画法）。
 *
 * 画好以后：
 * - 每个圈底下是哪些部件：沿着笔迹取点，圈是闭合的再在圈里面撒一片点，一个个点用射线问工坊点中了哪个部件（WorkshopApi.pickAt），
 *   按点中的次数排；所以只能看文字的模型也知道是「左边第二条手臂」；
 * - 一张图：当时的 3D 视图，叠上红圈，压成长边 1024 的 JPEG，能看图的模型一起发过去；
 * - 镜头从哪边看（正面看时角色自己的左边在屏幕右边），模型就分得清左右。
 * 画的时候 Ctrl+Z 撤一笔，Esc 不画了。镜头要先转好再画（画的时候不能转，红圈是贴在屏幕上的）。
 */
import { t } from '../i18n';
import { partLabel } from '../model/partLabel';
import type { WorkshopApi } from './workshop';

/** 一个圈底下的部件，按点中的多少排 */
export interface MarkRegion {
  parts: { name: string; label: string; share: number }[];
}

/** 圈好的一次（可以好几个圈） */
export interface Mark {
  regions: MarkRegion[];
  /** 镜头从哪边看（WorkshopApi.viewSide） */
  view: string;
  /** 叠着红圈的 3D 视图，JPEG 的 base64（不带 data: 开头） */
  image: string;
}

/** 发给模型的消息里，这一段文字以它开头（界面靠它认出来，不当成用户说的话显示） */
export const MARK_PREFIX = '⟦marks⟧';

const INK = '#e5322d';
const WIDTH = 4;
const MAX_SIDE = 1024;

type Stroke = [number, number][];

/** 一个圈底下有哪些部件：pick(x, y) 问那一点点中了哪个部件 */
export function regionOf(stroke: Stroke, pick: (x: number, y: number) => string | null): MarkRegion {
  // 沿着笔迹等距取点（快速一划时浏览器只报了头尾几个点，中间也要取到）：最多 60 个
  const points: [number, number][] = [stroke[0]];
  let length = 0;
  for (let i = 1; i < stroke.length; i++) length += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
  const step = Math.max(length / 60, 0.004);
  let carry = 0;
  for (let i = 1; i < stroke.length; i++) {
    const [ax, ay] = stroke[i - 1];
    const [bx, by] = stroke[i];
    const seg = Math.hypot(bx - ax, by - ay);
    let d = step - carry;
    while (d <= seg) {
      points.push([ax + ((bx - ax) * d) / seg, ay + ((by - ay) * d) / seg]);
      d += step;
    }
    carry = seg - (d - step);
  }
  // 首尾挨得近就算闭合的圈：圈里面也撒一片点（7×7 格子，落在圈里的才算）
  const xs = stroke.map((p) => p[0]);
  const ys = stroke.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const diag = Math.hypot(x1 - x0, y1 - y0);
  const first = stroke[0];
  const last = stroke[stroke.length - 1];
  if (stroke.length > 4 && diag > 0 && Math.hypot(first[0] - last[0], first[1] - last[1]) < diag * 0.35) {
    for (let i = 1; i < 8; i++) {
      for (let j = 1; j < 8; j++) {
        const p: [number, number] = [x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * j) / 8];
        if (inside(p, stroke)) points.push(p);
      }
    }
  }
  const counts = new Map<string, number>();
  let hits = 0;
  for (const [x, y] of points) {
    const name = pick(x, y);
    if (!name) continue;
    hits++;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, n]) => ({ name, label: partLabel(name), share: Math.round((n / hits) * 100) / 100 }));
  return { parts };
}

/** 点在不在多边形里（射线法） */
function inside([x, y]: [number, number], poly: Stroke): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) yes = !yes;
  }
  return yes;
}

const VIEW_TEXT: Record<string, string> = {
  front: 'from the front (the character faces the camera, so the character’s own left, the _L parts, is on the right of the picture)',
  back: 'from behind (the character’s own left, the _L parts, is on the left of the picture)',
  left: 'from the character’s left side',
  right: 'from the character’s right side',
  top: 'from above',
  bottom: 'from below',
  angled: 'from an angle',
};

/** 发给模型的那段说明（英文：各家模型都读得懂）。withImage：图有没有一起发 */
export function describeMarks(marks: readonly Mark[], withImage: boolean): string {
  const lines = [MARK_PREFIX, 'The user circled places on the 3D view to show exactly what to change. Part names use the character’s own left/right (_L/_R).'];
  marks.forEach((m, i) => {
    lines.push(`Picture ${i + 1}, seen ${VIEW_TEXT[m.view] ?? m.view}:`);
    m.regions.forEach((r, j) => {
      const under = r.parts.length ? r.parts.map((p) => `${p.name} (${p.label}, ${Math.round(p.share * 100)}%)`).join(', ') : 'no part (empty space)';
      lines.push(`- circle ${j + 1}: ${under}`);
    });
  });
  lines.push(withImage ? 'The attached picture(s) show the view with the red circles.' : 'The pictures were not sent because this model cannot read images; rely on the part names.');
  lines.push('Use tweak_part for changes to these specific parts, or set_body for counts and body-wide settings.');
  return lines.join('\n');
}

/** 给人看的一句：圈了哪些部件 */
export function summarizeMark(m: Mark): string {
  const names = [...new Set(m.regions.flatMap((r) => r.parts.slice(0, 2).map((p) => p.label)))];
  return names.length ? t('圈了：{parts}', { parts: names.join('、') }) : t('圈在了空白处');
}

/**
 * 盖一层画布让人画圈。画完（点「圈好了」）返回圈出来的东西，不画了返回 null。
 * 画的时候 3D 视图转不了；先转好镜头再点「圈出来」
 */
export function drawMarks(api: WorkshopApi): Promise<Mark | null> {
  const stage = api.stage();
  if (!stage) return Promise.resolve(null);
  return new Promise((resolve) => {
    let strokes: Stroke[] = [];
    const root = document.createElement('div');
    root.className = 'ai-mark-layer';
    const canvas = document.createElement('canvas');
    const bar = document.createElement('div');
    bar.className = 'ai-mark-bar';
    const tip = document.createElement('span');
    tip.className = 'ai-mark-tip';
    tip.textContent = t('在 3D 视图上把要改的地方圈出来，可以圈好几处。镜头要先转好再圈。Ctrl+Z 撤一笔，Esc 不圈了。');
    const row = document.createElement('div');
    row.className = 'ai-mark-row';
    const button = (label: string, onClick: () => void, main = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = main ? 'btn primary' : 'btn';
      b.textContent = label;
      b.addEventListener('click', onClick);
      row.append(b);
      return b;
    };
    const ratio = () => devicePixelRatio || 1;
    const paint = (ctx: CanvasRenderingContext2D, w: number, h: number, width: number) => {
      ctx.strokeStyle = INK;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of strokes) {
        ctx.beginPath();
        s.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
        if (s.length === 1) ctx.lineTo(s[0][0] * w + 0.01, s[0][1] * h);
        ctx.stroke();
      }
    };
    const redraw = () => {
      const w = Math.round(canvas.clientWidth * ratio());
      const h = Math.round(canvas.clientHeight * ratio());
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, w, h);
      paint(ctx, w, h, WIDTH * ratio());
      done.disabled = !strokes.length;
    };
    const finish = (result: Mark | null) => {
      root.remove();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', redraw);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        strokes.pop();
        redraw();
      }
    };
    button(t('撤一笔'), () => {
      strokes.pop();
      redraw();
    });
    button(t('清空'), () => {
      strokes = [];
      redraw();
    });
    button(t('不圈了'), () => finish(null));
    const done = button(t('圈好了'), () => void submit(), true);
    bar.append(tip, row);
    root.append(canvas, bar);
    stage.append(root);

    let current: Stroke | null = null;
    const at = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    // 刚盖上的一下不算（点「圈出来」的那一下有时会落到画布上，多出一个点）
    const openedAt = performance.now();
    canvas.addEventListener('pointerdown', (e) => {
      if (performance.now() - openedAt < 250) return;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 有的旧内核不认这个指针：不抓也照样画（只是画出画布外时会断）
      }
      current = [at(e)];
      strokes.push(current);
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!current) return;
      current.push(at(e));
      redraw();
    });
    const end = () => {
      current = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', redraw);
    redraw();

    async function submit() {
      done.disabled = true;
      tip.textContent = t('正在看圈住了哪些部件……');
      // 画布和 3D 视图一样大、叠在一起：画布上的比例就是 3D 视图里的比例
      const regions = strokes.map((s) => regionOf(s, (x, y) => api.pickAt(x, y)));
      let image = '';
      try {
        image = await compose(await api.snapshot(), stage!);
      } catch {
        // 截不了图（3D 视图没显示出来）：只发部件名
      }
      finish({ regions, view: api.viewSide(), image });
    }

    /** 3D 视图的图，铺上底色，叠上红圈，压小 */
    async function compose(png: Blob, host: HTMLElement): Promise<string> {
      const url = URL.createObjectURL(png);
      try {
        const img = await new Promise<HTMLImageElement>((ok, bad) => {
          const i = new Image();
          i.onload = () => ok(i);
          i.onerror = () => bad(new Error('image'));
          i.src = url;
        });
        const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * k));
        const h = Math.max(1, Math.round(img.height * k));
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const ctx = out.getContext('2d')!;
        ctx.fillStyle = backdrop(host);
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        paint(ctx, w, h, Math.max(3, WIDTH * ratio() * k * 1.5));
        return out.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '');
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  });
}

/** 3D 视图的底色（截图是透明底，铺上它看起来和屏幕上一样） */
function backdrop(host: HTMLElement): string {
  for (const el of [host, document.body]) {
    const color = getComputedStyle(el).backgroundColor;
    if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return '#c9d3d6';
}
