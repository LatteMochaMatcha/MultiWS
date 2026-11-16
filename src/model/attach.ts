/**
 * 体块：缝合——在设定上把部件接到另一个部件上、解开（见 docs/blocks-plan.md、spec.ts 的 Attached）。都是纯函数，返回新的 BodySpec。
 * 接上去、解开的那一刻部件留在原地不跳：照它现在在世界里的摆放，换算成新父部件坐标里的摆放（接上去）或者一条手动微调（解开）。
 * 只管白模人台、二次元素体。摆好的 Figure 上那一半见 geometry/attach.ts
 */
import { type Part, type PartType, type WorldXf, worldTransforms } from '../geometry/figure';
import { buildFigure } from '../geometry/layout';
import { type Mat3, type Quat, type V3, Q_ID, eulerOf, mat3Apply, mul, quatConj, quatMul, rotate, scaleAlong, sub } from '../geometry/vec';
import { type Attached, type BodySpec, type PartOverride, cleanOverride } from './spec';

const DEG = Math.PI / 180;

/** 能接到别的部件上的那几类（和能复制的一样）。躯干、下身不能；脖子跟着头走 */
export const ATTACHABLE: ReadonlySet<PartType> = new Set<PartType>(['head', 'arm', 'leg', 'chest', 'tail', 'wing', 'horn', 'ear', 'eye']);

/** 这个部件接在哪个部件上；没接过的是 undefined */
export const attachedTo = (spec: Pick<BodySpec, 'blocks'>, name: string): string | undefined => spec.blocks?.attach?.[name]?.to;

/** 头底下的那根脖子（和头并排挂在同一个部件上的）：接头、解开头的时候带着它。没有就是 null */
function neckOf(parts: readonly Part[], head: Part): string | null {
  if (head.type !== 'head' || !/^Head_\d+$/.test(head.name)) return null;
  const name = head.name.replace('Head_', 'Neck_');
  return parts.some((p) => p.name === name && p.parent === head.parent) ? name : null;
}

/** name 是不是 ancestor 自己、或者长在它上面 */
function under(parts: readonly Part[], name: string, ancestor: string): boolean {
  const parentOf = new Map(parts.map((p) => [p.name, p.parent]));
  for (let at: string | undefined = name, guard = 0; at !== undefined && guard < 32; at = parentOf.get(at), guard++) if (at === ancestor) return true;
  return false;
}

/** name 这个部件能不能接到 to 上：两个都在、不是同一个、to 不长在 name 上（不然绕成圈）、name 是能接的那几类 */
export function canAttach(parts: readonly Part[], name: string, to: string): boolean {
  const part = parts.find((p) => p.name === name);
  return part !== undefined && ATTACHABLE.has(part.type) && parts.some((p) => p.name === to) && !under(parts, to, name);
}

/**
 * 父部件被拉伸了（手动微调、手臂长短滑块）的话，挂在它上面的部件的位置是跟着拉伸变的（见 geometry/tweak.ts）：
 * 这是把拉伸以后的位置换回拉伸以前的那个矩阵；没拉伸是 null
 */
const unwarpOf = (host: Part | undefined): Mat3 | null =>
  host?.resize ? scaleAlong([1 / host.resize[0], 1 / host.resize[1], 1 / host.resize[2]], host.axes) : null;

/** 世界里的摆放 child，在 host（世界里的摆放）自己的坐标里是什么样（位置还没算 host 的拉伸） */
function localOf(host: WorldXf, child: WorldXf): { pos: V3; quat: Quat; scale: number } {
  const back = quatConj(host.quat);
  return { pos: mul(rotate(back, sub(child.pos, host.pos)), 1 / host.scale), quat: quatMul(back, child.quat), scale: child.scale / host.scale };
}

/**
 * 把 names 里的部件（连同长在它们上面的；头带着脖子）接到 to 上。它们留在原地不动，之后跟着 to 挪、转、缩放。
 * 原来记在它们上面的位置、角度、等比大小的微调已经算进接上去的摆放里了，只留下各方向不一样的那部分拉伸。
 * 接不了的（见 canAttach）跳过，名字在 refused 里
 */
