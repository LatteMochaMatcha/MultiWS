/**
 * 一个部件该接在它底下那块身体的哪根骨骼上：离它最近的那一根（体块：复制出来的胸、接到别的部件上的部件，见 clone.ts、attach.ts）。
 */
import { type Part, type WorldXf } from './figure';
import { type V3, add, dot, len, mul, rotate, sub } from './vec';

/**
 * 挂在 parent 上、位置是 pos（parent 自己的坐标）的部件，底下离它最近的那根骨骼的名字。
 * 从 parent 往上找第一个有骨骼的部件，在它的骨骼里挑（都换到世界里量）；skip 说了不要的骨骼不挑。一路都没有骨骼的没有
 */
export function hostBoneAt(
  parts: readonly Part[],
  xfs: ReadonlyMap<string, WorldXf>,
  parent: string | undefined,
  pos: V3,
  skip?: (bone: string) => boolean,
): string | undefined {
  const start = parent === undefined ? undefined : xfs.get(parent);
  if (parent === undefined || !start) return undefined;
  const byName = new Map(parts.map((p) => [p.name, p]));
  const at = add(start.pos, mul(rotate(start.quat, pos), start.scale));
  // 最多往上数这么多层：万一父子关系绕成了圈也停得下来
  for (let up = byName.get(parent), guard = 0; up && guard < 32; up = up.parent === undefined ? undefined : byName.get(up.parent), guard++) {
    const xf = xfs.get(up.name);
    const bones = (up.bones ?? []).filter((b) => !skip?.(b.name));
    if (!xf || !bones.length) continue;
    const world = (p: V3): V3 => add(xf.pos, mul(rotate(xf.quat, p), xf.scale));
    let best: string | undefined;
    let least = Infinity;
    for (const b of bones) {
      // 点到骨骼那一段的距离
      const head = world(b.head);
      const along = sub(world(b.tail), head);
      const span = dot(along, along);
      const t = span > 1e-12 ? Math.max(0, Math.min(1, dot(sub(at, head), along) / span)) : 0;
      const far = len(sub(at, add(head, mul(along, t))));
      if (far < least) {
        least = far;
        best = b.name;
      }
    }
    return best;
  }
  return undefined;
}
