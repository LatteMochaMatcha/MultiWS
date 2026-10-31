// 成品角色的表情、视线和体型。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type CharacterBuild, assembleCharacter } from '../src/character/assemble';
import { mergeByMaterial, poseBuild } from '../src/character/export';
import { type FaceInstance, applyFaces, cleanFaces, faceLabel, fitFrame, flipFaces, gazeAt, gazeOf, gazeTurns, hasExpression, morphAmounts } from '../src/character/face';
import { CHARACTER } from '../src/character/load';
import { type CharacterSource, readCharacter } from '../src/character/source';
import { type Mat3, type Quat, type V3, mat3Apply, quatEuler, quatMat3, quatMul, rotate } from '../src/geometry/vec';
import { type BodyShape, type BodySpec, SHAPE_DEF_BY_KEY, defaultSpec } from '../src/model/spec';
import { quatAngle } from '../src/pose/math';
import { cleanPosing, emptyPosing, flipPosing, isPosed } from '../src/pose/posing';
import { forward, poseMatrices, posedBones, restState } from '../src/pose/rig';
import { turnBone } from '../src/pose/solve';
import { makeSolver, posingOf } from '../src/pose/solver';

let cached: CharacterSource | null = null;
function source(): CharacterSource {
  if (!cached) {
    const file = readFileSync(new URL(`../public/${CHARACTER.url}`, import.meta.url));
    cached = readCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, CHARACTER);
  }
  return cached;
}
const make = (rest: Partial<BodySpec> = {}, counts: Partial<BodySpec['counts']> = {}, shape: Partial<BodyShape> = {}): BodySpec => {
  const base = defaultSpec();
  return { ...base, bodyStyle: 'character', ...rest, counts: { ...base.counts, ...counts }, shape: { ...base.shape, ...shape } };
};
const build = (rest: Partial<BodySpec> = {}, counts: Partial<BodySpec['counts']> = {}, shape: Partial<BodyShape> = {}) =>
  assembleCharacter(source(), make(rest, counts, shape));
const DEG = Math.PI / 180;
const det = (m: Mat3) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
const bone = (b: CharacterBuild, name: string) => {
  const found = b.bones.find((x) => x.name === name);
  if (!found) throw new Error(`没有骨骼 ${name}`);
  return found;
};

describe('角色文件里的表情', () => {
  const face = source().face!;

  it('读得出脸上的变形：整张脸、眉、眼、嘴、尖牙各一组', () => {
    expect(face.names.length).toBeGreaterThan(30);
    for (const name of ['ALL_Joy', 'ALL_Angry', 'BRW_Sorrow', 'EYE_Close_L', 'EYE_Close_R', 'MTH_A', 'MTH_O', 'HA_Fung1']) expect(face.names).toContain(name);
    // 名字去掉了文件里那一长串前缀
    for (const name of face.names) expect(name).not.toMatch(/M_F00|Fcl_/);
    const count = face.rest.length / 3;
    expect(count).toBeGreaterThan(1000);
    for (const list of [face.positions, face.normals]) {
      expect(list).toHaveLength(face.names.length);
      for (const data of list) expect(data.length).toBe(count * 3);
    }
  });

  it('文件里定好的表情都认得：喜怒哀乐、眨眼、五个嘴型', () => {
    const keys = face.expressions.map((e) => e.key);
    for (const key of ['joy', 'angry', 'sorrow', 'fun', 'surprised', 'blink', 'blink_l', 'blink_r', 'a', 'i', 'u', 'e', 'o']) expect(keys).toContain(key);
    for (const e of face.expressions) for (const bind of e.binds) expect(face.names[bind.morph]).toBeDefined();
    expect(face.expressions.find((e) => e.key === 'joy')!.binds).toEqual([{ morph: face.names.indexOf('ALL_Joy'), weight: 1 }]);
    expect(hasExpression(face, 'joy')).toBe(true);
    expect(hasExpression(face, 'HA_Fung1')).toBe(true);
    expect(hasExpression(face, 'nothing')).toBe(false);
    expect(hasExpression(undefined, 'joy')).toBe(false);
  });

  it('眼珠能转多少度也读出来了：往外比往里多', () => {
    expect(face.look.outer).toBeGreaterThan(face.look.inner);
    for (const v of Object.values(face.look)) {
      expect(v).toBeGreaterThan(3);
      expect(v).toBeLessThan(40);
    }
  });

  it('脸上的网格记着每个顶点是原始脸部网格的第几个；别的网格没有', () => {
    const marked = source().chunks.filter((c) => c.faceVertex);
    expect(marked.length).toBeGreaterThan(3);
    for (const chunk of marked) {
      expect(chunk.name).toMatch(/^Face/);
      expect(chunk.faceVertex!.length).toBe(chunk.positions.length / 3);
      chunk.faceVertex!.forEach((f, v) => {
        // 就是原来那个顶点：位置对得上
        for (let k = 0; k < 3; k++) expect(chunk.positions[v * 3 + k]).toBeCloseTo(face.rest[f * 3 + k], 6);
      });
    }
    expect(source().chunks.some((c) => /^Body/.test(c.name) && c.faceVertex)).toBe(false);
  });

  it('开心：嘴角那一带的顶点往上、往两边走，位移是左右对称的', () => {
    const joy = face.positions[face.names.indexOf('ALL_Joy')];
    let most = 0;
    let sumX = 0;
    for (let i = 0; i < joy.length; i += 3) {
      most = Math.max(most, Math.hypot(joy[i], joy[i + 1], joy[i + 2]));
      sumX += joy[i];
    }
    expect(most).toBeGreaterThan(0.005);
    expect(most).toBeLessThan(0.05);
    // 左边往左多少、右边就往右多少：加起来差不多是零
    expect(Math.abs(sumX) / (joy.length / 3)).toBeLessThan(1e-4);
  });
});

