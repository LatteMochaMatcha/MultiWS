/**
 * 阴茎、阴囊的摆位（白模人台、二次元素体）。形状是从 DJP 男性素体上取下来的（见 anime/genital.ts）：
 * 阴茎从小腹伸出一截圆台，融合完在圆台上缝上原样的网格；阴囊是距离场格子，搁在阴茎根部底下、大腿前面。
 *
 * 部件都写在素体模型自己的单位里（Part.scale 把它缩放到身上），原点是根部：阴茎是根部的中心，阴囊是贴着身体那一面的正中。
 * 它们只在根部和身体圆滑地融合（见 sdf/field.ts 的 REST_ROOT_BLEND），再往外是硬接：阴囊挨着大腿不会扯出蹼，
 * 并排的几根挨着也不会粘成一块（粘上了就找不到切口，缝不上）。
 */
import {
  PENIS_BASE,
  PENIS_BASE_DIR,
  PENIS_CUT,
  PENIS_CUT_DIR,
  PENIS_JOINTS,
  PENIS_LINE,
  PENIS_RIM,
  SCROTUM_GRID,
  SCROTUM_HALF,
  SCROTUM_ROOT,
  penisBones,
} from '../anime/genital';
import type { PenisLayout, ScrotumMode } from '../model/spec';
import type { BoneHint, Graft, Part } from './figure';
import { type Quat, type V3, add, len, mul, quatEuler, quatMul, rotate, sub } from './vec';

// 同 layout.ts 的 pad、bone（layout.ts 要引这个文件，不反过来引它）
const pad = (n: number) => String(n).padStart(2, '0');
const bone = (name: string, head: V3, tail: V3, parent: string): BoneHint => ({ name, parent, head, tail });

/** 素体在阴茎根部那么高的地方，小腹正中的表面往前到哪（z）：根部离小腹多远照这个搬 */
const DJP_PUBIS_Z = 0.088;
/** 伸出来的那截圆台：从根部往身体里多深、根部那头粗细是切口的几成、过了切口再多长（素体的单位） */
const STUB_IN = 0.06;
const STUB_ROOT = 0.85;
const STUB_OUT = 0.015;
/** 阴茎根部那截圆台和阴囊之间（还有并排的几根之间）圆滑过渡的半径；离根部 FADE 这一段以内才过渡，再往外硬接 */
const SOFT = 0.02;
const FADE: [from: number, to: number] = [0.03, 0.05];
/**
 * 几根的根部挤在小腹正中一处（二次元插画里多根差不多都这么画：根部长在一起，往外才分开）：
 * 相邻两根的根部隔几个 ROOT_STEP（素体的单位，大约两根正好挨着），往外各自转开，
 * 转到切口往外那一截（缝上去的网格）和别的那根彼此隔开 GAP（素体的单位）、至少 GAP_MIN（身上的米）为止。
 * 切口挨着的话两根在那里融成一片，找不到干净的切口，缝不上；RIM_WIDE 是切口一圈最宽的半径。
 * 切口往根部是距离场里的圆台，挨着、融成一团都不要紧（往根部 3 厘米以内也算上的话，转开的角度大得多，试过不必要）
 */
const ROOT_STEP = 0.04;
const RIM_WIDE = 0.03;
const GAP = 0.008;
const GAP_MIN = 0.015;
/**
 * 每种排法根部隔几个 ROOT_STEP（root）、转开的角度是刚好隔开的几倍（wide）、最外面那根最多转多少弧度（most）：
 * 左右并排根部挨着、几乎平行地往前伸；扇形散开根部挤得更紧、往两边张开；
 * 上下叠的一根正叠在一根上面、一根比一根高 rise：最上面那根照原样往上翘，下面的一根比一根往下转、往前平伸。
 * 下面那根往上翘的话正好从上面那根的根部前面擦过去，切口那里融成一片；所以叠起来比并排占地方，根部至少隔一根半粗
 */