export function attachParts(spec: BodySpec, names: readonly string[], to: string): { spec: BodySpec; attached: string[]; refused: string[] } {
  const figure = buildFigure(spec);
  const xfs = worldTransforms(figure);
  const byName = new Map(figure.parts.map((p) => [p.name, p]));
  const host = byName.get(to);
  const hostXf = xfs.get(to);
  const attach: Record<string, Attached> = { ...(spec.blocks?.attach ?? {}) };
  const overrides: Record<string, PartOverride> = { ...spec.overrides };
  const attached: string[] = [];
  const refused: string[] = [];
  for (const name of names) {
    const part = byName.get(name);
    if (!part || !host || !hostXf || !canAttach(figure.parts, name, to)) {
      refused.push(name);
      continue;
    }
    const neck = neckOf(figure.parts, part);
    for (const one of neck === null ? [name] : [neck, name]) {
      const own = byName.get(one)!;
      const at = localOf(hostXf, xfs.get(one)!);
      const unwarp = unwarpOf(host);
      // 贴在躯干表面上的胸：微调是摆位时换算进形状里的（接出去以后换成圆包，见 clone.ts 的 loose），放大过的照等比的那一份算进去
      const baked = own.surface ? Math.cbrt((overrides[one]?.scale ?? [1, 1, 1]).reduce((a, b) => a * b, 1)) : 1;
      attach[one] = { to, pos: unwarp ? mat3Apply(unwarp, at.pos) : at.pos, quat: at.quat, scale: at.scale * baked };
      // 位置、角度、等比的大小都在上面了；各方向不一样的那部分拉伸还记在微调里
      const left = own.surface ? null : cleanOverride({ scale: own.resize ? [own.resize[0], own.resize[1], own.resize[2]] : undefined });
      if (left) overrides[one] = left;
      else delete overrides[one];
    }
    attached.push(name);
  }
  if (!attached.length) return { spec, attached, refused };
  return { spec: { ...spec, blocks: { ...(spec.blocks ?? { added: [] }), attach }, overrides }, attached, refused };
}

/**
 * 把 names 里的部件解开：回到它们原来的父部件上。留在原地不动——现在的摆放换算成一条手动微调记下来（点「还原这个部件」才回到自动摆位的地方）。
 * 头带着它的脖子一起解开。没接过的不动
 */
export function detachParts(spec: BodySpec, names: readonly string[]): BodySpec {
  const live = spec.blocks?.attach ?? {};
  const figure = buildFigure(spec);
  const xfs = worldTransforms(figure);
  const byName = new Map(figure.parts.map((p) => [p.name, p]));
  const going = new Set<string>();
  for (const name of names) {
    if (!live[name]) continue;
    going.add(name);
    const part = byName.get(name);
    const neck = part ? neckOf(figure.parts, part) : null;
    if (neck !== null && live[neck]?.to === live[name].to) going.add(neck);
  }
  if (!going.size) return spec;
  const attach = Object.fromEntries(Object.entries(live).filter(([name]) => !going.has(name)));
  const cleared = Object.fromEntries(Object.entries(spec.overrides).filter(([name]) => !going.has(name)));
  const { attach: _was, ...blocks } = spec.blocks ?? { added: [] };
  const freed: BodySpec = { ...spec, blocks: Object.keys(attach).length ? { ...blocks, attach } : blocks, overrides: cleared };
  // 解开以后、还没有微调时它们在哪：照着算出该记多少微调，才留在现在的地方
  const plain = buildFigure(freed);
  const plainXfs = worldTransforms(plain);
  const plainByName = new Map(plain.parts.map((p) => [p.name, p]));
  const overrides: Record<string, PartOverride> = { ...cleared };
  for (const name of going) {
    const now = xfs.get(name);
    const base = plainByName.get(name);
    // 贴在躯干表面上的胸回到胸口：微调是沿表面算的，世界里的摆放换不过去
    if (!now || !base || base.surface) continue;
    const host: WorldXf = base.parent === undefined ? { pos: [0, 0, 0], quat: Q_ID, scale: plain.scale } : plainXfs.get(base.parent)!;
    const at = localOf(host, now);
    const turn = eulerOf(quatMul(at.quat, quatConj(base.quat)));
    const k = at.scale / (base.scale ?? 1);
    const stretch = byName.get(name)?.resize ?? [1, 1, 1];
    // base.pos 已经算过父部件的拉伸了（见 unwarpOf）
    const made = cleanOverride({
      position: [at.pos[0] - base.pos[0], at.pos[1] - base.pos[1], at.pos[2] - base.pos[2]],
      rotation: [turn[0] / DEG, turn[1] / DEG, turn[2] / DEG],
      scale: [k * stretch[0], k * stretch[1], k * stretch[2]],
    });
    if (made) overrides[name] = made;
  }
  return { ...freed, overrides };
}

/** 这些部件不在了（删掉了手工加的那一块）：接在它们上面的、它们自己接出去的那几条缝合一起去掉 */
export function dropAttach(spec: BodySpec, gone: (name: string) => boolean): BodySpec {
  const live = spec.blocks?.attach;
  if (!live) return spec;
  const attach = Object.fromEntries(Object.entries(live).filter(([name, a]) => !gone(name) && !gone(a.to)));
  if (Object.keys(attach).length === Object.keys(live).length) return spec;
  const { attach: _was, ...blocks } = spec.blocks!;
  return { ...spec, blocks: Object.keys(attach).length ? { ...blocks, attach } : blocks };
}