describe('从原始的脸换算到现在这张脸', () => {
  it('一批点转了方向、放大、挪了位置：找得回那个 3×3', () => {
    const q = quatEuler(0.3, -0.8, 0.2);
    const scale = 1.37;
    const from = new Float32Array(60);
    for (let i = 0; i < from.length; i++) from[i] = (((i * 7919 + 13) % 97) / 97 - 0.5) * 0.2;
    const positions = new Float32Array(60);
    for (let v = 0; v < 20; v++) {
      const p = rotate(q, [from[v * 3] * scale, from[v * 3 + 1] * scale, from[v * 3 + 2] * scale]);
      positions.set([p[0] + 0.4, p[1] - 1.2, p[2] + 0.05], v * 3);
    }
    const fit = fitFrame(from, [{ positions, vertex: Int32Array.from({ length: 20 }, (_, i) => i) }])!;
    const want = quatMat3(q);
    fit.turn.forEach((v, i) => expect(v).toBeCloseTo(want[i], 5));
    fit.frame.forEach((v, i) => expect(v).toBeCloseTo(want[i] * scale, 5));
    expect(quatAngle(quatMul([-fit.quat[0], -fit.quat[1], -fit.quat[2], fit.quat[3]], q))).toBeLessThan(1e-4);
  });

  it('点太少、点都在一个平面上：算不出来', () => {
    const from = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(fitFrame(from, [{ positions: from, vertex: Int32Array.from([0, 1, 2]) }])).toBeNull();
    const flat = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0]);
    expect(fitFrame(flat, [{ positions: flat, vertex: Int32Array.from([0, 1, 2, 3, 4]) }])).toBeNull();
  });

  it('不是脸上的顶点（-1）不算进去', () => {
    const from = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]);
    const positions = new Float32Array([...from, 99, 99, 99]);
    const fit = fitFrame(from, [{ positions, vertex: Int32Array.from([0, 1, 2, 3, 4, -1]) }])!;
    fit.frame.forEach((v, i) => expect(v).toBeCloseTo(i % 4 === 0 ? 1 : 0, 5));
  });
});

