/**
 * 骨架：把各个部件里的骨骼小节收集起来，换算到世界坐标，按父子关系排成一棵树。
 * 纯函数，不碰 three.js 和 DOM。
 *
 * 命名照 VRM / Humanoid 的习惯：Hips、Spine、Chest、UpperChest、Neck、Head、
 * Shoulder_L、UpperArm_L、LowerArm_L、Hand_L、UpperLeg_L、LowerLeg_L、Foot_L、Toes_L；
 * 多出来的同类骨骼加序号后缀（UpperArm_L.002、Head.002），尾巴是 Tail_01_03（第 1 条尾巴的第 3 节），
 * 翅膀是 Wing_02_L。_L / _R 是角色自己的左 / 右。
 */
import { t } from '../i18n';
import { type Figure, graftFrame, shapeMatrix, worldTransforms } from '../geometry/figure';
import { type V3, add, mat3Apply, mul, rotate } from '../geometry/vec';

export interface Bone {
  name: string;
  /** 父骨骼在数组里的下标；根骨骼是 -1。父骨骼总是排在子骨骼前面 */
  parent: number;
  /** 起点（关节）和终点，世界坐标，和 worldTransforms(figure) 同单位 */
  head: V3;
  tail: V3;
  /** 这节骨骼属于哪个部件 */
  part: string;
  /** 属于哪一股（一根手指的几节是一股）；全身唯一。不成股的骨骼没有 */
  strand?: string;
}

export interface Skeleton {
  /** 第 0 根是根骨骼（Hips） */
  bones: Bone[];
}

interface Loose {
  name: string;
  parentName?: string;
  head: V3;
  tail: V3;
  part: string;
  strand?: string;
}

export function buildSkeleton(figure: Pick<Figure, 'parts' | 'scale'>): Skeleton {
  const xfs = worldTransforms(figure);
  const loose: Loose[] = [];
  for (const part of figure.parts) {
    if (!part.bones) continue;
    const xf = xfs.get(part.name)!;
    const shape = shapeMatrix(part);
    // 接上去的手不跟着手臂的拉伸变形（见 graftFrame），它的骨骼也一样
    const kept = new Map<string, (p: V3) => V3>();
    if (shape) for (const graft of part.grafts ?? []) for (const name of graft.rigid) kept.set(name, graftFrame(part, graft).place);
    const world = (p: V3): V3 => add(xf.pos, mul(rotate(xf.quat, p), xf.scale));
    for (const b of part.bones) {
      const own = kept.get(b.name);
      const place = (p: V3): V3 => world(own ? own(p) : shape ? mat3Apply(shape, p) : p);
      const one: Loose = { name: b.name, parentName: b.parent, head: place(b.head), tail: place(b.tail), part: part.name };
      if (b.strand) one.strand = `${part.name}/${b.strand}`;
      loose.push(one);
    }
  }

  const byName = new Map(loose.map((b) => [b.name, b]));
  if (byName.size !== loose.length) {
    const seen = new Set<string>();
    const twice = loose.find((b) => seen.size === seen.add(b.name).size);
    throw new Error(t('骨骼重名：{name}', { name: twice?.name ?? '' }));
  }
  const roots = loose.filter((b) => !b.parentName);
  if (roots.length !== 1) throw new Error(t('应该正好有一根根骨骼，现在有 {n} 根', { n: roots.length }));
  const children = new Map<string, Loose[]>();
  for (const b of loose) {
    if (!b.parentName) continue;
    if (!byName.has(b.parentName)) throw new Error(t('骨骼 {name} 的父骨骼 {parent} 不存在', { name: b.name, parent: b.parentName }));
    const list = children.get(b.parentName);
    if (list) list.push(b);
    else children.set(b.parentName, [b]);
  }

  // 从根开始一层层往下排：父骨骼总在子骨骼前面
  const bones: Bone[] = [];
  const visit = (b: Loose, parent: number) => {
    const index = bones.length;
    bones.push({ name: b.name, parent, head: b.head, tail: b.tail, part: b.part, ...(b.strand ? { strand: b.strand } : {}) });
    for (const child of children.get(b.name) ?? []) visit(child, index);
  };
  visit(roots[0], -1);
  if (bones.length !== loose.length) throw new Error(t('有骨骼没有连到根骨骼上（父子关系成了环）'));
  return { bones };
}
