/**
 * 「楚云萱躯干」：预设「楚云萱」的九个胸腔换成一整块（见 anime/chuTorso.ts、tools/build-chu-torso.ts、docs/chu-blocks-plan.md）。
 *
 * 体块设定里写了要用它（Blocks.trunk）、数据也取回来了、九个胸腔还在烤它时的位置上，摆位的最后一步才换：
 * 正中那个胸腔（UpperBody）的形状换成这一整块，九个胸腔的骨骼都归它；另外八个胸腔不再有形状、挂到它下面，
 * 只当它们上面长的头、脖子、手臂、胸的落脚处。这样选中它挪、转、缩放，整个上半身一起走；它底下照九副胯自己的形状接着。
 * 不换的时候（数据还没取回来、有胸腔被删了或者挪走了）还是九个胸腔各是各的，部件的名字、谁挂在谁上都一样。
 * 纯函数，不碰 three.js 和 DOM。
 */
import { CHU_TORSO_GRID, CHU_TORSO_STRETCH, CHU_TORSO_WAISTS, chuTorsoReady } from '../anime/chuTorso';
import type { BodySpec, PartOverride } from '../model/spec';
import { type Figure, type Part, worldTransforms } from './figure';
import { type V3, add, quatConj, quatMul, rotate, sub } from './vec';

/** 这一整块在部件里叫什么：就是正中那个胸腔 */
export const TRUNK_PART = 'UpperBody';
/** 九个胸腔的腰照烤的时候的位置（拉宽以后）最多差这么远还算对得上 */
const FIT = 0.03;
/** 接长、缩短的那一段两头渐变多长（和 animeLayout.ts 的 ROW_RAMP 一个意思） */
const RAMP = 0.04;

const isRib = (p: Part) => p.type === 'torso' && /^UpperBody(_\d+)?$/.test(p.name);

/** 换成一整块以后另外八个胸腔剩下的落脚处（没有形状）：界面上不列出来、选不中 */
export const isTrunkGhost = (p: Part): boolean => p.type === 'torso' && p.parent === TRUNK_PART && !p.prims.length;

/** 这份设定要不要、能不能用这一整块 */
export const wantsTrunk = (spec: BodySpec): boolean => spec.blocks?.trunk === 'chu' && spec.bodyStyle === 'anime';

/**
 * 九个胸腔换成一整块。换不了的（见上面）原样返回传进来的那个 Figure。
 * 换好以后 ghosts 是另外八个胸腔的名字：这一整块被拉伸时它们要跟着（见 trunkOverrides）
 */
export function withTrunk(figure: Figure, spec: BodySpec): { figure: Figure; ghosts: string[] } {
  const same = { figure, ghosts: [] };
  if (!wantsTrunk(spec) || !chuTorsoReady()) return same;
  const root = figure.parts.find((p) => p.name === TRUNK_PART);
  const ribs = figure.parts.filter(isRib);
  const names = Object.keys(CHU_TORSO_WAISTS);
  if (!root || ribs.length !== names.length || names.some((n) => !ribs.some((r) => r.name === n))) return same;
  const grid = root.prims.find((q) => q.kind === 'grid');
  if (!grid || grid.kind !== 'grid' || !grid.fork) return same;
  const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
  const home = xfs.get(TRUNK_PART)!;
  const back = quatConj(home.quat);
  const local = (p: V3): V3 => rotate(back, sub(p, home.pos));

  // 九个胸腔的腰现在在哪：照烤的时候的位置左右、前后各拉宽多少倍对得上（大腿调粗了九副胯隔得远，这一块跟着拉宽）
  const waists = new Map(ribs.map((r) => [r.name, local(add(xfs.get(r.name)!.pos, rotate(xfs.get(r.name)!.quat, grid.fork!.pivot)))]));
  const ratio = (k: number): number => {
    let up = 0;
    let down = 0;
    for (const n of names) {
      const was = CHU_TORSO_WAISTS[n][k] - CHU_TORSO_WAISTS[TRUNK_PART][k];
      up += (waists.get(n)![k] - waists.get(TRUNK_PART)![k]) * was;
      down += was * was;
    }
    return down > 1e-9 ? up / down : 1;
  };
  const wide: V3 = [ratio(0), 1, ratio(2)];
  if (!(wide[0] > 0.5 && wide[0] < 2 && wide[2] > 0.5 && wide[2] < 2)) return same;
  for (const n of names) {
    const [was, now] = [CHU_TORSO_WAISTS[n], waists.get(n)!];
    if (Math.hypot(now[0] - was[0] * wide[0], now[1] - was[1], now[2] - was[2] * wide[2]) > FIT) return same;
  }
  const stretched = wide.some((v) => Math.abs(v - 1) > 1e-3);
  /** 骨骼写在部件自己的坐标里，求位置时会照部件的拉伸一起拉：先反着缩回去，拉完正好在原处 */
  const unwide = (p: V3): V3 => (stretched ? [p[0] / wide[0], p[1], p[2] / wide[2]] : p);

  // 「躯干长短」和烤的时候差多少：烤的时候接长的那一段照现在的再拉长、缩短
  const [from, to, baked] = CHU_TORSO_STRETCH;
  const more = (grid.stretchY?.[2] ?? 0) - baked;

  const ghosts: string[] = [];
  const bones = (root.bones ?? []).map((b) => ({ ...b, head: unwide(b.head), tail: unwide(b.tail) }));
  const parts = figure.parts.map((p): Part => {
    if (p === root) return p;
    if (!isRib(p)) return p;
    const x = xfs.get(p.name)!;
    const pos = local(x.pos);
    const quat = quatMul(back, x.quat);
    for (const b of p.bones ?? []) bones.push({ ...b, head: unwide(add(pos, rotate(quat, b.head))), tail: unwide(add(pos, rotate(quat, b.tail))) });
    ghosts.push(p.name);
    // 只剩一个落脚处：没有形状、没有骨骼；这一整块被拉伸时照它的方向跟着拉（axes），上面长的部件的位置才对得上
    return { name: p.name, type: p.type, side: p.side, parent: TRUNK_PART, pos, quat, material: p.material, prims: [], axes: quatConj(quat) };
  });
  const trunk: Part = {
    ...root,
    prims: [{ kind: 'grid', name: 'ChuTorso', grid: CHU_TORSO_GRID, ...(Math.abs(more) > 1e-4 && { stretchY: [from, to + baked, more, RAMP] }) }],
    bones,
    ...(stretched && { stretch: wide }),
  };
  return { figure: { ...figure, parts: parts.map((p) => (p === root ? trunk : p)) }, ghosts };
}

/**
 * 这一整块自己的手动微调（挪、转、缩放）要在换成一整块以后才套，整个上半身才一起走：
 * before 是换之前套的那些（去掉它的），after 是换之后套的（它的；各轴拉伸不一样时另外八个落脚处跟着拉，等比的那一份它们本来就跟着）
 */
export function trunkOverrides(overrides: Readonly<Record<string, PartOverride>>, ghosts: readonly string[]): Record<string, PartOverride> {
  const own = overrides[TRUNK_PART];
  if (!own) return {};
  const out: Record<string, PartOverride> = { [TRUNK_PART]: own };
  const s = own.scale;
  if (s && Math.max(...s) - Math.min(...s) > 1e-9) {
    const uniform = Math.cbrt(s[0] * s[1] * s[2]);
    for (const name of ghosts) out[name] = { scale: [s[0] / uniform, s[1] / uniform, s[2] / uniform] };
  }
  return out;
}
