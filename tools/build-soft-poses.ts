/**
 * 自己摆的几个柔和的姿势（站着的时候常见的那些：重心落在一条腿上、叉腰、手交叠在身前、背在身后、挥手、比耶、托腮），
 * 写到 src/pose/softPoses.json，和动作素材里取的那些（library.json）排在一起。
 *
 *   node tools/run.mjs tools/build-soft-poses.ts
 *
 * 动作素材里的姿势是游戏动作里的一帧：攥着拳、两脚叉开、胳膊直直地垂着，「站着」也是这样。这里在默认的二次元素体上，
 * 用摆姿势的那套工具（拖胯、转骨骼、拖手、拖手肘，pose/solve.ts）一步一步摆出来：
 * - 胯往一边挪、脚钉在原地，重心落到那条腿上；胯往另一边歪一点，胸口、头往回歪一点（对立式站姿）；
 * - 手放到身上的某个地方：从骨骼的关节朝某个方向找身体的表面（静止姿势下的距离场），再离开表面一点；
 *   手肘朝哪边、手心朝哪、手指指向哪，手势用 pose/fingers.ts 里现成的。
 * 摆出来记成姿势数据（每根骨骼在世界里转了多少），套到别的身材上时手臂让开身体（pose/clear.ts）。
 * 纯原创的数据，不来自任何素材。
 */
import { writeFileSync } from 'node:fs';
import { animeReady, installAnimeBody } from '../src/anime/body';
import { type PartType } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, add, cross, len, mul, norm, quatBasis, quatConj, quatEuler, quatMul, rotate, sub } from '../src/geometry/vec';
import { defaultSpec } from '../src/model/spec';
import { GESTURES, shapeHand } from '../src/pose/fingers';
import { POSE_LIBRARY } from '../src/pose/library';
import type { Posing } from '../src/pose/posing';
import { type Frame, type PoseState, forward, setWorldRot } from '../src/pose/rig';
import { capturePins, dragBend, dragBody, dragReach } from '../src/pose/solve';
import { type Solver, makeSolver, posingOf, stateOf } from '../src/pose/solver';
import { buildSkeleton } from '../src/rig/skeleton';
import { castRay, compileField } from '../src/sdf/field';
import { readFileSync } from 'node:fs';

const DEG = Math.PI / 180;

/** 手放在哪 */
interface Place {
  /** 从这根骨骼的关节（摆好以后的位置）朝 dir（身体自己的方向：X 左手边、Y 上、Z 前）找身体表面，先往 dir 挪 shift */
  bone: string;
  shift?: V3;
  dir: V3;
  /** 找到表面以后再往外离开多远（米） */
  gap: number;
  /** 手指指向哪、手心朝哪（身体自己的方向） */
  fingers: V3;
  palm: V3;
  /** 手肘往哪边顶（身体自己的方向） */
  elbow: V3;
  gesture: string;
}

interface Recipe {
  name: string;
  /** 从哪个姿势起：现成的姿势或者前面摆好的 */
  from: string;
  /** 胯挪多少（米，脚钉在原地） */
  hips?: V3;
  /** 几根骨骼再转多少（度，绕身体自己的 X、Y、Z），从胯往上依次转 */
  turn?: [bone: string, x: number, y: number, z: number][];
  /** 手放哪；没写的那只手照起点的样子，手势换成放松的 */
  L?: Place;
  R?: Place;
  /** 没写位置的手用什么手势 */
  rest?: string;
}

/** 左手的写法，右手照着左右镜像（X 反号） */
const flip = (v: V3): V3 => [-v[0], v[1], v[2]];
const mirror = (p: Place): Place => ({
  ...p,
  shift: p.shift ? flip(p.shift) : undefined,
  dir: flip(p.dir),
  fingers: flip(p.fingers),
  palm: flip(p.palm),
  elbow: flip(p.elbow),
});

/** 叉腰：手掌贴在胯骨上，四指朝前下，手肘朝外、稍往后 */
const HIP: Place = { bone: 'Hips', shift: [0, 0.1, 0], dir: [1, 0, -0.1], gap: 0.025, fingers: [0.15, -0.55, 1], palm: [-1, 0, 0], elbow: [1, 0.1, -0.5], gesture: '并拢' };
/** 手交叠在小腹前：左手在下面，右手搭在上面 */
const FRONT_L: Place = { bone: 'Hips', shift: [0.015, 0.06, 0], dir: [0, 0, 1], gap: 0.03, fingers: [-0.7, -0.7, 0], palm: [0, 0, -1], elbow: [1, -0.2, -0.3], gesture: '放松' };
const FRONT_R: Place = { bone: 'Hips', shift: [-0.02, 0.085, 0], dir: [0, 0, 1], gap: 0.05, fingers: [0.7, -0.7, 0], palm: [0, 0, -1], elbow: [-1, -0.2, -0.3], gesture: '并拢' };
/** 背在腰后：手背朝外，手指朝下、往里 */
const BACK: Place = { bone: 'Hips', shift: [0.03, 0.06, 0], dir: [0, 0, -1], gap: 0.03, fingers: [-0.5, -0.85, 0], palm: [0, 0, 1], elbow: [1, -0.3, -0.2], gesture: '放松' };

