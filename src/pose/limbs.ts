/**
 * 从骨架里找出手臂和腿：每条是「根部关节 → 中间关节 → 末端」两节骨头（上臂、前臂、手；大腿、小腿、脚）。
 * 多出来的手臂、腿，马腿、蜘蛛腿，只要骨骼是照工坊的名字起的，都算。纯函数。
 */
import { type Quat, type V3, cross, len, norm, quatBasis, sub } from '../geometry/vec';
import { anyPerp, reject } from './math';
import type { PoseRig } from './rig';

export interface Limb {
  kind: 'arm' | 'leg';
  /** 末端那根骨骼的名字（Hand_L、Foot_R.002；长在中线上的腿是 Foot、Foot.002），也当这条肢体的名字用 */
  name: string;
  /** 1 是角色的左手边，-1 是右手边，0 是长在中线上的腿 */
  side: 1 | 0 | -1;
  /** 第几对（从 0 数）；中线上的腿是第几条 */
  pair: number;
  upper: number;
  lower: number;
  end: number;
  /** 两节骨头各多长（米） */
  len1: number;
  len2: number;
  /** 静止时弯曲所在平面的法线：肘、膝就是绕着它弯的 */
  hinge: V3;
  /** 静止时上、下两节各自的基准朝向（沿骨头、法线、第三根轴），见 limbFrame */
  baseUpper: Quat;
  baseLower: Quat;
  /** 从肢体根部往上、到胯之前的各节骨骼（近的在前）：手够不着的时候，它们帮着往前送 */
  chain: number[];
}

const END = /^(?:(Hand)_([LR])|Foot(?:_([LR]))?)(?:\.(\d+))?$/;
/** 弯得比这个角度的正弦还小，就当作是直的：弯的方向照人体的习惯定 */
export const STRAIGHT = 0.08;

/** 一节骨头的朝向：X 轴沿骨头，Y 轴是弯曲平面的法线（先掰成和骨头垂直的） */
export function limbFrame(dir: V3, normal: V3): Quat {
  const flat = reject(normal, dir);
  const n = len(flat) > 1e-9 ? norm(flat) : anyPerp(dir);
  return quatBasis(dir, n, cross(dir, n));
}

export function findLimbs(rig: PoseRig): Limb[] {
  const limbs: Limb[] = [];
  rig.names.forEach((name, end) => {
    const m = END.exec(name);
    if (!m) return;
    const kind = m[1] ? 'arm' : 'leg';
    const lower = rig.parent[end];
    const upper = lower >= 0 ? rig.parent[lower] : -1;
    if (upper < 0) return;
    const want = kind === 'arm' ? ['UpperArm', 'LowerArm'] : ['UpperLeg', 'LowerLeg'];
    if (!rig.names[upper].startsWith(want[0]) || !rig.names[lower].startsWith(want[1])) return;

    const a = sub(rig.head[lower], rig.head[upper]);
    const b = sub(rig.head[end], rig.head[lower]);
    const len1 = len(a);
    const len2 = len(b);
    if (len1 < 1e-6 || len2 < 1e-6) return;
    const dir1 = norm(a);
    const dir2 = norm(b);
    // 静止时已经弯着的，就照它弯的方向；伸直的照习惯：手肘往后顶（前臂往前收），膝盖往前顶（小腿往后收）
    let hinge = cross(dir1, dir2);
    if (len(hinge) < STRAIGHT) {
      hinge = cross(dir1, kind === 'arm' ? [0, 0, 1] : [0, 0, -1]);
      if (len(hinge) < 1e-3) hinge = cross(dir1, [0, 1, 0]);
    }
    hinge = norm(hinge);

    const chain: number[] = [];
    for (let p = rig.parent[upper]; p >= 0 && p !== rig.hips; p = rig.parent[p]) chain.push(p);
    // 一路往上没碰到胯（挂在胯上面的骨骼）：那些骨骼不归这里管
    const reachesHips = (() => {
      for (let p = rig.parent[upper]; p >= 0; p = rig.parent[p]) if (p === rig.hips) return true;
      return false;
    })();

    limbs.push({
      kind,
      name,
      side: (m[2] ?? m[3]) === 'L' ? 1 : (m[2] ?? m[3]) === 'R' ? -1 : 0,
      pair: m[4] ? Number(m[4]) - 1 : 0,
      upper,
      lower,
      end,
      len1,
      len2,
      hinge,
      baseUpper: limbFrame(dir1, hinge),
      baseLower: limbFrame(dir2, hinge),
      chain: reachesHips ? chain : [],
    });
  });
  return limbs;
}
