/**
 * 摆姿势的控制点：模型上哪些关节有圆点、每个点拖的时候做什么、点一下转的是哪根骨骼。
 * 只管「有哪些点」，画出来和接鼠标的事在 view/poseHandles.ts。纯函数。
 *
 * 两条规矩，身上的点都一样：
 * - 拖：这个点跟着手指走（手、脚是 IK，肘、膝是换一边弯，其余的是带着它的那节骨头转过去）；
 * - 点一下：出现旋转环，转的是「从这个关节往外的那一段」。
 * 尾巴、翅膀、头发、裙摆这些一串一串的，只在末梢有一个点：拖它整串跟着弯，点一下转的是整串（绕根部）。
 * 手指也是这样，每根在指尖有一个点；后两节只朝手心那一个方向弯，不会被拖得往旁边、往手背折。
 */
import type { V3 } from '../geometry/vec';
import { FINGER_LABEL, FINGER_NAMES, fingerHinge } from './fingers';
import type { AimLink } from './solve';
import type { Solver } from './solver';

/** body 拖胯；reach 拖手、脚；bend 拖肘、膝；aim 带着它的骨头转过去 */
export type HandleKind = 'body' | 'reach' | 'bend' | 'aim';

/** 圆点分成几组，可以一组一组地收起来。finger 是指尖；tail 是尾巴、翅膀和兽身；hair 是头发、裙摆、袖子这些挂着的；genital 是阴茎、阴囊 */
export const HANDLE_GROUPS = ['torso', 'head', 'arm', 'leg', 'finger', 'tail', 'hair', 'genital'] as const;
export type HandleGroup = (typeof HANDLE_GROUPS)[number];

export interface Handle {
  /** 这个点所在的关节是哪根骨骼的起点，就用那根骨骼的名字；长在骨骼末端的点是「骨骼名:tip」 */
  id: string;
  kind: HandleKind;
  group: HandleGroup;
  /** 给人看的名字：手 左、膝 右 2 … */
  label: string;
  /** 这个点长在哪根骨骼上、静止时在哪 */
  anchor: number;
  rest: V3;
  /** 点一下出现的旋转环转的是哪根骨骼 */
  turn: number;
  /** reach / bend：是哪条肢体（Solver.limbs 的下标）；别的是 -1 */
  limb: number;
  /** aim：拖的时候转哪几节（近的在前） */
  links: AimLink[];
}

/** 脊柱的几节；好几个上半身时，旁边那几个的脊柱带着它在哪一边（Spine_L、Chest_R.002，见 geometry/torsos.ts） */
const SPINE = /^(Spine|Chest|UpperChest)(_[LR])?(\.\d+)?$/;
/** 这些骨骼不算「一串一串挂着的」：手指（下面单独给指尖的点）、帮着拧的辅助骨骼、眼睛 */
const SKIP = /^(Index|Middle|Ring|Little|Thumb)\d|Sec_[LR]|^FaceEyeSet|^Eye_/;
const nth = (name: string) => {
  const m = /\.(\d+)$/.exec(name);
  return m ? ` ${Number(m[1])}` : '';
};
const sideWord = (name: string) => (/_L(\.\d+)?$/.test(name) ? ' 左' : /_R(\.\d+)?$/.test(name) ? ' 右' : '');
const DEG = Math.PI / 180;
/** 手指的后两节最多往手背翘多少、往手心弯多少（弧度）：第 2 节、第 3 节 */
const FINGER_BEND = [
  { min: -25 * DEG, max: 125 * DEG },
  { min: -25 * DEG, max: 110 * DEG },
];