describe('拼好以后的脸', () => {
  it('一个头：一张脸，朝向没变，大小跟着身高和头身比', () => {
    const b = build();
    expect(b.faces.map((f) => f.key)).toEqual(['Head']);
    expect(b.morphs).toBe(source().face);
    const face = b.faces[0];
    expect(face.bone).toBe('Head');
    expect(face.eyes).toEqual(['Eye_L', 'Eye_R']);
    for (const name of face.eyes!) expect(b.bones.some((x) => x.name === name)).toBe(true);
    expect(quatAngle(face.quat)).toBeLessThan(1e-3);
    const big = build({}, {}, { headRatio: 6 }).faces[0];
    expect(Math.cbrt(det(big.frame))).toBeGreaterThan(Math.cbrt(det(face.frame)) * 1.15);
    // 只管转向的那一部分是个纯旋转
    expect(det(face.turn)).toBeCloseTo(1, 4);
  });

  it('三个头：三张脸各有各的名字和眼睛骨骼，两边的头转的方向互为镜像', () => {
    const b = build({}, { heads: 3 });
    expect(b.faces.map((f) => f.key)).toEqual(['Head', 'Head.002', 'Head.003']);
    expect(b.faces.map((f) => f.bone)).toEqual(['Head', 'Head.002', 'Head.003']);
    expect(b.faces[1].eyes).toEqual(['Eye_L.002', 'Eye_R.002']);
    for (const f of b.faces) for (const name of f.eyes!) expect(b.bones.some((x) => x.name === name), name).toBe(true);
    const [, a, c] = b.faces;
    expect(quatAngle(a.quat)).toBeGreaterThan(10 * DEG);
    expect(quatAngle(quatMul([a.quat[0], -a.quat[1], -a.quat[2], a.quat[3]], [-c.quat[0], -c.quat[1], -c.quat[2], c.quat[3]]))).toBeLessThan(1e-3);
    expect(b.faces.map((f) => faceLabel(f.key))).toEqual(['头 1', '头 2', '头 3']);
  });

  it('一个头三张脸：多出来的两张跟着同一个头，没有自己的眼睛骨骼，朝着两边', () => {
    const b = build({ headLayout: 'faces' }, { heads: 3 });
    expect(b.faces.map((f) => f.key)).toEqual(['Head', 'Head/2', 'Head/3']);
    expect(b.faces.map((f) => f.bone)).toEqual(['Head', 'Head', 'Head']);
    expect(b.faces.map((f) => f.eyes)).toEqual([['Eye_L', 'Eye_R'], null, null]);
    for (const f of b.faces.slice(1)) {
      // 脸朝的方向（原来朝 +Z）现在朝着左右
      const facing = mat3Apply(f.turn, [0, 0, 1]);
      expect(Math.abs(facing[0])).toBeGreaterThan(0.95);
      // 比正面那张小一圈
      expect(Math.cbrt(det(f.frame))).toBeLessThan(Math.cbrt(det(b.faces[0].frame)) * 0.97);
    }
    expect(b.faces.map((f) => faceLabel(f.key))).toEqual(['头 1', '脸 2', '脸 3']);
  });

  it('每块脸上的网格都记着自己是第几张脸；并成一块以后还查得到', () => {
    const b = build({}, { heads: 2 });
    const marked = b.meshes.filter((m) => m.faceVertex);
    expect(marked.length).toBeGreaterThan(6);
    for (const m of marked) {
      expect(m.faceOf!.length).toBe(m.faceVertex!.length);
      expect(new Set(m.faceOf).size).toBe(1);
      expect(m.faceOf![0]).toBeLessThan(b.faces.length);
    }
    const merged = mergeByMaterial(b);
    const total = (list: typeof merged) => list.reduce((sum, m) => sum + (m.faceVertex ? [...m.faceVertex].filter((f) => f >= 0).length : 0), 0);
    expect(total(merged)).toBe(total(marked));
    // 脸和身体共用一种材质的话，身体的顶点记的是 -1
    for (const m of merged) if (m.faceVertex) expect(m.faceVertex.length).toBe(m.positions.length / 3);
    expect(new Set(merged.flatMap((m) => (m.faceOf && m.faceVertex ? [...m.faceOf].filter((_, v) => m.faceVertex![v] >= 0) : []))).size).toBe(2);
  });
});