const ROW = { root: 1.2, wide: 1, most: 0.9 };
const FAN = { root: 0.8, wide: 1.8, most: 1.1 };
const STACK = { root: 1, rise: 1.1, wide: 1, most: 0.7 };
/** 转那么多还隔不开的（根数多、排得挤）：根部再隔开一点，每次多几成，最多几次 */
const ROOT_MORE = 0.1;
const ROOT_TRIES = 12;
/** 中心线上切口往外的那一截（缝上去的网格那一段） */
const BEYOND = PENIS_LINE.slice(PENIS_LINE.reduce((best, p, k) => (len(sub(p, PENIS_CUT)) < len(sub(PENIS_LINE[best], PENIS_CUT)) ? k : best), 0));
/** 看离身体多远的两处：切口、中间那一节的末端 */
const CLEAR_AT = [PENIS_CUT, PENIS_JOINTS[2]];
/** 阴囊：比素体上的位置往上挪多少；贴着身体的那一面往身体（大腿前面）里埋多深（素体的单位） */
const SAC_UP = 0.012;
const SAC_INSET = 0.01;
/**
 * 每根各带一个阴囊时，每个缩成几成；共用一个时每多一根整个大多少。
 * 共用的只往宽里拉的话，顶上那一面比挤在一起的几根根部宽，两边露出一圈扁平的台子
 */
const SAC_EACH = 0.72;
const SAC_GROW = 0.12;
/**
 * 每根各带一个时，几个阴囊挨着挂在根部底下（根部挤在一起，各挂在各的底下就叠成一个了）：
 * 站着的左右排开，身体底下的往后排开；相邻两个隔开它们宽（长）的几成（稍微挤着）。SAC_LONG 是阴囊前后多长（素体的单位）
 */
const SAC_ROW = 0.78;
const SAC_LONG = 0.071;
/** 挂成两排时下排比上排低多少（素体的单位） */
const SAC_DROP = 0.032;
/** 阴囊的骨骼：从贴着身体那一面的正中往下、往前到哪（素体的单位） */
const SAC_BONE: V3 = [0, -0.025, 0.035];

/**
 * 一副胯上长阴茎的地方（「挂点」）：小腹正中、阴茎根部那么高的一点，和那里的朝向。
 * 朝向把素体的坐标（往右 x、往上 y、往外 z）转到身上：人站着的胯是原样（往外就是往前）；
 * 前后排的后面几副胯、兽身是身体底下（往外是往下，「往上」朝着前面，见 UNDER）
 */
export interface Mount {
  origin: V3;
  quat: Quat;
  /**
   * 挂在身体底下：几根一律从挂点往后、顺着肚子排（左右并排、扇形的试过，更容易碰上腿，切口融成一片缝不上；
   * 往前排会碰上前面那副胯的腿），阴囊挂在最后面那根的后面（每根各带一个时一个接一个往后排开）
   */
  under?: boolean;
  /** 骨骼接在哪一根上 */
  parent: string;
}

/** 挂在身体底下的朝向：绕左右的轴往前转 80°（转满 90° 阴茎就直直往下）：往前下方伸，不往两腿中间插 */
export const UNDER: Quat = quatEuler(1.4, 0, 0);

export interface GenitalOptions {
  /** 这副胯上几根 */
  count: number;
  layout: PenisLayout;
  scrotum: ScrotumMode;
  /** 素体的一个单位在身上多长（已经乘了「阴茎大小」） */
  scale: number;
  mount: Mount;
  /** 身体表面：挂点的坐标里往右 u、往上 v 的那一处，最外面的表面离挂点往外多远；那里没有身体就返回 null */
  surface: (u: number, v: number) => number | null;
  /** 编号从几开始：好几副胯时接着前一副编（Penis_03、Scrotum_02 …） */
  firstPenis: number;
  firstScrotum: number;
}

/** 一根阴茎：根部在 base（身上），朝向 quat */
function penisPart(index: number, base: V3, quat: Quat, scale: number, parent: string): Part {
  const name = `Penis_${pad(index)}`;
  const boneName = (b: string) => `${name}_${pad(Number(b.slice(-1)))}`;
  const local = (p: V3) => sub(p, PENIS_BASE);
  const graft: Graft = {
    mesh: 'penis',
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    offset: mul(PENIS_BASE, -1),
    bones: penisBones(boneName),
    pivot: PENIS_CUT,
    reach: sub(PENIS_CUT, PENIS_BASE),
    // 根部那一节一半是圆台：手动拉长拉粗时照部件走；中间、龟头两节整个在缝上去的网格里，跟着网格保持原样
    rigid: [boneName('Penis2'), boneName('Penis3')],
  };
  return {
    name,
    type: 'genital',
    side: 0,
    pos: base,
    quat,
    scale,
    material: 'clay',
    prims: [
      {
        kind: 'cone',
        name: 'PenisRoot',
        a: mul(PENIS_BASE_DIR, -STUB_IN),
        b: local(add(PENIS_CUT, mul(PENIS_CUT_DIR, STUB_OUT))),
        ra: PENIS_RIM * STUB_ROOT,
        rb: PENIS_RIM,
        soft: SOFT,
        fade: FADE,
      },
    ],
    grafts: [graft],
    bones: PENIS_JOINTS.slice(0, -1).map((j, k) => bone(`${name}_${pad(k + 1)}`, local(j), local(PENIS_JOINTS[k + 1]), k ? `${name}_${pad(k)}` : parent)),
  };
}