/** 一串挂着的骨骼叫什么、归哪一组 */
function chainLabel(name: string): { group: HandleGroup; label: string } {
  let m: RegExpExecArray | null;
  if ((m = /^Tail_(\d+)/.exec(name))) return { group: 'tail', label: `尾巴 ${Number(m[1])}` };
  if ((m = /^Wing_(\d+)/.exec(name))) return { group: 'tail', label: `翅膀${sideWord(name)}${Number(m[1]) > 1 ? ` ${Number(m[1])}` : ''}` };
  if ((m = /^LowerBody_(\d+)/.exec(name))) return { group: 'tail', label: `兽身 ${Number(m[1])}` };
  if (name === 'Abdomen') return { group: 'tail', label: '腹部' };
  if ((m = /^Penis_(\d+)/.exec(name))) return { group: 'genital', label: `阴茎 ${Number(m[1])}` };
  if ((m = /^Scrotum_(\d+)/.exec(name))) return { group: 'genital', label: `阴囊 ${Number(m[1])}` };
  if ((m = /^Hair\D*(\d+)/.exec(name))) return { group: 'hair', label: `头发 ${Number(m[1])}` };
  // 裙摆；新版 VRoid 的外套下摆叫 CoatSkirt…
  if ((m = /^(Coat)?Skirt(Front|Back|Side)?/.exec(name))) {
    const where = { Front: ' 前', Back: ' 后', Side: ' 侧' }[m[2] as 'Front' | 'Back' | 'Side'] ?? '';
    return { group: 'hair', label: `${m[1] ? '衣摆' : '裙摆'}${where}${sideWord(name)}` };
  }
  // 角色自带的兽耳（配饰）：RabbitEar1_01_L、CatEar1_01_R …
  if (/^[A-Za-z]*Ear\d/.test(name)) return { group: 'hair', label: `耳朵${sideWord(name)}` };
  if (/Sleeve/.test(name)) return { group: 'hair', label: `袖子${sideWord(name)}` };
  if (/^Bust/.test(name)) return { group: 'hair', label: `胸${sideWord(name)}` };
  return { group: 'hair', label: name };
}