describe('套表情', () => {
  const b = build({}, { heads: 3 });
  const morphs = b.morphs!;
  /** 套上表情以后每块网格的顶点（没动的那块原样） */
  const posed = (faces: Record<string, Record<string, number>>) =>
    b.meshes.map((m) => {
      const p = m.positions.slice();
      const n = m.normals.slice();
      applyFaces(b, m, faces, p, n);
      return p;
    });
  const movedOn = (faces: Record<string, Record<string, number>>) => {
    const out = b.faces.map(() => 0);
    const after = posed(faces);
    b.meshes.forEach((m, i) => {
      if (!m.faceOf) return;
      for (let v = 0; v < m.faceOf.length; v++) {
        if (Math.hypot(after[i][v * 3] - m.positions[v * 3], after[i][v * 3 + 1] - m.positions[v * 3 + 1], after[i][v * 3 + 2] - m.positions[v * 3 + 2]) > 1e-6) out[m.faceOf[v]]++;
      }
    });
    return out;
  };

  it('只动点名的那张脸；没有表情、名字不认得就什么都不动', () => {
    const [own, second, third] = movedOn({ 'Head.002': { joy: 1 } });
    expect(own).toBe(0);
    expect(second).toBeGreaterThan(500);
    expect(third).toBe(0);
    expect(movedOn({})).toEqual([0, 0, 0]);
    expect(movedOn({ Head: { whatever: 1 } })).toEqual([0, 0, 0]);
    expect(movedOn({ 'Head.009': { joy: 1 } })).toEqual([0, 0, 0]);
    const m = b.meshes.find((x) => x.faceVertex)!;
    expect(applyFaces(b, m, undefined, m.positions.slice(), m.normals.slice())).toBe(false);
    expect(applyFaces(b, b.meshes.find((x) => !x.faceVertex)!, { Head: { joy: 1 } }, new Float32Array(3), new Float32Array(3))).toBe(false);
  });

  it('位移是文件里那个位移照这张脸转过、放大过的；开一半就是一半', () => {
    const joy = morphs.positions[morphs.names.indexOf('ALL_Joy')];
    for (const [index, instance] of b.faces.entries()) {
      const full = posed({ [instance.key]: { joy: 1 } });
      const half = posed({ [instance.key]: { joy: 0.5 } });
      let checked = 0;
      b.meshes.forEach((m, i) => {
        if (!m.faceOf || m.faceOf[0] !== index) return;
        for (let v = 0; v < m.faceVertex!.length; v += 37) {
          const f = m.faceVertex![v];
          const want = mat3Apply(instance.frame, [joy[f * 3], joy[f * 3 + 1], joy[f * 3 + 2]]);
          for (let k = 0; k < 3; k++) {
            expect(full[i][v * 3 + k] - m.positions[v * 3 + k]).toBeCloseTo(want[k], 5);
            expect(half[i][v * 3 + k] - m.positions[v * 3 + k]).toBeCloseTo(want[k] / 2, 5);
          }
          checked++;
        }
      });
      expect(checked).toBeGreaterThan(20);
    }
  });

  it('直接写变形的名字也行（尖牙）；几种表情一起开，同一个变形最多开到头', () => {
    expect(movedOn({ Head: { HA_Fung1: 1 } })[0]).toBeGreaterThan(5);
    const joy = morphs.names.indexOf('ALL_Joy');
    expect(morphAmounts(morphs, { joy: 0.7, ALL_Joy: 0.6 }).get(joy)).toBe(1);
    expect(morphAmounts(morphs, { joy: 0.25 }).get(joy)).toBeCloseTo(0.25, 9);
    expect(morphAmounts(morphs, { joy: 0, nothing: 1 }).size).toBe(0);
    // 「特殊眼」一次开两个变形
    expect(morphAmounts(morphs, { extra: 1 }).size).toBe(2);
  });

  it('闭左眼动的是她左边（+X）的眼睛', () => {
    const one = build();
    let left = 0;
    let right = 0;
    for (const m of one.meshes) {
      if (!m.faceVertex) continue;
      const p = m.positions.slice();
      applyFaces(one, m, { Head: { blink_l: 1 } }, p, m.normals.slice());
      for (let v = 0; v < m.faceVertex.length; v++) {
        if (Math.abs(p[v * 3 + 1] - m.positions[v * 3 + 1]) < 1e-5) continue;
        // 鼻梁正中那几个点两边都沾一点，不算
        if (m.positions[v * 3] > 0) left++;
        else if (m.positions[v * 3] < -0.01) right++;
      }
    }
    expect(left).toBeGreaterThan(20);
    expect(right).toBe(0);
  });

  it('导出摆好的样子：表情加在脸上，再跟着头的骨骼转过去', () => {
    const one = build();
    const solver = makeSolver(one.bones);
    const head = solver.rig.index.get('Head')!;
    const state = turnBone(solver, restState(solver.rig), head, quatEuler(0, 0.6, 0), []);
    const frame = forward(solver.rig, state);
    const bones = posedBones(solver.rig, frame);
    const plain = poseBuild(one, poseMatrices(solver.rig, frame), bones);
    const smiling = poseBuild(one, poseMatrices(solver.rig, frame), bones, { Head: { joy: 1 } });
    expect(smiling.bones).toBe(bones);
    const joy = one.morphs!.positions[one.morphs!.names.indexOf('ALL_Joy')];
    let checked = 0;
    one.meshes.forEach((m, i) => {
      if (!m.faceVertex) {
        expect(smiling.meshes[i].positions).toEqual(plain.meshes[i].positions);
        return;
      }
      for (let v = 0; v < m.faceVertex.length; v += 41) {
        const f = m.faceVertex[v];
        // 位移先照这张脸换算，再跟着头转
        const want = rotate(frame.rot[head], mat3Apply(one.faces[0].frame, [joy[f * 3], joy[f * 3 + 1], joy[f * 3 + 2]]));
        for (let k = 0; k < 3; k++) expect(smiling.meshes[i].positions[v * 3 + k] - plain.meshes[i].positions[v * 3 + k]).toBeCloseTo(want[k], 4);
        checked++;
      }
      // 法线还是单位长度
      const n = smiling.meshes[i].normals;
      for (let v = 0; v < n.length; v += 3 * 53) expect(Math.hypot(n[v], n[v + 1], n[v + 2])).toBeCloseTo(1, 4);
    });
    expect(checked).toBeGreaterThan(20);
    // 原来那份没被改
    expect(one.meshes[0].positions).not.toBe(smiling.meshes[0].positions);
  });
});

