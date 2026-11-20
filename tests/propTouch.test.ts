import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { V3 } from '../src/geometry/vec';
import { PROP_KINDS, type PropKind, type SceneProp, clampProp, makeAssetProp, makeProp } from '../src/model/props';
import { PROP_ASSETS } from '../src/props/catalog';
import { installPropAssets, propAssetsReady } from '../src/props/library';
import type { Capsule } from '../src/scene/interact';
import { closestOnSolid, insideSolid, propClashes, propSolid, pushOutOfSolids, slideOutOfSolids, solidDistance } from '../src/scene/propTouch';

const at0 = { x: 0, z: 0, yaw: 0 };
const prop = (kind: PropKind, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeProp([], kind, at0), id, ...patch });
const asset = (name: string, patch: Partial<SceneProp> = {}, id = 'p1'): SceneProp => clampProp({ ...makeAssetProp([], name, at0)!, id, ...patch });
const cap = (a: V3, b: V3, r: number, bone = 'Spine', part: Capsule['part'] = 'torso'): Capsule => ({ a, b, r, bone, part });

if (!propAssetsReady()) {
  const file = readFileSync('public/props/lowpoly.bin');
  installPropAssets(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
}

describe('道具：点离表面多远、在不在里面', () => {
  it('箱子：里面、外面、到表面的距离', () => {
    const box = propSolid(prop('box', { size: [1, 1, 1] }));
    expect(insideSolid(box, [0, 0.5, 0])).toBe(true);
    expect(insideSolid(box, [0.3, 0.9, -0.4])).toBe(true);
    expect(insideSolid(box, [0, 1.2, 0])).toBe(false);
    expect(insideSolid(box, [0.7, 0.5, 0])).toBe(false);
    expect(solidDistance(box, [0, 1.3, 0])).toBeCloseTo(0.3, 6);
    expect(solidDistance(box, [0, 0.9, 0])).toBeCloseTo(-0.1, 6);
    // 棱外面：到棱的距离
    expect(solidDistance(box, [0.8, 1.4, 0])).toBeCloseTo(Math.hypot(0.3, 0.4), 6);
    const top = closestOnSolid(box, [0.2, 2, 0.1]).point;
    [0.2, 1, 0.1].forEach((v, k) => expect(top[k]).toBeCloseTo(v, 9));
  });

  it('五种基本体：正中在里面，盒子外面的点在外面', () => {
    for (const kind of PROP_KINDS) {
      const p = prop(kind);
      const solid = propSolid(p);
      expect(insideSolid(solid, [0, p.size[1] / 2, 0]), kind).toBe(true);
      expect(insideSolid(solid, [0, p.size[1] + 0.05, 0]), kind).toBe(false);
      expect(insideSolid(solid, [p.size[0], p.size[1] / 2, 0]), kind).toBe(false);
    }
  });

  it('球：表面上各个方向量出来都差不多是半径', () => {
    const ball = propSolid(prop('ball', { size: [1, 1, 1] }));
    for (const dir of [[1, 0, 0], [0, 1, 0], [0.6, 0.8, 0], [0.5, 0.5, Math.SQRT1_2]] as V3[]) {
      const p: V3 = [dir[0] * 0.8, 0.5 + dir[1] * 0.8, dir[2] * 0.8];
      expect(solidDistance(ball, p)).toBeCloseTo(0.3, 2);
      const q: V3 = [dir[0] * 0.3, 0.5 + dir[1] * 0.3, dir[2] * 0.3];
      expect(solidDistance(ball, q)).toBeCloseTo(-0.2, 2);
    }
  });

  it('转过、挪过的道具照摆好以后的位置算；换到角色的坐标里也对', () => {
    // 放倒的杆：沿 -X 躺着，离地 1 米
    const bar = prop('pole', { size: [0.1, 2, 0.1], pos: [0, 1, 0], rot: [0, 0, 90] });
    const solid = propSolid(bar);
    expect(insideSolid(solid, [-1, 1, 0])).toBe(true);
    expect(insideSolid(solid, [0, 2, 0])).toBe(false);
    expect(solidDistance(solid, [-1, 1.25, 0])).toBeCloseTo(0.2, 2);
    // 角色站在 (3, 0, 0)、转了 90°：杆在它的坐标里换了地方
    const mine = propSolid(bar, { x: 3, z: 0, yaw: 90 });
    expect(insideSolid(mine, [-1, 1, 0])).toBe(false);
    // 场景里的 (-1, 1, 0) 在这个角色看来是 (0, 1, -4)
    expect(insideSolid(mine, [0, 1, -4])).toBe(true);
  });

  it('家具是几块壳叠着拼的：腿里面、坐面里面算里面，腿之间的空当、坐面上方算外面', () => {
    const chair = asset('chair');
    const solid = propSolid(chair);
    const [w, h, d] = chair.size;
    // 坐面上方（椅背前面的空当）
    expect(insideSolid(solid, [0, h * 0.75, d * 0.2])).toBe(false);
    // 四条腿之间
    expect(insideSolid(solid, [0, h * 0.15, 0])).toBe(false);
    // 坐面前半截上方一点：最近的是坐面，大约在半高
    const seat = closestOnSolid(solid, [0, h * 0.6, d * 0.3]);
    expect(seat.point[1]).toBeGreaterThan(h * 0.35);
    expect(seat.point[1]).toBeLessThan(h * 0.6);
    // 坐面板子里面
    expect(insideSolid(solid, [0, seat.point[1] - 0.01, d * 0.3])).toBe(true);
    // 一条腿里面：四个角上
    expect(insideSolid(solid, [w / 2 - 0.02, 0.1, d / 2 - 0.02])).toBe(true);
  });

  it('每件家具：盒子外面一圈的点都算外面，离表面的距离是正的', () => {
    for (const entry of PROP_ASSETS) {
      const p = asset(entry.id);
      const solid = propSolid(p);
      const [w, h, d] = p.size;
      for (const q of [[0, h + 0.1, 0], [w / 2 + 0.1, h / 2, 0], [0, h / 2, d / 2 + 0.1], [-w / 2 - 0.1, h / 2, -d / 2 - 0.1]] as V3[]) {
        expect(insideSolid(solid, q), entry.id).toBe(false);
        expect(solidDistance(solid, q), entry.id).toBeGreaterThan(0.05);
      }
    }
  });
});

describe('道具：停在表面', () => {
  const table = propSolid(prop('box', { size: [1.2, 0.75, 0.6] }));

  it('离得远的不动', () => {
    expect(pushOutOfSolids([0, 1.5, 0], [table], 0.03)).toEqual([0, 1.5, 0]);
    expect(pushOutOfSolids([2, 0.3, 0], [table], 0.03)).toEqual([2, 0.3, 0]);
  });

  it('手伸进桌面里：从最近的那一面出来，留一个手掌厚', () => {
    const p = pushOutOfSolids([0.1, 0.7, 0.05], [table], 0.03);
    expect(p[0]).toBeCloseTo(0.1, 6);
    expect(p[1]).toBeCloseTo(0.78, 6);
    expect(p[2]).toBeCloseTo(0.05, 6);
    // 从侧面伸进去的从侧面出来
    const side = pushOutOfSolids([0.55, 0.3, 0], [table], 0.03);
    expect(side[0]).toBeCloseTo(0.63, 6);
    expect(side[1]).toBeCloseTo(0.3, 6);
  });

  it('贴得太近的也退到一个手掌厚', () => {
    const p = pushOutOfSolids([0, 0.76, 0], [table], 0.03);
    expect(p[1]).toBeCloseTo(0.78, 6);
  });

  it('拖胯坐到椅子上：胯停在坐面上方，不沉进坐面里', () => {
    const chair = asset('chair');
    const solid = propSolid(chair);
    const front = chair.size[2] * 0.3;
    const seatY = closestOnSolid(solid, [0, chair.size[1] * 0.6, front]).point[1];
    const hips = pushOutOfSolids([0, seatY - 0.02, front], [solid], 0.1);
    expect(solidDistance(solid, hips)).toBeGreaterThan(0.099);
    expect(hips[1]).toBeGreaterThan(seatY + 0.05);
  });

  it('挨着的两件：从一件里出来不会掉进另一件里', () => {
    const left = propSolid(prop('box', { size: [1, 1, 1], pos: [-0.5, 0, 0] }, 'p1'));
    const right = propSolid(prop('box', { size: [1, 1, 1], pos: [0.5, 0, 0] }, 'p2'));
    const p = pushOutOfSolids([-0.02, 0.9, 0], [left, right], 0.03);
    expect(solidDistance(left, p)).toBeGreaterThan(0.029);
    expect(solidDistance(right, p)).toBeGreaterThan(0.029);
  });
});

describe('道具：拖动时停在表面（记着是从哪一边来的）', () => {
  const table = propSolid(prop('box', { size: [1.2, 0.75, 0.6] }));
  // 一块薄板：5 厘米厚，顶面在 75 厘米
  const board = propSolid(prop('box', { size: [1, 0.05, 1], pos: [0, 0.7, 0] }));

  it('路上没东西：到哪是哪', () => {
    expect(slideOutOfSolids([0, 1.5, 0], [0.3, 1.2, 0.1], [table], 0.03)).toEqual([0.3, 1.2, 0.1]);
    expect(slideOutOfSolids([0, 1.5, 0], [0.3, 1.2, 0.1], [], 0.03)).toEqual([0.3, 1.2, 0.1]);
  });

  it('从上面往下按：停在顶面上，按得再深也不从底下、侧面冒出来', () => {
    for (const y of [0.7, 0.5, 0.2, 0.01]) {
      const p = slideOutOfSolids([0.5, 1.2, 0], [0.5, y, 0], [table], 0.03);
      expect(p[0], `按到 ${y}`).toBeCloseTo(0.5, 3);
      expect(p[1], `按到 ${y}`).toBeCloseTo(0.78, 3);
    }
  });

  it('薄板：从上面来的留在上面，从下面来的留在下面；一步跨过去也不穿', () => {
    const down = slideOutOfSolids([0, 1, 0], [0, 0.71, 0], [board], 0.03);
    expect(down[1]).toBeCloseTo(0.78, 3);
    const jump = slideOutOfSolids([0, 1, 0], [0, 0.3, 0], [board], 0.03);
    expect(jump[1]).toBeCloseTo(0.78, 3);
    const up = slideOutOfSolids([0, 0.3, 0], [0, 0.74, 0], [board], 0.03);
    expect(up[1]).toBeCloseTo(0.67, 3);
  });

  it('斜着按下去：贴着表面滑到目标的正上方', () => {
    const p = slideOutOfSolids([0, 1, 0], [0.3, 0.6, 0.1], [table], 0.03);
    expect(p[0]).toBeCloseTo(0.3, 3);
    expect(p[1]).toBeCloseTo(0.78, 3);
    expect(p[2]).toBeCloseTo(0.1, 3);
  });

  it('绕过边就过去了：目标在桌子外面、路上不挡着', () => {
    expect(slideOutOfSolids([0.9, 0.9, 0], [0.9, 0.3, 0], [table], 0.03)).toEqual([0.9, 0.3, 0]);
  });

  it('连着拖：每一下从上一下停的地方接着走，一直贴在顶面上', () => {
    let at: V3 = [-0.4, 1, 0];
    for (let i = 0; i <= 8; i++) {
      at = slideOutOfSolids(at, [-0.4 + i * 0.1, 0.5, 0], [table], 0.03);
      expect(at[1]).toBeCloseTo(0.78, 3);
      expect(at[0]).toBeCloseTo(-0.4 + i * 0.1, 3);
    }
  });

  it('开始拖的时候已经在里面：退回推到最近的表面', () => {
    expect(slideOutOfSolids([0, 0.7, 0], [0.1, 0.7, 0.05], [table], 0.03)).toEqual(pushOutOfSolids([0.1, 0.7, 0.05], [table], 0.03));
  });

  it('坐到椅子上：胯从上面往下拖，过了坐面的板子也停在坐面上方', () => {
    const chair = asset('chair');
    const solid = propSolid(chair);
    const front = chair.size[2] * 0.2;
    const seatY = closestOnSolid(solid, [0, chair.size[1] * 0.6, front]).point[1];
    for (const y of [seatY - 0.01, seatY - 0.06, 0.2, 0.05]) {
      const hips = slideOutOfSolids([0, 1, front], [0, y, front], [solid], 0.1);
      expect(hips[1], `拖到 ${y}`).toBeGreaterThan(seatY + 0.09);
      expect(hips[1], `拖到 ${y}`).toBeLessThan(seatY + 0.13);
    }
  });
});

describe('道具：身体和道具穿插', () => {
  const box = propSolid(prop('box', { size: [1, 1, 1] }), undefined);

  it('身子插进箱子里：报是哪件、哪一块、多深', () => {
    // 一段竖着的躯干，半径 12 厘米，中线离箱子的侧面 2 厘米（在外面）
    const clashes = propClashes([cap([0.52, 0.2, 0], [0.52, 0.8, 0], 0.12)], [box]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ id: 'p1', part: 'torso' });
    expect(clashes[0].depth).toBeCloseTo(0.1, 3);
    // 中线整个在箱子里面的更深
    const deep = propClashes([cap([0.3, 0.2, 0], [0.3, 0.8, 0], 0.12)], [box]);
    expect(deep[0].depth).toBeCloseTo(0.32, 3);
  });

  it('贴着、压着一点不算；手脚不算', () => {
    // 坐在箱子上：大腿的中线在箱子顶上 5 厘米，半径 7.5 厘米，压进去 2.5 厘米
    expect(propClashes([cap([-0.2, 1.05, 0], [0.2, 1.05, 0], 0.075, 'UpperLeg_L', 'legL')], [box])).toEqual([]);
    expect(propClashes([cap([0, 0.5, 0], [0.1, 0.5, 0], 0.04, 'Hand_L', 'armL')], [box])).toEqual([]);
    expect(propClashes([cap([0, 0.5, 0], [0.1, 0.5, 0.1], 0.045, 'Foot_R', 'legR')], [box])).toEqual([]);
  });

  it('离得远的没有；好几处时深的排前面，同一块只留最深的', () => {
    expect(propClashes([cap([3, 0, 0], [3, 1, 0], 0.12)], [box])).toEqual([]);
    const clashes = propClashes(
      [cap([0.52, 0.2, 0], [0.52, 0.8, 0], 0.12), cap([0.45, 0.2, 0], [0.45, 0.8, 0], 0.12), cap([0.55, 0.5, 0], [0.9, 0.5, 0], 0.045, 'LowerArm_L', 'armL')],
      [box],
    );
    expect(clashes.map((c) => c.part)).toEqual(['torso']);
    expect(clashes[0].depth).toBeCloseTo(0.17, 3);
  });
});