/** 一个阴囊：贴着身体那一面的正中在 root，朝向 quat */
function scrotumPart(index: number, root: V3, quat: Quat, scale: number, parent: string): Part {
  const name = `Scrotum_${pad(index)}`;
  return {
    name,
    type: 'genital',
    side: 0,
    pos: root,
    quat,
    scale,
    material: 'clay',
    prims: [{ kind: 'grid', name: 'Scrotum', grid: SCROTUM_GRID, soft: SOFT, fade: FADE }],
    bones: [bone(name, [0, 0, 0], SAC_BONE, parent)],
  };
}

/** 一副胯上的阴茎和阴囊。下面的位置都先写在挂点的坐标里（u 往右、v 往上、w 往外），最后才搬到身上 */
export function genitalParts(o: GenitalOptions): Part[] {
  const n = o.count;
  if (n <= 0) return [];
  const s = o.scale;
  const { origin, quat, parent, under: below } = o.mount;
  const layout = below ? 'stack' : o.layout;
  const world = (p: V3): V3 => add(origin, rotate(quat, p));
  const mid = (n - 1) / 2;
  const style = layout === 'stack' ? STACK : layout === 'fan' ? FAN : ROW;
  /**
   * 第 k 根的根部离正中几个 ROOT_STEP（左右 du、上下 dv），往哪边转开、转多少（su、sv：每份转开的角度乘几）。
   * 身体底下的从挂点往后排（往前排会碰上前面那副胯的腿）；站着的从小腹往上排
   */
  const places = Array.from({ length: n }, (_, k) => {
    const off = k - mid;
    if (below) return { du: 0, dv: (k - (n - 1)) * STACK.rise, su: 0, sv: k - (n - 1) };
    if (layout === 'stack') return { du: 0, dv: k * STACK.rise, su: 0, sv: k - (n - 1) };
    return { du: off * style.root, dv: 0, su: off, sv: 0 };
  });
  /** 根部的中心：(u, v) 那里的表面往外，和素体上根部离小腹一样远 */
  const baseAt = (u: number, v: number): V3 => {
    const w = o.surface(u, v) ?? o.surface(0, v) ?? 0;
    return [u, v, w + (PENIS_BASE[2] - DJP_PUBIS_Z) * s];
  };
  /** 每份转开 t（弧度）时第 k 根往哪转：绕着和 (su, sv) 垂直的那根轴，往外的那头朝 (su, sv) 那边倒 */
  const tilt = (k: number, t: number): Quat => {
    const { su, sv } = places[k];
    const m = Math.hypot(su, sv);
    if (!m || !t) return [0, 0, 0, 1];
    const half = (t * m) / 2;
    const f = Math.sin(half) / m;
    return [-sv * f, su * f, 0, Math.cos(half)];
  };
  // 转开到切口那一圈彼此隔开为止：先找刚好隔开的那一份角度（二分），再照排法乘几倍
  const need = 2 * RIM_WIDE * s + Math.max(GAP * s, GAP_MIN);
  const most = style.most / Math.max(...places.map((p) => Math.hypot(p.su, p.sv)), 1e-9);
  /** 两根切口往外的那一截最近隔多远 */
  const apart = (bases: V3[], t: number) => {
    const lines = bases.map((base, k) => {
      const q = tilt(k, t);
      return BEYOND.map((p) => add(base, rotate(q, mul(sub(p, PENIS_BASE), s))));
    });
    let least = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (const a of lines[i]) for (const b of lines[j]) least = Math.min(least, len(sub(a, b)));
    return least;
  };
  /** 切口附近离身体表面还有多远（中心线上那一点在表面外面多远，减去切口的半径）：往上翘的贴到肚子上，切口和肚皮融成一片也缝不上 */
  const clear = (bases: V3[], t: number) => {
    let least = Infinity;
    bases.forEach((base, k) => {
      const q = tilt(k, t);
      for (const at of CLEAR_AT) {
        const p = add(base, rotate(q, mul(sub(at, PENIS_BASE), s)));
        const w = o.surface(p[0], p[1]);
        if (w !== null) least = Math.min(least, p[2] - w - RIM_WIDE * s);
      }
    });
    return least;
  };
  /** 二分：t 从 0 到 most 之间，ok 从不成到成（rising）或者从成到不成的那一处 */
  const bisect = (ok: (t: number) => boolean, rising: boolean, hi: number) => {
    let a = 0;
    let b = hi;
    for (let i = 0; i < 24; i++) {
      const t = (a + b) / 2;
      if (ok(t) === rising) b = t;
      else a = t;
    }
    return rising ? b : a;
  };
  // 根部从挨着开始试：先看最多能转多少（不碰肚子、不超过 most），再看转那么多能不能隔开；隔不开就把根部隔开一点再试
  const gap = Math.max(GAP * s, GAP_MIN);
  let bases: V3[] = [];
  let splay = 0;
  for (let tries = 0; tries <= ROOT_TRIES && n > 1; tries++) {
    const step = ROOT_STEP * s * (1 + ROOT_MORE * tries);
    bases = places.map((p) => baseAt(p.du * step, p.dv * step));
    const free = bases;
    const top = clear(free, most) >= gap ? most : bisect((t) => clear(free, t) >= gap, false, most);
    splay = top;
    if (apart(free, top) < need) continue;
    splay = Math.min(bisect((t) => apart(free, t) >= need, true, top) * style.wide, top);
    break;
  }
  if (n < 2) bases = places.map(() => baseAt(0, 0));
  const parts: Part[] = bases.map((base, k) => penisPart(o.firstPenis + k, world(base), splay ? quatMul(quat, tilt(k, splay)) : quat, s, parent));

  /** 阴囊：在 base 那根的底下，贴着身体（大腿前面）放；half 是它的半宽 */
  const sacAt = (base: V3, size: number, half: number): V3 => {
    const v = base[1] + (SCROTUM_ROOT[1] - PENIS_BASE[1] + SAC_UP) * size;
    // 这么高的地方中线上常常已经是两腿之间的空当：贴着中线、半宽一半、快到边上这几处里最靠外的表面
    // 挂在身体底下的只看正中：两边是两条腿，往外探会碰到大腿
    const fronts = (below ? [0] : [0, 0.5, 0.9, -0.5, -0.9]).map((t) => o.surface(base[0] + t * half, v)).filter((w): w is number => w !== null);
    const w = fronts.length ? Math.max(...fronts) - SAC_INSET * size : base[2] + (SCROTUM_ROOT[2] - PENIS_BASE[2]) * size;
    return world([base[0], v, w]);
  };
  const lowest = bases.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (o.scrotum === 'each') {
    const size = s * SAC_EACH;
    // 几个挨着挂在最下面（身体底下的是最后面）那根底下：站着的左右排开，身体底下的往后排开（两边是腿）
    // 站着的三个以上挂成上下两排（一排排开太宽，挂到大腿上去）：上排多一个，下排错开挂在上排两个中间
    const top = n < 3 ? n : Math.ceil(n / 2);
    const under = bases.map((_, k): V3 => {
      if (below) return [0, lowest[1] - k * SAC_LONG * size * SAC_ROW, lowest[2]];
      const row = k < top ? 0 : 1;
      const j = row ? k - top : k;
      const count = row ? n - top : top;
      return [(j - (count - 1) / 2) * 2 * SCROTUM_HALF * size * SAC_ROW, lowest[1] - row * SAC_DROP * size, lowest[2]];
    });
    under.forEach((base, k) => parts.push(scrotumPart(o.firstScrotum + k, sacAt(base, size, SCROTUM_HALF * size), quat, size, parent)));
  } else {
    // 共用一个：在最下面那根底下的正中，根数多了整个大一些（身体底下的不变：两边是腿）
    const size = s * (below ? 1 : 1 + SAC_GROW * (n - 1));
    const center: V3 = [0, lowest[1], baseAt(0, lowest[1])[2]];
    parts.push(scrotumPart(o.firstScrotum, sacAt(center, size, SCROTUM_HALF * size), quat, size, parent));
  }
  return parts;
}

/** 一副胯用掉几个编号（阴茎、阴囊）：下一副胯从这之后接着编 */
export const genitalCount = (count: number, scrotum: ScrotumMode) => ({ penises: count, scrotums: count ? (scrotum === 'each' ? count : 1) : 0 });