describe('表情的数据', () => {
  it('读进来的数据收拾干净：不是数字的、等于零的不留，超过 1 的收到 1', () => {
    expect(cleanFaces({ Head: { joy: 0.5, angry: 0, fun: 3, sorrow: 'x', a: Number.NaN, o: -1 }, 'Head.002': {}, bad: 5, list: [1] })).toEqual({ Head: { joy: 0.5, fun: 1 } });
    for (const junk of [null, undefined, 3, 'x', [], {}, { Head: {} }]) expect(cleanFaces(junk)).toBeUndefined();
  });

  it('跟着姿势一起存、一起读；只摆了表情也算摆过', () => {
    const posing = cleanPosing({ version: 3, bones: {}, faces: { Head: { joy: 0.8, junk: 'x' } } });
    expect(posing.faces).toEqual({ Head: { joy: 0.8 } });
    expect(isPosed(posing)).toBe(true);
    expect(isPosed(emptyPosing())).toBe(false);
    expect(cleanPosing({ bones: {}, faces: { Head: {} } }).faces).toBeUndefined();
    expect(JSON.parse(JSON.stringify(posing))).toEqual(posing);
  });

  it('左右翻转：闭的是左眼，翻过来闭右眼；不分左右的表情不变', () => {
    expect(flipFaces({ Head: { blink_l: 1, joy: 0.5, EYE_Joy_R: 0.3 } })).toEqual({ Head: { blink_r: 1, joy: 0.5, EYE_Joy_L: 0.3 } });
    const flipped = flipPosing({ version: 3, bones: { Head: [0, 0.3, 0, 0.954] }, faces: { 'Head.002': { blink_r: 1 } } });
    expect(flipped.faces).toEqual({ 'Head.002': { blink_l: 1 } });
    expect(flipPosing({ version: 3, bones: {} }).faces).toBeUndefined();
  });

  it('改姿势的时候表情原样带着；换一份没有表情的姿势数据，表情就没有了', () => {
    const one = build();
    const solver = makeSolver(one.bones);
    const state = turnBone(solver, restState(solver.rig), solver.rig.index.get('Head')!, quatEuler(0, 0.3, 0), []);
    const faces = { Head: { angry: 1 } };
    expect(posingOf(solver, state, { version: 3, bones: {}, faces }).faces).toBe(faces);
    expect(posingOf(solver, state, emptyPosing()).faces).toBeUndefined();
    expect(posingOf(solver, state).faces).toBeUndefined();
    // 身体没动、只有表情：存下来也不是空的
    expect(isPosed(posingOf(solver, restState(solver.rig), { version: 3, bones: {}, faces }))).toBe(true);
  });

  it('脸的名字给人看的写法', () => {
    expect(faceLabel('Head')).toBe('头 1');
    expect(faceLabel('Head.003')).toBe('头 3');
    expect(faceLabel('Head/2')).toBe('脸 2');
  });
});

