// 摆好姿势以后的距离场：各部件的形状照骨骼搬过去再融合（src/sdf/posedField.ts）
import { describe, expect, it } from 'vitest';
import { worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { type Quat, type V3, quatEuler } from '../src/geometry/vec';
import { type BodyCounts, type BodySpec, defaultSpec } from '../src/model/spec';
import { skinVerticesDualInPlace } from '../src/character/pose';
import { POSE_LIBRARY } from '../src/pose/library';
import { forward, poseMatrices, restState } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { type Skeleton, buildSkeleton } from '../src/rig/skeleton';
import { type Clearance, type Draft, T_CUSTOM, compileField, fieldAt, pack } from '../src/sdf/field';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { fuseSkinned } from '../src/sdf/bindPose';
import { compilePosedField, heldLegs, refusable } from '../src/sdf/posedField';
import { fusePosed } from '../src/sdf/posedFuse';
import { useAnimeBody } from './animeBody';

const DEG = Math.PI / 180;
const make = (counts: Partial<BodyCounts> = {}, rest: Partial<BodySpec> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, ...rest, counts: { ...base.counts, ...counts } };
};
const options = { blend: 0.02, minRadius: VOXEL.preview };

/** 一副身体，和「把这几根骨骼各转这么多」以后每根骨骼的蒙皮矩阵 */
function setup(spec: BodySpec) {
  const parts = buildFigure(spec).parts;
  const figure = { parts, scale: 1 };
  const skeleton = buildSkeleton(figure);
  const solver = makeSolver(skeleton.bones);
  const { rig } = solver;
  const bone = (name: string) => {
    const i = rig.index.get(name);
    if (i === undefined) throw new Error(`没有骨骼 ${name}`);
    return i;
  };
  const turned = (turns: Record<string, Quat>) => {
    const state = restState(rig);
    for (const [name, quat] of Object.entries(turns)) state.local[bone(name)] = quat;
    const frame = forward(rig, state);
    return { matrices: poseMatrices(rig, frame), frame };
  };
  return { parts, figure, skeleton, solver, rig, bone, turned };
}