export function buildHandles(solver: Solver): Handle[] {
  const { rig, limbs, main } = solver;
  const handles: Handle[] = [];
  const kids: number[][] = rig.names.map(() => []);
  rig.parent.forEach((p, i) => {
    if (p >= 0) kids[p].push(i);
  });
  const joint = (bone: number, extra: Pick<Handle, 'kind' | 'group' | 'label'> & Partial<Handle>): Handle => ({
    id: rig.names[bone],
    anchor: bone,
    rest: rig.head[bone],
    turn: bone,
    limb: -1,
    links: [],
    ...extra,
  });

  const hips = rig.hips;
  handles.push(joint(hips, { kind: 'body', group: 'torso', label: '胯' }));

  // 脊柱：从胯往上一节一节，走到带着脖子的那一节为止。好几个上半身时胯上长着好几串，各有各的腰和胸
  const roots = kids[hips].filter((k) => SPINE.test(rig.names[k]));
  for (const root of roots) {
    const spine: number[] = [];
    for (let at: number | undefined = root; at !== undefined; at = kids[at].find((k) => SPINE.test(rig.names[k]))) spine.push(at);
    const where = sideWord(rig.names[root]);
    if (roots.length === 1) {
      // 腰：拖它是整个上身从胯那里倾过去
      handles.push(joint(spine[0], { kind: 'aim', group: 'torso', label: '腰', links: [{ bone: hips, weight: 1 }] }));
    } else if (spine.length > 2) {
      // 好几个上半身：胯不动，只有这一个从腰那里倾过去
      handles.push(joint(spine[1], { id: `${rig.names[root]}:waist`, kind: 'aim', group: 'torso', label: `腰${where}`, links: [{ bone: spine[0], weight: 1 }] }));
    }
    // 胸：拖它是弯腰，下面几节脊柱一起弯
    if (spine.length > 1) {
      const below = spine.slice(0, -1).reverse();
      handles.push(joint(spine[spine.length - 1], { kind: 'aim', group: 'torso', label: `胸${where}`, links: below.map((bone) => ({ bone, weight: 0.6 })) }));
    }
  }
  /** 从这根骨骼往上（往胯那边）的几节脊柱，近的在前 */
  const spineAbove = (bone: number) => {
    const list: number[] = [];
    for (let p = rig.parent[bone]; p >= 0 && p !== hips; p = rig.parent[p]) if (SPINE.test(rig.names[p])) list.push(p);
    return list;
  };

  rig.names.forEach((name, bone) => {
    if (/^Neck(\.\d+)?$/.test(name)) {
      // 脖子根：拖它是含胸、挺胸，越靠上的脊柱弯得越多（弯的是这根脖子所在的那个上半身的脊柱）
      const links = spineAbove(bone).map((b, i) => ({ bone: b, weight: Math.max(0.25, 0.5 - 0.1 * i) }));
      handles.push(joint(bone, { kind: 'aim', group: 'head', label: `脖子${nth(name)}`, links }));
    } else if (/^Head(\.\d+)?$/.test(name)) {
      const neck = rig.parent[bone];
      handles.push(joint(bone, { kind: 'aim', group: 'head', label: `头${nth(name)}`, links: neck >= 0 ? [{ bone: neck, weight: 1 }] : [] }));
      // 头顶：拖它是歪头、点头，脖子也跟着弯一点
      const links: AimLink[] = [{ bone, weight: 0.7 }];
      if (neck >= 0) links.push({ bone: neck, weight: 0.3 });
      handles.push(joint(bone, { id: `${name}:tip`, kind: 'aim', group: 'head', label: `头顶${nth(name)}`, rest: rig.tail[bone], links }));
    }
  });

  limbs.forEach((limb, i) => {
    const arm = limb.kind === 'arm';
    const group: HandleGroup = arm ? 'arm' : 'leg';
    const which = ` ${limb.side > 0 ? '左' : limb.side < 0 ? '右' : '中'}${limb.pair ? ` ${limb.pair + 1}` : ''}`;
    // 肩、大腿根：拖它是带着它的那节（锁骨、胯）转过去
    const base = rig.parent[limb.upper];
    handles.push(joint(limb.upper, { kind: 'aim', group, label: `${arm ? '肩' : '大腿根'}${which}`, links: base >= 0 ? [{ bone: base, weight: 1 }] : [] }));
    handles.push(joint(limb.lower, { kind: 'bend', group, label: `${arm ? '肘' : '膝'}${which}`, limb: i }));
    handles.push(joint(limb.end, { kind: 'reach', group, label: `${arm ? '手' : '脚'}${which}`, limb: i }));
    if (!arm) {
      const toes = kids[limb.end].find((k) => /^Toe/.test(rig.names[k]));
      if (toes !== undefined) handles.push(joint(toes, { kind: 'aim', group, label: `脚尖${which}`, links: [{ bone: limb.end, weight: 1 }] }));
    }
  });

  // 手指：每根在指尖一个点。拖它整根跟着弯，点一下转的是整根（绕指根）
  for (const hand of solver.hands) {
    const which = ` ${hand.side > 0 ? '左' : '右'}${hand.pair ? ` ${hand.pair + 1}` : ''}`;
    hand.fingers.forEach((chain, f) => {
      if (!chain.length) return;
      const tip = chain[chain.length - 1];
      // 指根那一节可以朝任何方向摆；往后的每一节只绕自己的轴弯。
      // 中间的关节先动、出力最多，指尖那一节最后动、出力最少：拖出来的手指是整根匀着弯的，不是光勾指尖
      const links = chain
        .map((bone, joint): AimLink => {
          if (joint === 0) return { bone, weight: 0.5 };
          const axis = fingerHinge(solver.frames[bone], hand.side, f === 0);
          const last = joint === chain.length - 1 && chain.length > 2;
          return { bone, weight: last ? 0.3 : 0.55, hinge: { axis, ...FINGER_BEND[Math.min(joint, FINGER_BEND.length) - 1] } };
        })
        .sort((a, b) => b.weight - a.weight);
      const label = `${FINGER_LABEL[FINGER_NAMES[f]]}${which}`;
      handles.push(joint(chain[0], { id: `${rig.names[tip]}:tip`, kind: 'aim', group: 'finger', label, anchor: tip, rest: rig.tail[tip], links }));
    });
  }

  // 一串一串挂着的：尾巴、翅膀、兽身，成品角色的头发、裙摆、袖子。从根部顺着往下，走到分叉或者到头为止
  const loose = rig.names.map((name, j) => !main[j] && j !== hips && !SKIP.test(name));
  // 同一串的骨骼名字开头是一样的（Tail、Hair、SkirtBack …）：尾巴接在兽身上，但它们是两串
  const family = (j: number) => rig.names[j].replace(/[_\d].*$/, '');
  rig.names.forEach((name, root) => {
    const p = rig.parent[root];
    if (!loose[root] || (p >= 0 && loose[p] && family(p) === family(root))) return;
    const chain = [root];
    for (let at = root; ; ) {
      const next = kids[at].filter((k) => loose[k] && family(k) === family(root));
      if (next.length !== 1) break;
      chain.push(next[0]);
      at = next[0];
    }
    const tip = chain[chain.length - 1];
    // 越靠末梢的那几节出力越多：拖尾巴尖，先弯的是尖上那一截。只有一节的（翅膀）直接转过去
    const links = [...chain].reverse().map((bone, k) => ({ bone, weight: chain.length === 1 ? 1 : Math.max(0.3, 0.6 - 0.08 * k) }));
    handles.push(joint(root, { id: `${rig.names[tip]}:tip`, kind: 'aim', anchor: tip, rest: rig.tail[tip], links, ...chainLabel(name) }));
  });
  return handles;
}