describe('视线', () => {
  const look = { outer: 14, inner: 9, down: 16, up: 12 };
  const straight: Pick<FaceInstance, 'quat'> = { quat: [0, 0, 0, 1] };
  const forwardOf = (q: Quat) => rotate(q, [0, 0, 1]);
  const yawOf = (q: Quat) => Math.atan2(forwardOf(q)[0], forwardOf(q)[2]) / DEG;
  const pitchOf = (q: Quat) => Math.asin(forwardOf(q)[1]) / DEG;

  it('正中是不转；往她的左边看，两只眼睛都往 +X 转，左眼（往外）转得比右眼（往里）多', () => {
    for (const q of gazeTurns([0, 0], look, straight)) expect(quatAngle(q)).toBeLessThan(1e-9);
    const [left, right] = gazeTurns([1, 0], look, straight);
    expect(yawOf(left)).toBeCloseTo(14, 5);
    expect(yawOf(right)).toBeCloseTo(9, 5);
    const [l2, r2] = gazeTurns([-1, 0], look, straight);
    expect(yawOf(l2)).toBeCloseTo(-9, 5);
    expect(yawOf(r2)).toBeCloseTo(-14, 5);
  });

  it('往上看是往 +Y 转；上下各有各的限度；超出 -1 – 1 的收回来', () => {
    expect(pitchOf(gazeTurns([0, 1], look, straight)[0])).toBeCloseTo(12, 5);
    expect(pitchOf(gazeTurns([0, -0.5], look, straight)[1])).toBeCloseTo(-8, 5);
    expect(pitchOf(gazeTurns([0, 5], look, straight)[0])).toBeCloseTo(12, 5);
  });

  it('转成骨骼的旋转再量回来，是原来的视线', () => {
    const tilted: Pick<FaceInstance, 'quat'> = { quat: quatEuler(-0.1, 0.5, 0.25) };
    for (const instance of [straight, tilted]) {
      for (const gaze of [[0, 0], [1, 0], [-0.4, 0.7], [0.25, -1], [-1, -1]] as [number, number][]) {
        const back = gazeOf(gazeTurns(gaze, look, instance)[0], look, instance);
        expect(back[0]).toBeCloseTo(gaze[0], 2);
        expect(back[1]).toBeCloseTo(gaze[1], 2);
      }
    }
  });

  it('头静止时是歪着的：眼睛绕的是这张脸自己的轴', () => {
    const turned: Pick<FaceInstance, 'quat'> = { quat: quatEuler(0, Math.PI / 2, 0) };
    // 这张脸朝着 +X；往它自己的左边看，是往 -Z 那边转
    const [left] = gazeTurns([1, 0], look, turned);
    const moved = rotate(left, [1, 0, 0]);
    expect(moved[2]).toBeLessThan(-0.2);
    expect(Math.abs(moved[1])).toBeLessThan(1e-6);
  });

  it('看向一个点：正前方是正中，在她左边是往左，在上面是往上，偏得多了就转到头', () => {
    const eye: V3 = [0, 1.5, 0];
    const facing: Quat = [0, 0, 0, 1];
    expect(gazeAt(eye, facing, [0, 1.5, 2])).toEqual([0, 0]);
    expect(gazeAt(eye, facing, [1, 1.5, 2])[0]).toBeGreaterThan(0.3);
    expect(gazeAt(eye, facing, [-1, 1.5, 2])[0]).toBeLessThan(-0.3);
    expect(gazeAt(eye, facing, [0, 2.2, 2])[1]).toBeGreaterThan(0.3);
    expect(gazeAt(eye, facing, [0, 0.5, 2])[1]).toBeLessThan(-0.3);
    expect(gazeAt(eye, facing, [5, 1.5, 0.1])).toEqual([1, 0]);
    expect(gazeAt(eye, facing, eye)).toEqual([0, 0]);
    // 头转过去了：原来在正前方的点现在在她的右边
    expect(gazeAt(eye, quatEuler(0, 0.8, 0), [0, 1.5, 2])[0]).toBeLessThan(-0.5);
  });

  it('在角色的骨架上：转眼睛的骨骼，存进姿势里的就是那两根', () => {
    const one = build();
    const solver = makeSolver(one.bones);
    const face = one.faces[0];
    const state = restState(solver.rig);
    const turns = gazeTurns([0.5, 0.2], one.morphs!.look, face);
    face.eyes!.forEach((name, i) => (state.local[solver.rig.index.get(name)!] = turns[i]));
    const posing = posingOf(solver, state);
    expect(Object.keys(posing.bones).filter((name) => /^Eye_/.test(name)).sort()).toEqual(['Eye_L', 'Eye_R']);
    const back = gazeOf(state.local[solver.rig.index.get('Eye_L')!], one.morphs!.look, face);
    expect(back[0]).toBeCloseTo(0.5, 2);
    expect(back[1]).toBeCloseTo(0.2, 2);
  });
});

