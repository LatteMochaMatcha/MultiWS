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
  PENIS_RIM,
  SCROTUM_GRID,
  SCROTUM_HALF,
  SCROTUM_ROOT,
  penisBones,
} from '../anime/genital';
import type { PenisLayout, ScrotumMode } from '../model/spec';
import type { BoneHint, Graft, Part } from './figure';
import { type V3, Q_ID, add, mul, quatEuler, sub } from './vec';

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
 * 相邻两根的根部隔多远：切口一圈最宽的半径的两倍（素体的单位），再空出 GAP（素体的单位）、至少 GAP_MIN（身上的米）。
 * 空当比融合的体素还窄的话，两根在切口那里融成一片，找不到干净的切口，缝不上
 */
const RIM_WIDE = 0.0305;
const GAP = 0.008;
const GAP_MIN = 0.015;
/** 左右并排的几根往外转多少（按离中线多远，弧度 / 米）：顺着小腹往两边弯过去的表面 */
const ROW_FOLLOW = 2.5;
/** 扇形散开：根部挨得近一些（SPACING 的几成），相邻两根往外多转多少（弧度） */
const FAN_SPACING = 0.85;
const FAN_STEP = 0.45;
/**
 * 上下叠：上下隔得比并排远（SPACING 的几倍）。阴茎往前上方翘，下面那根的切口比根部高，
 * 挨得近了切口那一圈会碰上上面那根的根部、融成一片，找不到干净的切口，缝不上
 */
const STACK_SPACING = 1.3;
/** 阴囊：比素体上的位置往上挪多少；贴着身体的那一面往身体（大腿前面）里埋多深（素体的单位） */
const SAC_UP = 0.012;
const SAC_INSET = 0.01;
/** 每根各带一个阴囊时，每个缩成几成；共用一个时每多一根宽多少 */
const SAC_EACH = 0.72;
const SAC_WIDEN = 0.3;
/** 并排挂着的几个阴囊（上下叠、每根各带一个时）：相邻两个隔开它们宽度的几成（稍微挤着） */
const SAC_ROW = 0.85;
/** 阴囊的骨骼：从贴着身体那一面的正中往下、往前到哪（素体的单位） */
const SAC_BONE: V3 = [0, -0.025, 0.035];

export interface GenitalOptions {
  /** 这副胯上几根 */
  count: number;
  layout: PenisLayout;
  scrotum: ScrotumMode;
  /** 素体的一个单位在身上多长（已经乘了「阴茎大小」） */
  scale: number;
  /** 阴茎根部那么高、正中的那一点（小腹的表面上）；只用它的 x、y，z 由 front 定 */
  root: V3;
  /** 身体在 (x, y) 这里最前面的表面的 z；那里没有身体就返回 null */
  front: (x: number, y: number) => number | null;
  /** 骨骼接在哪一根上 */
  parent: string;
  /** 编号从几开始：好几副胯时接着前一副编（Penis_03、Scrotum_02 …） */
  firstPenis: number;
  firstScrotum: number;
}

/** 一根阴茎：根部在 base（身上），绕竖轴转 yaw */
function penisPart(index: number, base: V3, yaw: number, scale: number, parent: string): Part {
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
    quat: yaw ? quatEuler(0, yaw, 0) : Q_ID,
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

/** 一个阴囊：贴着身体那一面的正中在 root，宽 widen 倍 */
function scrotumPart(index: number, root: V3, scale: number, widen: number, parent: string): Part {
  const name = `Scrotum_${pad(index)}`;
  return {
    name,
    type: 'genital',
    side: 0,
    pos: root,
    quat: Q_ID,
    scale,
    ...(widen !== 1 ? { stretch: [widen, 1, 1] as V3 } : {}),
    material: 'clay',
    prims: [{ kind: 'grid', name: 'Scrotum', grid: SCROTUM_GRID, soft: SOFT, fade: FADE }],
    bones: [bone(name, [0, 0, 0], SAC_BONE, parent)],
  };
}

/** 一副胯上的阴茎和阴囊 */
export function genitalParts(o: GenitalOptions): Part[] {
  const n = o.count;
  if (n <= 0) return [];
  const s = o.scale;
  const step = 2 * RIM_WIDE * s + Math.max(GAP * s, GAP_MIN);
  const mid = (n - 1) / 2;
  /** 第 k 根的根部离正中多远（左右、上下），往外转多少 */
  const places = Array.from({ length: n }, (_, k) => {
    const off = k - mid;
    if (o.layout === 'stack') return { dx: 0, dy: k * step * STACK_SPACING, yaw: 0 };
    if (o.layout === 'fan') return { dx: off * step * FAN_SPACING, dy: 0, yaw: off * FAN_STEP };
    return { dx: off * step, dy: 0, yaw: off * step * ROW_FOLLOW };
  });
  /** 根部的中心：(x, y) 那里小腹的表面往前，和素体上根部离小腹一样远 */
  const baseAt = (x: number, y: number): V3 => {
    const z = o.front(x, y) ?? o.front(o.root[0], y) ?? o.root[2];
    return [x, y, z + (PENIS_BASE[2] - DJP_PUBIS_Z) * s];
  };
  const parts: Part[] = [];
  const bases = places.map((p, k) => {
    const base = baseAt(o.root[0] + p.dx, o.root[1] + p.dy);
    parts.push(penisPart(o.firstPenis + k, base, p.yaw, s, o.parent));
    return base;
  });

  /** 阴囊：在 base 那根的底下，贴着身体（大腿前面）放；half 是它的半宽 */
  const sacAt = (base: V3, size: number, half: number): V3 => {
    const y = base[1] + (SCROTUM_ROOT[1] - PENIS_BASE[1] + SAC_UP) * size;
    // 这么高的地方中线上常常已经是两腿之间的空当：贴着中线、半宽一半、快到边上这几处里最靠前的表面
    const fronts = [0, 0.5, 0.9, -0.5, -0.9].map((t) => o.front(base[0] + t * half, y)).filter((z): z is number => z !== null);
    const z = fronts.length ? Math.max(...fronts) - SAC_INSET * size : base[2] + (SCROTUM_ROOT[2] - PENIS_BASE[2]) * size;
    return [base[0], y, z];
  };
  const lowest = bases.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (o.scrotum === 'each') {
    const size = s * SAC_EACH;
    // 上下叠的，上面几根底下是下面那根：几个阴囊并排挂在最下面那根底下
    const under =
      o.layout === 'stack'
        ? bases.map((_, k): V3 => [o.root[0] + (k - mid) * 2 * SCROTUM_HALF * size * SAC_ROW, lowest[1], lowest[2]])
        : bases;
    under.forEach((base, k) => parts.push(scrotumPart(o.firstScrotum + k, sacAt(base, size, SCROTUM_HALF * size), size, 1, o.parent)));
  } else {
    // 共用一个：上下叠的在最下面那根底下；并排、扇形的在正中，根数多了变宽
    const widen = o.layout === 'stack' ? 1 : 1 + SAC_WIDEN * (n - 1);
    const center: V3 = [o.root[0], lowest[1], o.layout === 'stack' ? lowest[2] : baseAt(o.root[0], lowest[1])[2]];
    parts.push(scrotumPart(o.firstScrotum, sacAt(center, s, SCROTUM_HALF * s * widen), s, widen, o.parent));
  }
  return parts;
}

/** 一副胯用掉几个编号（阴茎、阴囊）：下一副胯从这之后接着编 */
export const genitalCount = (count: number, scrotum: ScrotumMode) => ({ penises: count, scrotums: count ? (scrotum === 'each' ? count : 1) : 0 });