const RECIPES: Recipe[] = [
  {
    name: '自然站立',
    from: '站着',
    // 重心落在右腿上：胯往右挪、往下沉一点；胯往左边（不吃重的那边）歪下去，胸口、头往回歪
    hips: [-0.028, -0.01, 0],
    turn: [
      ['Hips', 0, 0, -5],
      ['Spine', 0, 0, 3],
      ['Chest', 0, 0, 3],
      ['Neck', 0, 0, 2],
      ['Head', 0, -6, -5],
    ],
    rest: '放松',
  },
  { name: '双手交叠身前', from: '自然站立', L: FRONT_L, R: FRONT_R, turn: [['Head', 6, 0, 0]] },
  { name: '双手背在身后', from: '自然站立', L: BACK, R: mirror(BACK), turn: [['Chest', -3, 0, 0]] },
  { name: '叉腰', from: '自然站立', L: HIP, R: mirror(HIP), turn: [['Chest', -2, 0, 0]] },
  { name: '单手叉腰', from: '自然站立', R: mirror(HIP), rest: '放松' },
  {
    name: '挥手',
    from: '自然站立',
    R: { bone: 'Head', shift: [-0.2, 0.02, 0.06], dir: [-1, 0, 0], gap: 0.12, fingers: [-0.15, 1, 0.1], palm: [0, 0, 1], elbow: [-0.6, -1, 0.1], gesture: '张开' },
    turn: [['Head', 0, -8, -6]],
  },
  {
    name: '比耶',
    from: '自然站立',
    R: { bone: 'Head', shift: [-0.03, -0.035, 0.03], dir: [-0.5, 0, 1], gap: 0.05, fingers: [0.1, 1, 0.15], palm: [0, 0, 1], elbow: [-0.7, -1, 0.3], gesture: '剪刀手' },
    L: HIP,
    turn: [['Head', 0, -5, -8]],
  },
  {
    name: '托腮',
    from: '自然站立',
    // 下巴搁在手背上：手在下巴底下，手心朝下巴，四指顺着下颌往左上
    R: { bone: 'Head', shift: [-0.01, -0.04, 0], dir: [0, -0.25, 1], gap: 0.015, fingers: [0.7, 0.45, -0.1], palm: [0, 1, -0.35], elbow: [-0.2, -1, 0.3], gesture: '放松' },
    L: { bone: 'Hips', shift: [-0.04, 0.14, 0], dir: [0, 0, 1], gap: 0.06, fingers: [-1, 0, 0.1], palm: [0, 0.6, -1], elbow: [1, -0.6, -0.2], gesture: '放松' },
    turn: [['Head', 4, 6, 6]],
  },
];

/** 身上的骨骼量身体表面时用的部件 */
const BODY = new Set<PartType>(['torso', 'leg', 'neck', 'head', 'chest']);