describe('成品角色的体型', () => {
  // T-pose：手臂平举着，量腰和胯的时候不会把垂着的手算进去
  const base = build({ pose: 'T' });
  const shaped = (shape: Partial<BodyShape>) => build({ pose: 'T' }, {}, shape);
  /** 某个高度上下一小段里，躯干（不算手臂）左右有多宽、前后有多厚 */
  const girth = (b: CharacterBuild, y: number, reach = 0.2) => {
    let wide = 0;
    let front = -Infinity;
    let back = Infinity;
    for (const m of b.meshes) {
      if (/^Hair/i.test(m.name)) continue;
      for (let v = 0; v < m.positions.length / 3; v++) {
        if (Math.abs(m.positions[v * 3 + 1] - y) > 0.015 || Math.abs(m.positions[v * 3]) > reach) continue;
        wide = Math.max(wide, Math.abs(m.positions[v * 3]));
        front = Math.max(front, m.positions[v * 3 + 2]);
        back = Math.min(back, m.positions[v * 3 + 2]);
      }
    }
    return { wide, deep: front - back };
  };
  const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const top = (b: CharacterBuild) => b.metrics.height;
  const waistY = (bone(base, 'Spine').head[1] + bone(base, 'Chest').head[1]) / 2;
  const hipY = bone(base, 'UpperLeg_L').head[1];

  it('滑块都在原位时，和以前一模一样', () => {
    const again = shaped({ waist: 1, hips: 1, limbs: 1, armLength: 1, shoulders: 1 });
    again.meshes.forEach((m, i) => expect(m.positions).toEqual(base.meshes[i].positions));
    expect(again.bones).toEqual(base.bones);
  });

  it('腰宽：腰那一段变窄、变宽，肩膀和膝盖不动，身高不变', () => {
    const thin = shaped({ waist: 0.8 });
    const wide = shaped({ waist: 1.3 });
    const at = girth(base, waistY, 0.25).wide;
    expect(girth(thin, waistY, 0.25).wide).toBeLessThan(at * 0.86);
    expect(girth(wide, waistY, 0.25).wide).toBeGreaterThan(at * 1.2);
    expect(girth(wide, waistY, 0.25).deep).toBeGreaterThan(girth(base, waistY, 0.25).deep * 1.1);
    for (const b of [thin, wide]) {
      expect(top(b)).toBeCloseTo(top(base), 4);
      for (const name of ['UpperArm_L', 'LowerLeg_L', 'Head', 'Hand_R']) expect(dist(bone(b, name).head, bone(base, name).head), name).toBeLessThan(1e-5);
    }
  });

  it('胯宽：胯那一段和大腿根变宽，髋关节跟着往外，膝盖以下不动', () => {
    const wide = shaped({ hips: 1.4 });
    const narrow = shaped({ hips: 0.8 });
    expect(girth(wide, hipY, 0.4).wide).toBeGreaterThan(girth(base, hipY, 0.4).wide * 1.25);
    expect(girth(narrow, hipY, 0.4).wide).toBeLessThan(girth(base, hipY, 0.4).wide * 0.87);
    expect(bone(wide, 'UpperLeg_L').head[0]).toBeGreaterThan(bone(base, 'UpperLeg_L').head[0] * 1.3);
    // 右边也一样（这个角色本身左右差着不到一毫米）
    expect(bone(wide, 'UpperLeg_R').head[0]).toBeLessThan(bone(base, 'UpperLeg_R').head[0] * 1.3);
    expect(Math.abs(bone(wide, 'UpperLeg_R').head[0] + bone(wide, 'UpperLeg_L').head[0])).toBeLessThan(0.002);
    for (const name of ['Foot_L', 'Foot_R', 'UpperArm_L', 'Head']) expect(dist(bone(wide, name).head, bone(base, name).head), name).toBeLessThan(1e-5);
    expect(dist(bone(wide, 'LowerLeg_L').head, bone(base, 'LowerLeg_L').head)).toBeLessThan(0.006);
    expect(top(wide)).toBeCloseTo(top(base), 4);
  });

  it('四肢粗细：手臂、腿变粗，关节的高度不变，两条大腿没有长到一起去', () => {
    const thick = build({ pose: 'T' }, {}, { limbs: 1.3 });
    const plain = build({ pose: 'T' });
    // 上臂中段（T-pose 时手臂是横着的）：上下有多粗
    const armGirth = (b: CharacterBuild) => {
      const a = bone(b, 'UpperArm_L').head;
      const e = bone(b, 'LowerArm_L').head;
      const x = (a[0] + e[0]) / 2;
      let high = -Infinity;
      let low = Infinity;
      for (const m of b.meshes) {
        for (let v = 0; v < m.positions.length / 3; v++) {
          if (Math.abs(m.positions[v * 3] - x) > 0.01 || Math.abs(m.positions[v * 3 + 1] - a[1]) > 0.15) continue;
          high = Math.max(high, m.positions[v * 3 + 1]);
          low = Math.min(low, m.positions[v * 3 + 1]);
        }
      }
      return high - low;
    };
    expect(armGirth(thick)).toBeGreaterThan(armGirth(plain) * 1.2);
    // 小腿中段左右有多宽
    const calfY = (bone(plain, 'LowerLeg_L').head[1] + bone(plain, 'Foot_L').head[1]) / 2;
    const calf = (b: CharacterBuild) => {
      let out = 0;
      let inn = Infinity;
      for (const m of b.meshes) {
        for (let v = 0; v < m.positions.length / 3; v++) {
          const x = m.positions[v * 3];
          if (x <= 0 || Math.abs(m.positions[v * 3 + 1] - calfY) > 0.01) continue;
          out = Math.max(out, x);
          inn = Math.min(inn, x);
        }
      }
      return { width: out - inn, inner: inn };
    };
    expect(calf(thick).width).toBeGreaterThan(calf(plain).width * 1.2);
    // 大腿根：左腿最靠里的地方没有越过中线
    const thighY = hipY - 0.06;
    let inner = Infinity;
    for (const m of thick.meshes) {
      if (!/Body/.test(m.name)) continue;
      for (let v = 0; v < m.positions.length / 3; v++) {
        let onLeftLeg = 0;
        for (let k = 0; k < 4; k++) if (/^(UpperLeg|LowerLeg)_L$/.test(thick.bones[m.joints[v * 4 + k]].name)) onLeftLeg += m.weights[v * 4 + k];
        if (onLeftLeg > 0.9 && Math.abs(m.positions[v * 3 + 1] - thighY) < 0.02) inner = Math.min(inner, m.positions[v * 3]);
      }
    }
    expect(inner).toBeGreaterThan(0);
    for (const name of ['LowerLeg_L', 'Foot_L', 'LowerArm_L', 'Hand_L']) expect(bone(thick, name).head[1]).toBeCloseTo(bone(plain, name).head[1], 4);
    expect(top(thick)).toBeCloseTo(top(plain), 4);
  });

  it('手臂长短：肩到手腕拉长了，手还是原来那么大', () => {
    const long = build({ pose: 'T' }, {}, { armLength: 1.2 });
    const short = build({ pose: 'T' }, {}, { armLength: 0.85 });
    const plain = build({ pose: 'T' });
    const armOf = (b: CharacterBuild, side: string) => dist(bone(b, `UpperArm_${side}`).head, bone(b, `Hand_${side}`).head);
    const handOf = (b: CharacterBuild, side: string) => dist(bone(b, `Hand_${side}`).head, bone(b, `Middle3_${side}`).tail);
    for (const side of ['L', 'R']) {
      expect(armOf(long, side)).toBeCloseTo(armOf(plain, side) * 1.2, 3);
      expect(armOf(short, side)).toBeCloseTo(armOf(plain, side) * 0.85, 3);
      expect(handOf(long, side)).toBeCloseTo(handOf(plain, side), 3);
      expect(handOf(short, side)).toBeCloseTo(handOf(plain, side), 3);
    }
    // 肩关节没动
    expect(dist(bone(long, 'UpperArm_L').head, bone(plain, 'UpperArm_L').head)).toBeLessThan(1e-5);
    // A-pose、多对手臂也是照改过的长度摆、照改过的手臂复制
    const many = build({}, { armPairs: 2 }, { armLength: 1.2 });
    const usual = build({}, { armPairs: 2 });
    for (const side of ['L', 'R.002']) expect(armOf(many, side)).toBeCloseTo(armOf(usual, side) * 1.2, 2);
  });

  it('肩宽：肩关节往外、往里挪，腰和腿不动', () => {
    const wide = shaped({ shoulders: 1.3 });
    const narrow = shaped({ shoulders: 0.85 });
    const at = bone(base, 'UpperArm_L').head[0];
    expect(bone(wide, 'UpperArm_L').head[0]).toBeCloseTo(at * 1.3, 2);
    expect(bone(narrow, 'UpperArm_L').head[0]).toBeCloseTo(at * 0.85, 2);
    expect(Math.abs(bone(wide, 'UpperArm_R').head[0] + bone(wide, 'UpperArm_L').head[0])).toBeLessThan(0.002);
    for (const b of [wide, narrow]) {
      for (const name of ['UpperLeg_L', 'Foot_R', 'Hips', 'Head']) expect(dist(bone(b, name).head, bone(base, name).head), name).toBeLessThan(1e-5);
      expect(girth(b, hipY, 0.4).wide).toBeCloseTo(girth(base, hipY, 0.4).wide, 4);
    }
  });

  it('调到两头、几样一起调，拼出来的东西都是好的：没有坏数，左右对称，脸还认得出来', () => {
    const def = (key: keyof BodyShape) => SHAPE_DEF_BY_KEY[key];
    for (const pick of ['min', 'max'] as const) {
      const shape = Object.fromEntries((['waist', 'hips', 'limbs', 'armLength', 'shoulders'] as const).map((key) => [key, def(key)[pick]]));
      for (const counts of [{}, { heads: 3, armPairs: 3 }, { legs: 4 }]) {
        const b = build({}, counts, shape);
        for (const m of b.meshes) for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
        for (const x of b.bones) {
          if (!/_L$/.test(x.name)) continue;
          const twin = b.bones.find((y) => y.name === x.name.replace(/_L$/, '_R'));
          // 这个角色本身左右就差着不到一毫米
          if (twin) expect(Math.abs(twin.head[0] + x.head[0]), x.name).toBeLessThan(0.003);
        }
        expect(b.faces.length).toBeGreaterThan(0);
        for (const f of b.faces) expect(det(f.turn)).toBeCloseTo(1, 3);
      }
    }
  });
});