/** 静止时的点 p 跟着第 bone 根骨骼搬到哪 */
const carried = (m: Float64Array, bone: number, p: readonly number[]): V3 => {
  const o = bone * 12;
  return [
    m[o] * p[0] + m[o + 1] * p[1] + m[o + 2] * p[2] + m[o + 9],
    m[o + 3] * p[0] + m[o + 4] * p[1] + m[o + 5] * p[2] + m[o + 10],
    m[o + 6] * p[0] + m[o + 7] * p[1] + m[o + 8] * p[2] + m[o + 11],
  ];
};
const head = (s: Skeleton, name: string) => s.bones.find((b) => b.name === name)!.head;
const tail = (s: Skeleton, name: string) => s.bones.find((b) => b.name === name)!.tail;
const mix = (a: readonly number[], b: readonly number[], t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

describe('摆好姿势以后的距离场', () => {
  it('骨骼数对不上会报错', () => {
    const { figure } = setup(make());
    expect(() => compilePosedField(figure, options, new Float64Array(24))).toThrow(/骨骼/);
  });

  it('没摆（每根骨骼都不动）：和静止时的场几乎处处一样', () => {
    // T-pose：手臂离身体远远的（A-pose 垂着的前臂挨着胯，静止时那里融着一点圆角，摆好以后的场里没有）
    const { figure, turned } = setup(make({ armPairs: 2, tails: 1 }, { pose: 'T' }));
    const rest = compileField(figure, options);
    const posed = compilePosedField(figure, options, turned({}).matrices);
    let count = 0;
    let exact = 0;
    let worst = 0;
    for (let x = -0.6; x <= 0.6; x += 0.05) {
      for (let y = 0; y <= 1.85; y += 0.05) {
        for (let z = -0.4; z <= 0.3; z += 0.05) {
          // 只看表面附近：离得远的地方，两类部件的值差不多大时静止的场会多减掉一点圆角，那里没有表面，不相干
          const was = fieldAt(rest, x, y, z);
          if (Math.abs(was) > 0.03) continue;
          const d = Math.abs(was - fieldAt(posed, x, y, z));
          count++;
          if (d < 1e-9) exact++;
          worst = Math.max(worst, d);
        }
      }
    }
    // 不一样的只有腿、尾巴离根部远又挨着身体的那一点地方：摆好以后那里不再融出圆角
    expect(count).toBeGreaterThan(500);
    expect(exact / count).toBeGreaterThan(0.97);
    expect(worst).toBeLessThan(0.006);
  });

  it('只转上臂（举手）：前臂是整条跟着搬过去的，身体别处不动', () => {
    const { figure, skeleton, bone, turned } = setup(make({}, { pose: 'T' }));
    const rest = compileField(figure, options);
    // 平举着的左上臂绕肩关节再往上抬 70°
    const { matrices } = turned({ UpperArm_L: quatEuler(0, 0, 70 * DEG) });
    const posed = compilePosedField(figure, options, matrices);
    const elbow = head(skeleton, 'LowerArm_L');
    const wrist = tail(skeleton, 'LowerArm_L');
    for (const t of [0.2, 0.5, 0.8]) {
      const at = mix(elbow, wrist, t);
      for (const [dx, dy, dz] of [[0, 0, 0], [0.02, 0, 0], [0, 0.03, 0], [0, 0, -0.04], [-0.02, 0.02, 0.01]]) {
        const q: V3 = [at[0] + dx, at[1] + dy, at[2] + dz];
        const p = carried(matrices, bone('LowerArm_L'), q);
        expect(fieldAt(posed, p[0], p[1], p[2])).toBeCloseTo(fieldAt(rest, q[0], q[1], q[2]), 6);
      }
    }
    // 前臂原来待的地方现在是空的
    const was = mix(elbow, wrist, 0.5);
    expect(fieldAt(rest, was[0], was[1], was[2])).toBeLessThan(-0.01);
    expect(fieldAt(posed, was[0], was[1], was[2])).toBeGreaterThan(0.05);
    // 右手臂、头、腿都没动
    for (const name of ['LowerArm_R', 'Head', 'LowerLeg_L', 'Spine']) {
      const q = mix(head(skeleton, name), tail(skeleton, name), 0.5);
      for (const off of [0, 0.03, 0.07]) expect(fieldAt(posed, q[0] + off, q[1], q[2])).toBeCloseTo(fieldAt(rest, q[0] + off, q[1], q[2]), 9);
    }
  });

  it('肩头不瘪：举过头顶以后，肩关节周围的表面离关节还是那么远，上臂根还是原来那么粗', () => {
    for (const spec of [make(), make({ armPairs: 4 }, { armLayout: 'fan' })]) {
      const { parts, figure, skeleton, bone, turned } = setup(spec);
      const rest = compileField(figure, options);
      const joint = head(skeleton, 'UpperArm_L');
      const elbow = tail(skeleton, 'UpperArm_L');
      /** 网格上离肩关节最近的顶点有多远 */
      const nearest = (mesh: { positions: Float32Array }) => {
        let least = Infinity;
        for (let v = 0; v < mesh.positions.length; v += 3) least = Math.min(least, Math.hypot(mesh.positions[v] - joint[0], mesh.positions[v + 1] - joint[1], mesh.positions[v + 2] - joint[2]));
        return least;
      };
      const deep = nearest(fuseParts(parts, { voxel: VOXEL.preview, blend: 0.02 }));
      expect(deep).toBeGreaterThan(0.02);
      for (const degrees of [60, 120, 150]) {
        const { matrices } = turned({ UpperArm_L: quatEuler(0, 0, degrees * DEG) });
        // 肩关节还埋在差不多那么深的地方（照权重扯网格的话，转到 150° 时肩头缩成一片，表面几乎贴到关节上）
        expect(nearest(fuseParts(parts, { voxel: VOXEL.preview, blend: 0.02, pose: matrices })), `${degrees}°`).toBeGreaterThan(deep * 0.7);
        // 上臂上离关节 8 厘米的那一圈：表面离骨头的远近和静止时一样（整段是搬过去的）
        const posed = compilePosedField(figure, options, matrices);
        const length = Math.hypot(elbow[0] - joint[0], elbow[1] - joint[1], elbow[2] - joint[2]);
        const q = mix(joint, elbow, 0.08 / length);
        for (const r of [0.02, 0.05]) {
          const p = carried(matrices, bone('UpperArm_L'), [q[0], q[1], q[2] + r]);
          const was = fieldAt(rest, q[0], q[1], q[2] + r);
          // 静止时在表面附近（里外一厘米多以内）的点才比：再往里，摆好以后的场在切面附近本来就浅
          if (Math.abs(was) < 0.012) expect(fieldAt(posed, p[0], p[1], p[2]), `${degrees}° ${r}`).toBeCloseTo(was, 2);
        }
      }
    }
  }, 60_000);

  it('手肘弯 110°：外侧不缺口（两个切面之间用切面的轮廓扫出来补上），也不鼓出去', () => {
    const { figure, skeleton, turned } = setup(make({}, { pose: 'T' }));
    const rest = compileField(figure, options);
    const elbow = head(skeleton, 'LowerArm_L');
    const radius = -fieldAt(rest, elbow[0], elbow[1], elbow[2]);
    expect(radius).toBeGreaterThan(0.02);
    // T-pose：手臂沿 X。前臂绕 Y 轴往前弯 110°
    const { matrices } = turned({ LowerArm_L: quatEuler(0, -110 * DEG, 0) });
    const posed = compilePosedField(figure, options, matrices);
    // 弯的外侧：上臂的方向（+X）和前臂的方向（往前）的角平分线的反方向
    const out: V3 = [Math.cos(35 * DEG), 0, -Math.sin(35 * DEG)];
    const at = (r: number) => fieldAt(posed, elbow[0] + out[0] * r, elbow[1] + out[1] * r, elbow[2] + out[2] * r);
    // 关节在身体里面（切面上的值不会正好是 0：那样网格上会沿着切面勒出一圈沟）
    expect(at(0)).toBeLessThan(-0.002);
    expect(at(radius * 0.4)).toBeLessThan(0);
    expect(at(radius * 0.7)).toBeLessThan(0);
    expect(at(radius * 1.4)).toBeGreaterThan(0);
    // 表面就在离关节一个半径上下的地方：像一个球形的关节
    expect(Math.abs(at(radius))).toBeLessThan(radius * 0.25);
  });

  it('抬腿 90°（坐下）：髋关节以上的那一截留在胯上，不跟着大腿转出去', () => {
    const { figure, skeleton, bone, turned } = setup(make());
    const rest = compileField(figure, options);
    const hip = head(skeleton, 'UpperLeg_L');
    const knee = tail(skeleton, 'UpperLeg_L');
    const { matrices } = turned({ UpperLeg_L: quatEuler(-90 * DEG, 0, 0) });
    const posed = compilePosedField(figure, options, matrices);
    // 大腿中段跟着搬过去了
    const q = mix(hip, knee, 0.6);
    const p = carried(matrices, bone('UpperLeg_L'), q);
    expect(p[2]).toBeGreaterThan(hip[2] + 0.15);
    expect(fieldAt(posed, p[0], p[1], p[2])).toBeCloseTo(fieldAt(rest, q[0], q[1], q[2]), 6);
    // 髋关节正上方 4 厘米、正后方 4 厘米：原来在身体里面，现在还在
    for (const [dy, dz] of [[0.04, 0], [0.02, -0.04]]) {
      expect(fieldAt(rest, hip[0], hip[1] + dy, hip[2] + dz)).toBeLessThan(0);
      expect(fieldAt(posed, hip[0], hip[1] + dy, hip[2] + dz)).toBeLessThan(0);
    }
    // 髋关节后上方不会多出一坨跟着大腿转上来的东西：静止时在身体外面 6 厘米以上的点，现在也还在外面
    let lumps = 0;
    for (let dy = 0; dy <= 0.2; dy += 0.02) {
      for (let dz = -0.3; dz <= -0.08; dz += 0.02) {
        if (fieldAt(rest, hip[0], hip[1] + dy, hip[2] + dz) > 0.06 && fieldAt(posed, hip[0], hip[1] + dy, hip[2] + dz) < 0) lumps++;
      }
    }
    expect(lumps).toBe(0);
  });

  it('弯腰（脊柱每节往前 25°）：躯干是顺着弯过去的，头跟着到了前面；没有无效的数', () => {
    const { figure, skeleton, bone, turned } = setup(make());
    const rest = compileField(figure, options);
    const bend = quatEuler(25 * DEG, 0, 0);
    const { matrices } = turned({ Spine: bend, Chest: bend, UpperChest: bend });
    const posed = compilePosedField(figure, options, matrices);
    const skull = mix(head(skeleton, 'Head'), tail(skeleton, 'Head'), 0.5);
    const p = carried(matrices, bone('Head'), skull);
    expect(p[2]).toBeGreaterThan(skull[2] + 0.3);
    expect(fieldAt(posed, p[0], p[1], p[2])).toBeCloseTo(fieldAt(rest, skull[0], skull[1], skull[2]), 6);
    // 胯没动
    const hips = head(skeleton, 'Hips');
    expect(fieldAt(posed, hips[0], hips[1], hips[2])).toBeCloseTo(fieldAt(rest, hips[0], hips[1], hips[2]), 2);
    for (let x = -0.4; x <= 0.4; x += 0.04) {
      for (let y = 0.7; y <= 1.8; y += 0.04) {
        for (let z = -0.3; z <= 0.8; z += 0.04) if (!Number.isFinite(fieldAt(posed, x, y, z))) throw new Error(`(${x}, ${y}, ${z}) 处不是数`);
      }
    }
  });
});

describe('照摆好的姿势融合', () => {
  it('白模人台：现成的每个姿势都融合得出来，没有无效的顶点；绝大多数是一整块', () => {
    const { parts, solver } = setup(make());
    let whole = 0;
    for (const pose of POSE_LIBRARY) {
      const frame = forward(solver.rig, stateOf(solver, pose.posing));
      const mesh = fuseParts(parts, { voxel: VOXEL.draft, blend: 0.02, pose: poseMatrices(solver.rig, frame) });
      expect(mesh.info.vertices, pose.name).toBeGreaterThan(3000);
      for (let i = 0; i < mesh.positions.length; i++) if (!Number.isFinite(mesh.positions[i])) throw new Error(`${pose.name}：第 ${i} 个坐标不是数`);
      if (mesh.info.components === 1) whole++;
      // 不是一整块的只会是手：手和别处插在一起了（抱着胳膊、手按在腿上），缝不上，就自己封口叠在那里
      expect(mesh.info.components, pose.name).toBeLessThanOrEqual(3);
    }
    expect(whole).toBeGreaterThan(POSE_LIBRARY.length * 0.85);
  }, 120_000);

  it('二次元素体、肩部聚拢的四对手臂，一条举过头顶：还是一整块，手都缝着', () => {
    useAnimeBody();
    const { parts, turned } = setup(make({ armPairs: 4 }, { armLayout: 'fan', bodyStyle: 'anime' }));
    for (const name of ['UpperArm_L', 'UpperArm_L.003']) {
      const { matrices } = turned({ [name]: quatEuler(0, 0, 130 * DEG) });
      const mesh = fuseParts(parts, { voxel: VOXEL.preview, blend: 0.02, pose: matrices });
      expect(mesh.info.components, name).toBe(1);
      expect(mesh.bound, name).toBeDefined();
    }
  }, 120_000);

  it('二次元素体本来那对手臂：没抬高时还是本来的肩膀（和「造型」里一样），抬高了才换成圆肩头', () => {
    useAnimeBody();
    const anime = (counts: Partial<BodyCounts>, rest: Partial<BodySpec> = {}) => make(counts, { bodyStyle: 'anime', ...rest });
    /** 肩关节周围：带着另一套基本体的、和把它拿掉以后的，两个场差多少 */
    const differs = (spec: BodySpec, degrees: number) => {
      const { figure, skeleton, turned } = setup(spec);
      const arm = figure.parts.find((p) => p.posed && p.side === 1);
      if (!arm) throw new Error('没有带另一套基本体的手臂');
      const upper = arm.bones!.find((b) => b.name.startsWith('UpperArm'))!.name;
      const { matrices } = turned(degrees ? { [upper]: quatEuler(0, 0, degrees * DEG) } : {});
      const plain = { parts: figure.parts.map(({ posed: _, ...part }) => part), scale: 1 };
      const a = compilePosedField(figure, options, matrices);
      const b = compilePosedField(plain, options, matrices);
      const joint = head(skeleton, upper);
      let worst = 0;
      for (let dx = -0.1; dx <= 0.1; dx += 0.025) {
        for (let dy = -0.1; dy <= 0.1; dy += 0.025) {
          for (let dz = -0.1; dz <= 0.1; dz += 0.025) {
            worst = Math.max(worst, Math.abs(fieldAt(a, joint[0] + dx, joint[1] + dy, joint[2] + dz) - fieldAt(b, joint[0] + dx, joint[1] + dy, joint[2] + dz)));
          }
        }
      }
      return worst;
    };
    // 站着不动：一对、上下排、聚在肩上的几对，本来那对手臂的肩膀都还是原样
    for (const spec of [anime({}), anime({ armPairs: 2 }), anime({ armPairs: 2 }, { armLayout: 'fan' }), anime({ armPairs: 3 }, { armLayout: 'fan' }), anime({ armPairs: 4 }, { armLayout: 'fan' })]) {
      expect(differs(spec, 0), `${spec.armLayout} ${spec.counts.armPairs}`).toBe(0);
    }
    // 一对手臂：抬到平举上下还是原样；再往上抬就换了
    expect(differs(anime({}), 40)).toBe(0);
    expect(differs(anime({}), 75)).toBeGreaterThan(0.004);
    expect(differs(anime({}), 130)).toBeGreaterThan(0.004);
  }, 60_000);

  it('手按在大腿上（坐着）：手腕周围空出一圈，两只手都缝得上，还是一整块', () => {
    const { parts, solver } = setup(make());
    const pose = POSE_LIBRARY.find((one) => one.name === '坐着')!;
    const matrices = poseMatrices(solver.rig, forward(solver.rig, stateOf(solver, pose.posing)));
    const mesh = fuseParts(parts, { voxel: VOXEL.preview, blend: 0.02, pose: matrices });
    expect(mesh.info.components).toBe(1);
    for (let i = 0; i < mesh.positions.length; i++) if (!Number.isFinite(mesh.positions[i])) throw new Error(`第 ${i} 个坐标不是数`);
  }, 60_000);

  it('手的顶点照手自带的权重摆过去了：举起的那只手在摆好以后的手腕旁边', () => {
    const { parts, skeleton, bone, turned } = setup(make());
    const { matrices } = turned({ UpperArm_L: quatEuler(0, 0, 120 * DEG) });
    const rest = fuseParts(parts, { voxel: VOXEL.draft, blend: 0.02 });
    const mesh = fuseParts(parts, { voxel: VOXEL.draft, blend: 0.02, pose: matrices });
    expect(mesh.info.components).toBe(1);
    const hands = (m: typeof mesh) => m.positions.length / 3 - m.bound!.start;
    expect(hands(mesh)).toBe(hands(rest));
    const wrist = carried(matrices, bone('Hand_L'), head(skeleton, 'Hand_L'));
    let near = 0;
    for (let v = mesh.bound!.start; v < mesh.positions.length / 3; v++) {
      if (Math.hypot(mesh.positions[v * 3] - wrist[0], mesh.positions[v * 3 + 1] - wrist[1], mesh.positions[v * 3 + 2] - wrist[2]) < 0.22) near++;
    }
    // 两只手里有一只（一半的顶点）在举起来的手腕旁边
    expect(near).toBeGreaterThan(hands(mesh) * 0.45);
    expect(near).toBeLessThan(hands(mesh) * 0.55);
  }, 60_000);
});

describe('要空出来的地方（Clearance）', () => {
  /** 一根沿 X 的圆棒（半径 2 厘米，owner 0）插在一个大球（半径 10 厘米，owner 1）里 */
  const rod: Draft = { type: T_CUSTOM, group: 0, nums: [], custom: (x, y, z) => Math.max(Math.hypot(y, z) - 0.02, Math.abs(x) - 0.3), box: [-0.3, -0.02, -0.02, 0.3, 0.02, 0.02], owner: 0 };
  const ball: Draft = { type: T_CUSTOM, group: 1, nums: [], custom: (x, y, z) => Math.hypot(x, y, z) - 0.1, box: [-0.1, -0.1, -0.1, 0.1, 0.1, 0.1], owner: 1 };
  const room = (carve: boolean, list: Int32Array): Clearance => ({ a: [-0.03, 0, 0], axis: [1, 0, 0], length: 0.06, radius: 0.08, margin: 0.01, reach: 0.015, carve, list });

  it('圆棒周围一厘米以内、那一段圆柱里面，大球被挖掉了；圆棒自己还在；圆柱外面原样', () => {
    const plain = pack([rod, ball], [0, 0]);
    const field = pack([rod, ball], [0, 0]);
    field.clear = [room(true, field.owned!.get(0)!)];
    // 圆棒里面
    expect(fieldAt(field, 0, 0, 0)).toBeCloseTo(-0.02, 9);
    expect(fieldAt(field, 0, 0.015, 0)).toBeLessThan(0);
    // 离圆棒表面 5 毫米：本来在球里面，现在空了
    expect(fieldAt(plain, 0, 0.025, 0)).toBeLessThan(-0.05);
    expect(fieldAt(field, 0, 0.025, 0)).toBeCloseTo(0.005, 9);
    // 离圆棒表面 2 厘米：球还在
    expect(fieldAt(field, 0, 0.04, 0)).toBeLessThan(0);
    // 那一段圆柱以外（沿轴 6 厘米处）：和没挖一样，圆棒还埋在球里
    expect(fieldAt(field, 0.06, 0.025, 0)).toBe(fieldAt(plain, 0.06, 0.025, 0));
    expect(fieldAt(field, 0.2, 0, 0)).toBe(fieldAt(plain, 0.2, 0, 0));
  });

  it('只护着、不挖的：什么都不变', () => {
    const plain = pack([rod, ball], [0, 0]);
    const field = pack([rod, ball], [0, 0]);
    field.clear = [room(false, field.owned!.get(0)!)];
    for (const [x, y, z] of [[0, 0, 0], [0, 0.025, 0], [0, 0.05, 0.03], [0.02, 0.09, 0], [0.2, 0, 0]]) expect(fieldAt(field, x, y, z)).toBe(fieldAt(plain, x, y, z));
  });

  it('挖开的边上圆个圆角：交界处的值比照直挖的大一点，别处一样；到了 reach 边上不跳', () => {
    // 小一点的球（半径 3.5 厘米）：球面正好经过挖开的那一层（离圆棒 1 厘米）外面一点
    const small: Draft = { ...ball, custom: (x, y, z) => Math.hypot(x, y, z) - 0.035, box: [-0.035, -0.035, -0.035, 0.035, 0.035, 0.035] };
    const hard = pack([rod, small], [0, 0]);
    hard.clear = [room(true, hard.owned!.get(0)!)];
    const soft = pack([rod, small], [0, 0]);
    soft.clear = [{ ...room(true, soft.owned!.get(0)!), soft: 0.01 }];
    // 挖开的那一层和球面之间：两个值差不多的地方圆过
    const edge: [number, number, number] = [0, 0.031, 0];
    expect(fieldAt(soft, ...edge)).toBeGreaterThan(fieldAt(hard, ...edge));
    expect(fieldAt(soft, ...edge) - fieldAt(hard, ...edge)).toBeLessThanOrEqual(0.01 / 4 + 1e-12);
    // 离交界远的地方一样：圆棒里面、挖空的正中、球深处
    for (const p of [[0, 0, 0], [0, 0.022, 0], [0.2, 0, 0]] as const) expect(fieldAt(soft, p[0], p[1], p[2]), p.join()).toBeCloseTo(fieldAt(hard, p[0], p[1], p[2]), 12);
    // 沿轴走出圆柱：值是连续的
    let last = fieldAt(soft, 0.02, 0.035, 0);
    for (let x = 0.02; x < 0.08; x += 0.0005) {
      const v = fieldAt(soft, x, 0.035, 0);
      expect(Math.abs(v - last), `x=${x.toFixed(4)}`).toBeLessThan(0.002);
      last = v;
    }
  });

  it('挖别人的时候不把旁边护着的也挖了', () => {
    // 再来一根和第一根挨着的圆棒（owner 2）：第一根周围要空出来，第二根有人护着，原样留着
    const other: Draft = { ...rod, custom: (x, y, z) => Math.max(Math.hypot(y - 0.03, z) - 0.02, Math.abs(x) - 0.3), box: [-0.3, 0.01, -0.02, 0.3, 0.05, 0.02], owner: 2 };
    const field = pack([rod, other, ball], [0, 0]);
    field.clear = [room(true, field.owned!.get(0)!), room(false, field.owned!.get(2)!)];
    expect(fieldAt(field, 0, 0.03, 0)).toBeCloseTo(-0.02, 9);
    // 没人护着的话，第二根在第一根周围一厘米以内的那一部分就没了
    const bare = pack([rod, other, ball], [0, 0]);
    bare.clear = [room(true, bare.owned!.get(0)!)];
    expect(fieldAt(bare, 0, 0.025, 0)).toBeGreaterThan(0);
  });
});

describe('哪些身体摆了姿势以后照姿势重新融合（refusable）', () => {
  it('白模人台：都要', () => {
    for (const spec of [make(), make({ armPairs: 3 }, { armLayout: 'fan' })]) {
      const { figure, turned } = setup(spec);
      expect(refusable(figure, turned({}).matrices)).toBe(true);
      expect(refusable(figure, turned({ UpperLeg_L: quatEuler(-90 * DEG, 0, 0), LowerLeg_L: quatEuler(80 * DEG, 0, 0) }).matrices)).toBe(true);
      expect(refusable(figure, turned({ UpperArm_L: quatEuler(0, 0, 120 * DEG) }).matrices)).toBe(true);
    }
  });

  it('二次元素体、几条手臂挤在一个肩膀上：要，腿怎么动都要', () => {
    useAnimeBody();
    for (const armPairs of [2, 4]) {
      const { figure, turned } = setup(make({ armPairs }, { bodyStyle: 'anime', armLayout: 'fan' }));
      expect(refusable(figure, turned({}).matrices)).toBe(true);
      expect(refusable(figure, turned({ UpperArm_L: quatEuler(0, 0, 120 * DEG), Spine: quatEuler(20 * DEG, 0, 0), Head: quatEuler(0, 40 * DEG, 0) }).matrices)).toBe(true);
      expect(refusable(figure, turned({ UpperLeg_L: quatEuler(-90 * DEG, 0, 0), LowerLeg_L: quatEuler(80 * DEG, 0, 0) }).matrices)).toBe(true);
    }
  });

  it('二次元素体、一个肩膀上只有一条手臂（一对、上下排）：不要，照权重弯的肩膀更自然', () => {
    useAnimeBody();
    for (const spec of [make({}, { bodyStyle: 'anime' }), make({ armPairs: 2 }, { bodyStyle: 'anime', armLayout: 'stack' })]) {
      const { figure, turned } = setup(spec);
      expect(refusable(figure, turned({}).matrices)).toBe(false);
      expect(refusable(figure, turned({ UpperArm_L: quatEuler(0, 0, 120 * DEG) }).matrices)).toBe(false);
    }
  });

  it('骨骼数对不上：不要', () => {
    const { figure } = setup(make());
    expect(refusable(figure, new Float64Array(24))).toBe(false);
  });

  it('二次元素体好几个上半身（一对、横排两副胯）：要，挤在一起的胸照权重弯会被拉成管子', () => {
    useAnimeBody();
    for (const spec of [make({ torsos: 2 }, { bodyStyle: 'anime' }), make({ torsos: 2, legs: 4 }, { bodyStyle: 'anime', legLayout: 'abreast' })]) {
      const { figure, turned } = setup(spec);
      expect(refusable(figure, turned({ Spine_L: quatEuler(0, 0, -30 * DEG) }).matrices)).toBe(true);
    }
  });
});

describe('二次元素体好几个上半身照姿势重新融合', () => {
  it('一个上半身往外歪开：正中的躯干还是实的（两块躯干一起顺着所有躯干骨骼弯，没从正中裂开），正中两只胸之间是空的（没有管子）', () => {
    useAnimeBody();
    for (const spec of [
      make({ torsos: 2, legs: 4 }, { bodyStyle: 'anime', legLayout: 'abreast', shape: { ...defaultSpec().shape, bust: 2.2 } }),
      make({ torsos: 2 }, { bodyStyle: 'anime', shape: { ...defaultSpec().shape, bust: 2.2 } }),
    ]) {
      const label = `腿 ${spec.counts.legs}`;
      const { figure, skeleton, turned, bone } = setup(spec);
      const { matrices } = turned({ Spine_L: quatEuler(0, 0, -35 * DEG) });
      const field = compilePosedField(figure, options, matrices);
      const rest = compileField(figure, options);
      const left = bone('UpperChest_L');
      const right = bone('UpperChest_R');
      // 正中线上、腰和胸之间躯干里面的一点：两边各照自己的上半身搬过去，中间那一点还在身体里
      const spine = head(skeleton, 'Spine_L');
      const inside: V3 = [0, spine[1] + 0.08, spine[2]];
      expect(fieldAt(rest, ...inside), label).toBeLessThan(0);
      expect(fieldAt(field, ...mix(carried(matrices, left, inside), carried(matrices, right, inside), 0.5)), label).toBeLessThan(0);
      // 里侧（正中）的两只胸：各跟着自己的上半身走、还在；两只胸尖之间原来挤着，现在是空的
      const xfs = worldTransforms(figure);
      const inner = (side: 1 | -1) => {
        const chests = figure.parts.filter((p) => p.type === 'chest' && p.name.startsWith('Chest_01') && p.parent === (side > 0 ? 'UpperBody_L' : 'UpperBody_R'));
        // 两个上半身直立并排时每个上半身各一对，里侧的是离正中近的那只
        const part = chests.sort((a, b) => Math.abs(xfs.get(a.name)!.pos[0]) - Math.abs(xfs.get(b.name)!.pos[0]))[0];
        const at = xfs.get(part.name)!.pos;
        return [at[0], at[1], at[2] + 0.04] as V3;
      };
      const l = carried(matrices, left, inner(1));
      const r = carried(matrices, right, inner(-1));
      expect(fieldAt(field, ...l), label).toBeLessThan(0);
      expect(fieldAt(field, ...r), label).toBeLessThan(0);
      // 静止时两只胸尖之间是挤着的那道沟（贴着），歪开以后中间是空的（照权重弯的话是一根管子，里面是实的）
      expect(fieldAt(rest, ...mix(inner(1), inner(-1), 0.5)), label).toBeLessThan(0.005);
      expect(fieldAt(field, ...mix(l, r, 0.5)), label).toBeGreaterThan(0);
    }
  }, 120_000);

  it('两个上半身往两边歪开：胸根只顺着自己那个上半身弯，正中两个上半身原来挤着的地方不留下「鬼影」胸', () => {
    useAnimeBody();
    const spec = make({ torsos: 2 }, { bodyStyle: 'anime', shape: { ...defaultSpec().shape, bust: 2.2 } });
    const { figure, turned, bone } = setup(spec);
    const { matrices } = turned({ Spine_L: quatEuler(0, 0, -35 * DEG), Spine_R: quatEuler(0, 0, 20 * DEG) });
    const field = compilePosedField(figure, options, matrices);
    const xfs = worldTransforms(figure);
    // 两个上半身里侧那两只胸（离正中近的）
    const inner = (body: string) =>
      figure.parts.filter((p) => p.type === 'chest' && p.parent === body).sort((a, b) => Math.abs(xfs.get(a.name)!.pos[0]) - Math.abs(xfs.get(b.name)!.pos[0]))[0];
    const left = xfs.get(inner('UpperBody_L').name)!.pos;
    const right = xfs.get(inner('UpperBody_R').name)!.pos;
    // 两只里侧的胸正中间往上 10 厘米：两个上半身歪开以后这里什么都没有。
    // 胸根跟着所有躯干骨骼弯的时候，这里倒着搬回去照胯、另一个上半身的骨骼落回胸上，多出一块胸
    const middle = mix(left, right, 0.5);
    const gap: V3 = [middle[0], middle[1] + 0.1, middle[2]];
    expect(fieldAt(field, ...gap)).toBeGreaterThan(0.005);
    // 两只里侧的胸跟着自己的上半身搬过去了，还在
    for (const [at, name] of [
      [left, 'UpperChest_L'],
      [right, 'UpperChest_R'],
    ] as const) {
      expect(fieldAt(field, ...carried(matrices, bone(name), [at[0], at[1], at[2] + 0.04])), name).toBeLessThan(0);
    }
  }, 120_000);
});

describe('二次元素体的腿（照着现成的模型采样出来的）：融合时留在胯上，融合完照权重搬过去', () => {
  const body = () => {
    useAnimeBody();
    return setup(make({ armPairs: 2 }, { bodyStyle: 'anime', armLayout: 'fan' }));
  };
  /** 网格上离一个点最近的顶点有多远 */
  const nearest = (mesh: { positions: Float32Array }, p: readonly number[], from = 0, to = mesh.positions.length / 3) => {
    let least = Infinity;
    for (let v = from; v < to; v++) least = Math.min(least, Math.hypot(mesh.positions[v * 3] - p[0], mesh.positions[v * 3 + 1] - p[1], mesh.positions[v * 3 + 2] - p[2]));
    return least;
  };

  it('heldLegs：腿没动、不是这种腿的不用管；腿动了的，腿上的骨骼都换成胯的动作，别的骨骼不变', () => {
    const { figure, bone, turned } = body();
    expect(heldLegs(figure, turned({}).matrices)).toBeNull();
    expect(heldLegs(figure, turned({ UpperArm_L: quatEuler(0, 0, 100 * DEG), Hips: quatEuler(0, 30 * DEG, 0) }).matrices)).toBeNull();
    const { matrices } = turned({ Hips: quatEuler(0, 30 * DEG, 0), UpperLeg_L: quatEuler(-80 * DEG, 0, 0), LowerLeg_L: quatEuler(60 * DEG, 0, 0), UpperArm_R: quatEuler(0, 0, -90 * DEG) });
    const held = heldLegs(figure, matrices)!;
    expect(held).not.toBeNull();
    const hips = bone('Hips') * 12;
    for (const name of ['UpperLeg_L', 'LowerLeg_L', 'Foot_L', 'UpperLeg_R', 'Foot_R']) {
      for (let k = 0; k < 12; k++) expect(held.matrices[bone(name) * 12 + k], name).toBeCloseTo(matrices[hips + k], 12);
    }
    for (const name of ['Hips', 'Spine', 'Head', 'UpperArm_R', 'LowerArm_R', 'UpperArm_L']) {
      for (let k = 0; k < 12; k++) expect(held.matrices[bone(name) * 12 + k], name).toBe(matrices[bone(name) * 12 + k]);
    }
    // 成对的下标：腿上的骨骼、带着它的骨骼
    expect(held.bones.length % 2).toBe(0);
    expect(held.bones.filter((_, i) => i % 2 === 1).every((b) => b === bone('Hips'))).toBe(true);
    expect(held.bones.filter((_, i) => i % 2 === 0)).toContain(bone('LowerLeg_L'));
    // 这些腿是哪几个部件（挖手腕周围时不挖它们，见 FuseOptions.keep）
    expect(held.legs.sort()).toEqual(['Leg_01_L', 'Leg_01_R']);
    // 白模人台的腿在距离场里摆，不用留着
    const mannequin = setup(make());
    expect(heldLegs(mannequin.figure, mannequin.turned({ UpperLeg_L: quatEuler(-80 * DEG, 0, 0) }).matrices)).toBeNull();
  });

  it('坐着、蹲着：腿到了摆好的位置，和照权重弯的那张网格上的腿是同一片表面；身体是一整块', () => {
    const { parts, skeleton, solver, bone } = body();
    const bind = fuseSkinned(parts, { voxel: VOXEL.preview, blend: 0.02 });
    for (const name of ['坐着', '蹲着']) {
      const pose = POSE_LIBRARY.find((one) => one.name === name)!;
      const matrices = poseMatrices(solver.rig, forward(solver.rig, stateOf(solver, pose.posing)));
      const mesh = fusePosed(parts, { voxel: VOXEL.preview, blend: 0.02, pose: matrices });
      for (let i = 0; i < mesh.positions.length; i++) if (!Number.isFinite(mesh.positions[i])) throw new Error(`${name}：第 ${i} 个坐标不是数`);
      // 四只手：最多各自成一块
      expect(mesh.info.components, name).toBeLessThanOrEqual(5);
      const limit = mesh.bound ? mesh.bound.start : mesh.positions.length / 3;
      // 膝盖、脚踝摆好以后在哪：那里有腿
      const knee = carried(matrices, bone('LowerLeg_L'), head(skeleton, 'LowerLeg_L'));
      const ankle = carried(matrices, bone('Foot_L'), head(skeleton, 'Foot_L'));
      expect(nearest(mesh, knee, 0, limit), `${name} 膝盖`).toBeLessThan(0.09);
      expect(nearest(mesh, ankle, 0, limit), `${name} 脚踝`).toBeLessThan(0.07);
      // 腿要是还留在胯下面没搬（融合时的样子），膝盖会在这：那里没有东西了（蹲着时脚后跟正好收在那一带，不看）
      const unmoved = carried(matrices, bone('Hips'), head(skeleton, 'LowerLeg_L'));
      expect(Math.hypot(unmoved[0] - knee[0], unmoved[1] - knee[1], unmoved[2] - knee[2]), name).toBeGreaterThan(0.25);
      if (name === '坐着') expect(nearest(mesh, unmoved, 0, limit), `${name} 没搬的膝盖`).toBeGreaterThan(0.1);
      // 照权重弯的那张网格：小腿、大腿上（腿的权重占九成以上）的顶点，在这张网格上都找得到挨着的顶点
      const skinned = Float32Array.from(bind.mesh.positions);
      skinVerticesDualInPlace(skinned, Float32Array.from(bind.mesh.normals), bind.skin.joints, bind.skin.weights, matrices);
      const legBones = new Set(['UpperLeg_L', 'LowerLeg_L', 'Foot_L', 'UpperLeg_R', 'LowerLeg_R', 'Foot_R'].map(bone));
      // 身体上的和身体上的比，缝上去的（脚）和缝上去的比
      const sewn = bind.mesh.bound ? bind.mesh.bound.start : skinned.length / 3;
      let checked = 0;
      let off = 0;
      for (let v = 0; v < sewn; v += 7) {
        let leg = 0;
        for (let k = 0; k < 4; k++) if (legBones.has(bind.skin.joints[v * 4 + k])) leg += bind.skin.weights[v * 4 + k];
        if (leg < 0.9) continue;
        checked++;
        if (nearest(mesh, [skinned[v * 3], skinned[v * 3 + 1], skinned[v * 3 + 2]], 0, limit) > 0.02) off++;
      }
      expect(checked, name).toBeGreaterThan(200);
      // 两条腿叠在一起、手压着腿的地方两张网格不一样（一张是融合时的表面，一张互相穿过去），别处都对得上
      expect(off / checked, name).toBeLessThan(0.03);
      // 缝上去的脚跟着腿搬到了摆好的位置（每个顶点都和照权重弯的那张上的一样）
      let feet = 0;
      for (let v = sewn; v < skinned.length / 3; v += 5) {
        let foot = 0;
        for (let k = 0; k < 4; k++) if (legBones.has(bind.skin.joints[v * 4 + k])) foot += bind.skin.weights[v * 4 + k];
        if (foot < 0.9) continue;
        feet++;
        expect(nearest(mesh, [skinned[v * 3], skinned[v * 3 + 1], skinned[v * 3 + 2]], limit), `${name} 脚`).toBeLessThan(0.01);
      }
      expect(feet, name).toBeGreaterThan(100);
    }
  }, 240_000);

  it('只动手臂：不用留腿，和直接照姿势融合是一回事', () => {
    const { parts, turned } = body();
    const { matrices } = turned({ UpperArm_L: quatEuler(0, 0, 110 * DEG) });
    const a = fusePosed(parts, { voxel: VOXEL.preview, blend: 0.02, pose: matrices });
    const b = fuseParts(parts, { voxel: VOXEL.preview, blend: 0.02, pose: matrices });
    expect(a.positions.length).toBe(b.positions.length);
    for (let i = 0; i < a.positions.length; i += 97) expect(a.positions[i]).toBe(b.positions[i]);
  }, 60_000);
});