export async function main(_args: string[], root: string) {
  if (!animeReady()) {
    const b = readFileSync(`${root}/public/anime/body.bin`);
    installAnimeBody(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  }
  const spec = { ...defaultSpec(), bodyStyle: 'anime' as const };
  const figure = buildFigure(spec);
  const solver = makeSolver(buildSkeleton(figure).bones);
  const { rig, limbs, hands } = solver;
  const kept = new Set<string>();
  const parts = figure.parts.filter((p) => {
    const keep = BODY.has(p.type) && (!p.parent || kept.has(p.parent));
    if (keep) kept.add(p.name);
    return keep;
  });
  const field = compileField({ scale: figure.scale, parts }, { blend: spec.blend });
  const bone = (name: string) => {
    const j = rig.index.get(name);
    if (j === undefined) throw new Error(`骨架里没有 ${name}`);
    return j;
  };
  const made = new Map<string, Posing>();
  const out: { name: string; posing: Posing }[] = [];
  for (const recipe of RECIPES) {
    const base = made.get(recipe.from) ?? POSE_LIBRARY.find((p) => p.name === recipe.from)?.posing;
    if (!base) throw new Error(`没有姿势 ${recipe.from}`);
    let state = stateOf(solver, base);
    const feet = () => capturePins(solver, forward(rig, state), new Set(limbs.filter((l) => l.kind === 'leg').map((l) => l.name)));
    if (recipe.hips) {
      const f = forward(rig, state);
      state = dragBody(solver, state, add(f.pos[rig.hips], recipe.hips), feet());
    }
    for (const [name, x, y, z] of recipe.turn ?? []) {
      const j = bone(name);
      const f = forward(rig, state);
      const pins = feet();
      setWorldRot(rig, state, f, j, quatMul(quatEuler(x * DEG, y * DEG, z * DEG), f.rot[j]));
      state = dragBody(solver, state, forward(rig, state).pos[rig.hips], pins);
    }
    for (const [tag, side] of [['L', 1], ['R', -1]] as const) {
      const place = recipe[tag];
      const hand = hands.find((h) => h.side === side && h.pair === 0)!;
      if (!place) {
        if (recipe.rest) state = shapeHand(solver, state, hand, gesture(recipe.rest));
        continue;
      }
      const limb = limbs.findIndex((l) => l.kind === 'arm' && l.side === side && l.pair === 0);
      const f = forward(rig, state);
      const target = skinPoint(field, rig.head[bone(place.bone)], f, bone(place.bone), place);
      state = dragReach(solver, state, limb, target, feet());
      state = dragBend(solver, state, limb, add(forward(rig, state).pos[limbs[limb].lower], mul(norm(place.elbow), 0.3)));
      state = dragReach(solver, state, limb, target, feet());
      state = palmTo(solver, state, hand.bone, side, place);
      state = shapeHand(solver, state, hand, gesture(place.gesture));
    }
    const posing = posingOf(solver, state);
    made.set(recipe.name, posing);
    out.push({ name: recipe.name, posing });
    console.log(recipe.name);
  }
  writeFileSync(`${root}/src/pose/softPoses.json`, `${JSON.stringify(out)}\n`);
  console.log(`写好了 ${out.length} 个`);
}

function gesture(name: string) {
  const g = GESTURES.find((x) => x.name === name);
  if (!g) throw new Error(`没有手势 ${name}`);
  return g.shape;
}

/**
 * 手要去的地方：骨骼的关节（静止时在 rest）先挪 shift，再朝 dir 找身体表面（在静止姿势里找，再照这根骨骼摆好的样子搬过去），
 * 离开表面 gap
 */
function skinPoint(field: ReturnType<typeof compileField>, rest: V3, f: Frame, j: number, place: Place): V3 {
  const from = add(rest, place.shift ?? [0, 0, 0]);
  const dir = norm(place.dir);
  const far = 0.6;
  const outside = add(from, mul(dir, far));
  const hit = castRay(field, outside, mul(dir, -1), far);
  const skin = add(outside, mul(dir, -Math.min(hit, far)));
  const at = add(skin, mul(dir, place.gap));
  return add(f.pos[j], rotate(f.rot[j], sub(at, rest)));
}

/** 手转到手指指向 fingers、手心朝 palm（在身体自己的方向里，再跟着胯转） */
function palmTo(solver: Solver, state: PoseState, j: number, side: 1 | -1, place: Place): PoseState {
  const { rig } = solver;
  const f = forward(rig, state);
  // 静止时：手指沿手那根骨骼，手心 = 横过手掌（小指 → 食指）和手指方向的叉乘（左右手反号）
  const tag = rig.names[j].replace(/^Hand/, '');
  const index = rig.index.get(`Index1${tag}`);
  const little = rig.index.get(`Little1${tag}`);
  const f0 = norm(sub(rig.tail[j], rig.head[j]));
  const across = index !== undefined && little !== undefined ? sub(rig.head[index], rig.head[little]) : ([0, 0, 1] as V3);
  const s0 = norm(sub(across, mul(f0, across[0] * f0[0] + across[1] * f0[1] + across[2] * f0[2])));
  const p0 = mul(cross(f0, s0), side);
  const body = f.rot[rig.hips];
  const want = norm(rotate(body, place.fingers));
  let face = rotate(body, place.palm);
  face = norm(sub(face, mul(want, face[0] * want[0] + face[1] * want[1] + face[2] * want[2])));
  if (len(face) < 1e-6) return state;
  const turn: Quat = quatMul(quatBasis(want, face, cross(want, face)), quatConj(quatBasis(f0, p0, cross(f0, p0))));
  const next = { local: state.local.slice(), root: state.root };
  setWorldRot(rig, next, f, j, turn);
  return next;
}
