// 第二种身体：二次元少女素体。数据是 tools/build-anime-body.mjs 生成的 public/anime/body.bin。
import { describe, expect, it } from 'vitest';
import { animeGrid, animeReady } from '../src/anime/body';
import { type Figure, type Prim, worldTransforms } from '../src/geometry/figure';
import { buildFigure } from '../src/geometry/layout';
import { rotate } from '../src/geometry/vec';
import { type BodySpec, defaultSpec, normalizeSpec, serializeSpec } from '../src/model/spec';
import { applyParse, parseDescription } from '../src/parser';
import { buildSkeleton } from '../src/rig/skeleton';
import { bindGrafts, skinVertices } from '../src/rig/skin';
import { castRay, compileField, fieldAt } from '../src/sdf/field';
import { VOXEL, fuseParts } from '../src/sdf/fuse';
import { getGrid, gridDist } from '../src/sdf/grids';
import { useAnimeBody } from './animeBody';

const anime = (text = '', rest: Partial<BodySpec> = {}): BodySpec => ({
  ...applyParse(defaultSpec(), parseDescription(text)),
  bodyStyle: 'anime',
  ...rest,
});
const usesGrid = (figure: Figure) => figure.parts.some((part) => part.prims.some((p: Prim) => p.kind === 'grid'));
const part = (figure: Figure, name: string) => {
  const found = figure.parts.find((p) => p.name === name);
  if (!found) throw new Error(`没有部件 ${name}`);
  return found;
};
/** 预览精度融合一遍：分成几块、最低点和最高点（米） */
function fused(spec: BodySpec) {
  const figure = buildFigure(spec);
  const mesh = fuseParts(figure.parts, { voxel: VOXEL.preview, blend: spec.blend });
  let low = Infinity;
  let high = -Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    low = Math.min(low, mesh.positions[i] * figure.scale);
    high = Math.max(high, mesh.positions[i] * figure.scale);
  }
  return { figure, mesh, low, high };
}

describe('二次元少女素体', () => {
  it('数据还没载入时，先照白模人台摆', () => {
    expect(animeReady()).toBe(false);
    const figure = buildFigure(anime());
    expect(usesGrid(figure)).toBe(false);
    expect(figure.parts.map((p) => p.name)).toEqual(buildFigure(defaultSpec()).parts.map((p) => p.name));
  });

  it('载入以后，头、躯干、手臂、腿都换成素体的形状', () => {
    useAnimeBody();
    expect(animeReady()).toBe(true);
    const figure = buildFigure(anime());
    expect(figure.parts.map((p) => p.name)).toEqual([
      'Torso',
      'Neck_01',
      'Head_01',
      'Arm_01_L',
      'Arm_01_R',
      'Chest_01_L',
      'Chest_01_R',
      'Leg_01_L',
      'Leg_01_R',
    ]);
    for (const p of figure.parts) expect(p.prims.some((q) => q.kind === 'grid'), p.name).toBe(true);
    // 白模人台不受影响
    expect(usesGrid(buildFigure(defaultSpec()))).toBe(false);
  });

  it('身高按设定来，头身比是素体本来的比例', () => {
    for (const height of [1.4, 1.62, 1.9]) {
      const spec = anime();
      const { metrics } = buildFigure({ ...spec, shape: { ...spec.shape, height } });
      // 素体的尺寸存到 0.01 毫米，差的就是这点零头
      expect(metrics.height).toBeCloseTo(height, 4);
      expect(metrics.headRatio).toBeGreaterThan(6.3);
      expect(metrics.headRatio).toBeLessThan(6.8);
    }
  });

  it('头身比滑块：往大拖头变小，往小拖头变大', () => {
    const ratio = (headRatio: number) => {
      const spec = anime();
      return buildFigure({ ...spec, shape: { ...spec.shape, headRatio } }).metrics;
    };
    expect(ratio(9).headHeight).toBeLessThan(ratio(7.5).headHeight);
    expect(ratio(6).headHeight).toBeGreaterThan(ratio(7.5).headHeight);
    expect(ratio(9).headRatio - ratio(7.5).headRatio).toBeCloseTo(1.5, 1);
  });

  it('融合成一整块，脚踩在地面上，头顶就是设定的身高', () => {
    for (const pose of ['A', 'T'] as const) {
      const { mesh, low, high } = fused(anime('', { pose }));
      expect(mesh.info.components, pose).toBe(1);
      expect(Math.abs(low), pose).toBeLessThan(0.012);
      expect(Math.abs(high - 1.62), pose).toBeLessThan(0.012);
    }
  });

  it('T-pose 时各块都在素体原来的位置，和躯干直接取并集', () => {
    const tPose = buildFigure(anime('', { pose: 'T' }));
    for (const name of ['Neck_01', 'Head_01', 'Arm_01_L', 'Arm_01_R', 'Leg_01_L', 'Leg_01_R']) {
      expect(part(tPose, name).fuseAs, name).toBe('torso');
    }
    // 手臂放下来以后是转过的，要用圆角融合
    const aPose = buildFigure(anime());
    expect(part(aPose, 'Arm_01_L').fuseAs).toBeUndefined();
    expect(part(aPose, 'Leg_01_L').fuseAs).toBe('torso');
    // 头放大、缩小以后，和脖子也不再是原样接上的
    const big = anime();
    expect(part(buildFigure({ ...big, shape: { ...big.shape, headRatio: 6 } }), 'Head_01').fuseAs).toBeUndefined();
  });

  it('左右对称', () => {
    const figure = buildFigure(anime('两对手，两对胸，一对翅膀'));
    const xf = worldTransforms(figure);
    for (const p of figure.parts) {
      if (p.side !== 1) continue;
      const left = xf.get(p.name)!.pos;
      const right = xf.get(p.name.replace(/_L$/, '_R'))!.pos;
      expect(right[0], p.name).toBeCloseTo(-left[0], 9);
      expect(right[1], p.name).toBeCloseTo(left[1], 9);
      expect(right[2], p.name).toBeCloseTo(left[2], 9);
    }
  });

  it('多头、多对手、多对胸照样拼得起来，仍然是一整块', () => {
    const { figure, mesh } = fused(anime('两个头，两对手，两对胸'));
    expect(figure.parts.filter((p) => p.type === 'head')).toHaveLength(2);
    expect(figure.parts.filter((p) => p.type === 'arm')).toHaveLength(4);
    expect(figure.parts.filter((p) => p.type === 'chest')).toHaveLength(4);
    expect(mesh.info.components).toBe(1);
    // 沿躯干多排一排手臂：躯干加长了，人也更高
    expect(figure.metrics.height).toBeGreaterThan(1.7);
  });

  it('尾巴、翅膀、角、兽耳、人马下身沿用白模的做法，也都连在身上', () => {
    for (const text of ['三条尾巴 一对翅膀 猫耳 两只角', '半人马', '三对手 肩部扇形']) {
      const spec = anime(text);
      const { mesh } = fused(text.includes('扇形') ? { ...spec, armLayout: 'fan' } : spec);
      expect(mesh.info.components, text).toBe(1);
    }
  });

  it('骨架：和白模人台同一套骨骼名，多出来的头和手臂带序号', () => {
    const names = (text: string) => buildSkeleton(buildFigure(anime(text))).bones.map((b) => b.name);
    expect(names('')).toEqual(buildSkeleton(buildFigure(defaultSpec())).bones.map((b) => b.name));
    const multi = names('两个头，两对手');
    for (const name of ['Head.002', 'Neck.002', 'UpperArm_L.002', 'Hand_R.002', 'Chest.002']) expect(multi).toContain(name);
  });

  it('蒙皮：每个顶点的权重加起来是 1，最远的那个指尖上的顶点跟着那根手指的最后一节', () => {
    const { figure, mesh } = fused(anime());
    const unit = { parts: figure.parts, scale: 1 };
    const skeleton = buildSkeleton(unit);
    // 手是缝上去的现成网格，带着模型自己的权重（bindGrafts）
    const skin = bindGrafts(skinVertices(unit, skeleton, mesh.positions), mesh, skeleton);
    // 手臂放下来、手肘弯着的时候，伸得最远的是哪根手指不一定：只要是左手某根手指的最后一节
    const tips = new Set(skeleton.bones.flatMap((b, i) => (/^(Index|Middle|Ring|Little)3_L$/.test(b.name) ? [i] : [])));
    let farthest = 0;
    for (let v = 1; v < mesh.positions.length / 3; v++) if (mesh.positions[v * 3] > mesh.positions[farthest * 3]) farthest = v;
    let sum = 0;
    let onTip = 0;
    for (let k = 0; k < 4; k++) {
      sum += skin.weights[farthest * 4 + k];
      if (tips.has(skin.joints[farthest * 4 + k])) onTip += skin.weights[farthest * 4 + k];
    }
    expect(sum).toBeCloseTo(1, 5);
    expect(onTip).toBeGreaterThan(0.9);
  });

  it('两对手臂摆姿势：腿和腿、手臂和腿互不相干；把一条腿往后摆 70°，表面不裂', () => {
    // 素体的两条腿挨得很近，手垂下来就在胯旁边。光按直线距离分权重的话，小腿内侧会带上另一条腿百分之几的权重，
    // 一摆腿就被拽出一道道裂缝（改之前这里有两百多条边被拉长到两倍半以上，最长的多出 6 cm）
    const { figure, mesh } = fused(anime('两对手'));
    const unit = { parts: figure.parts, scale: 1 };
    const skeleton = buildSkeleton(unit);
    const skin = bindGrafts(skinVertices(unit, skeleton, mesh.positions, mesh.triangles), mesh, skeleton);
    const count = mesh.positions.length / 3;
    // 每根骨骼是哪条胳膊、哪条腿上的（躯干和头上的是空的）
    const limb = skeleton.bones.map((b) => {
      const side = /_([LR](\.\d+)?)$/.exec(b.name)?.[1];
      return side ? `${/^(UpperLeg|LowerLeg|Foot|Toes)_/.test(b.name) ? 'leg' : 'arm'}${side}` : '';
    });
    const left = new Set(skeleton.bones.flatMap((b, i) => (/^(UpperLeg|LowerLeg|Foot|Toes)_L$/.test(b.name) ? [i] : [])));
    const hip = skeleton.bones.find((b) => b.name === 'UpperLeg_L')!.head;
    const turn = (-70 * Math.PI) / 180;
    const moved = new Float32Array(mesh.positions.length);
    for (let v = 0; v < count; v++) {
      const seen = new Set<string>();
      let share = 0;
      for (let k = 0; k < 4; k++) {
        const w = skin.weights[v * 4 + k];
        if (w > 1e-4 && limb[skin.joints[v * 4 + k]]) seen.add(limb[skin.joints[v * 4 + k]]);
        if (left.has(skin.joints[v * 4 + k])) share += w;
      }
      if (seen.size > 1) throw new Error(`顶点 ${v} 同时跟着 ${[...seen].join('、')}`);
      const y = mesh.positions[v * 3 + 1] - hip[1];
      const z = mesh.positions[v * 3 + 2] - hip[2];
      moved[v * 3] = mesh.positions[v * 3];
      moved[v * 3 + 1] = mesh.positions[v * 3 + 1] + share * (Math.cos(turn) * y - Math.sin(turn) * z - y);
      moved[v * 3 + 2] = mesh.positions[v * 3 + 2] + share * (Math.sin(turn) * y + Math.cos(turn) * z - z);
    }
    const length = (at: ArrayLike<number>, a: number, b: number) => Math.hypot(at[a * 3] - at[b * 3], at[a * 3 + 1] - at[b * 3 + 1], at[a * 3 + 2] - at[b * 3 + 2]);
    let torn = 0;
    let worst = 0;
    for (let t = 0; t < mesh.triangles.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = mesh.triangles[t + e];
        const b = mesh.triangles[t + ((e + 1) % 3)];
        if (a > b) continue;
        const before = length(mesh.positions, a, b);
        const after = length(moved, a, b);
        worst = Math.max(worst, after - before);
        if (after > before * 2.5 && after - before > 0.004) torn++;
      }
    }
    // 胯前面被拉开的那一圈总会长一些；裂缝是另一回事
    expect(torn).toBeLessThan(100);
    expect(worst).toBeLessThan(0.045);
  });

  it('胸部大小：往小调躯干逐渐变平，往大调才是把胸那一块放大', () => {
    const withBust = (bust: number) => {
      const spec = anime();
      return { ...spec, shape: { ...spec.shape, bust } };
    };
    const torsoShape = (bust: number) => part(buildFigure(withBust(bust)), 'Torso').prims[0];
    expect(torsoShape(1)).not.toHaveProperty('morph');
    expect(torsoShape(1.4)).not.toHaveProperty('morph');
    expect(torsoShape(0.65)).toMatchObject({ morph: [animeGrid('torsoFlat'), 0.5] });
    expect(torsoShape(0.3)).toMatchObject({ morph: [animeGrid('torsoFlat'), 1] });
    // 胸尖那一带最靠前的地方，随滑块一路往前
    const front = (bust: number) => {
      const { figure, mesh } = fused(withBust(bust));
      let z = -Infinity;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = Math.abs(mesh.positions[i] * figure.scale);
        const y = mesh.positions[i + 1] * figure.scale;
        if (x > 0.03 && x < 0.09 && y > 1.17 && y < 1.23) z = Math.max(z, mesh.positions[i + 2] * figure.scale);
      }
      return z;
    };
    const depths = [0.3, 0.65, 1, 1.3, 1.6].map(front);
    for (let i = 1; i < depths.length; i++) expect(depths[i], `第 ${i} 档`).toBeGreaterThan(depths[i - 1] + 0.004);
    // 调到最小是平胸：比原样至少收回去 3 厘米
    expect(depths[2] - depths[0]).toBeGreaterThan(0.03);
  });

  it('加了兽耳、精灵耳，头上自带的人耳就去掉', () => {
    const headShape = (text: string) => part(buildFigure(anime(text)), 'Head_01').prims[0];
    expect(headShape('')).toMatchObject({ grid: animeGrid('head') });
    expect(headShape('猫耳')).toMatchObject({ grid: animeGrid('headBare') });
    expect(headShape('精灵耳')).toMatchObject({ grid: animeGrid('headBare') });
    // 去掉耳朵以后头窄了一圈，别的地方没动
    const full = getGrid(animeGrid('head')).bounds;
    const bare = getGrid(animeGrid('headBare')).bounds;
    expect(bare.max[0]).toBeLessThan(full.max[0] - 0.01);
    expect(bare.max[1]).toBeCloseTo(full.max[1], 2);
    expect(bare.min[1]).toBeCloseTo(full.min[1], 2);
    expect(bare.max[2]).toBeCloseTo(full.max[2], 2);
    expect(fused(anime('猫耳')).mesh.info.components).toBe(1);
  });

  it('手臂下垂时手肘往前微弯，平举时还是直的', () => {
    const arm = (pose: 'A' | 'T') => part(buildFigure(anime('', { pose })), 'Arm_01_L');
    expect(arm('T').prims[0]).not.toHaveProperty('bend');
    expect(arm('A').prims[0]).toHaveProperty('bend');
    const bones = (pose: 'A' | 'T') => Object.fromEntries(arm(pose).bones!.map((b) => [b.name, b]));
    // 手臂自己的坐标里，+X 沿着手臂，+Z 是前面：弯了以后手腕比手肘靠前
    const straight = bones('T');
    const bent = bones('A');
    expect(bent.UpperArm_L.tail).toEqual(straight.UpperArm_L.tail);
    const forward = (b: { head: number[]; tail: number[] }) => b.tail[2] - b.head[2];
    expect(forward(bent.LowerArm_L) - forward(straight.LowerArm_L)).toBeGreaterThan(0.04);
    // 前臂的长度不变
    const length = (b: { head: number[]; tail: number[] }) => Math.hypot(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]);
    expect(length(bent.LowerArm_L)).toBeCloseTo(length(straight.LowerArm_L), 9);
    // 右手是左手的镜像，也是往前弯
    const right = Object.fromEntries(part(buildFigure(anime()), 'Arm_01_R').bones!.map((b) => [b.name, b]));
    expect(right.LowerArm_R.tail[0]).toBeCloseTo(-bent.LowerArm_L.tail[0], 12);
    expect(right.LowerArm_R.tail[2]).toBeCloseTo(bent.LowerArm_L.tail[2], 12);
  });

  it('多个头：凑成一簇，脖子根并排挤在肩膀中间；三个头以内肩膀不加宽', () => {
    const torsoMasses = (heads: number) => {
      const spec = anime();
      const figure = buildFigure({ ...spec, counts: { ...spec.counts, heads } });
      return { names: part(figure, 'Torso').prims.map((p) => p.name), figure, spec: { ...spec, counts: { ...spec.counts, heads } } };
    };
    // 双数个头时正中间没有脖子，垫一小块盖住素体自己那截脖子根；别的什么都不垫（Cleft 是屁股缝）
    expect(torsoMasses(1).names).toEqual(['Torso', 'Cleft']);
    expect(torsoMasses(2).names).toEqual(['Torso', 'Saddle', 'Cleft']);
    expect(torsoMasses(3).names).toEqual(['Torso', 'Cleft']);
    expect(torsoMasses(4).names).toEqual(['Torso', 'Saddle', 'Cleft']);
    expect(torsoMasses(5).names).toEqual(['Torso', 'Cleft']);
    // 三个头以内躯干是素体原样；四五个头时脖子根排不下，肩膀才稍微加宽一点（不到三成）
    const native = part(torsoMasses(1).figure, 'Arm_01_L').pos[0];
    for (const heads of [1, 2, 3]) {
      expect(part(torsoMasses(heads).figure, 'Torso').prims[0], `${heads} 个头`).not.toHaveProperty('widenX');
      expect(part(torsoMasses(heads).figure, 'Arm_01_L').pos[0]).toBe(native);
    }
    const widths = [4, 5].map((heads) => (part(torsoMasses(heads).figure, 'Torso').prims[0] as { widenX?: number[][] }).widenX![0][0]);
    expect(widths[0]).toBeGreaterThan(0.005);
    expect(widths[1]).toBeGreaterThanOrEqual(widths[0]);
    expect(widths[1]).toBeLessThan(native * 0.31);
    for (const heads of [2, 3, 4, 5]) {
      const { figure, spec } = torsoMasses(heads);
      const made = figure.parts.filter((p) => p.type === 'head');
      expect(made, `${heads} 个头`).toHaveLength(heads);
      // 每个脖子根都在两肩之间
      const shoulder = part(figure, 'Arm_01_L').pos[0];
      for (const neck of figure.parts.filter((p) => p.type === 'neck')) {
        expect(Math.abs(neck.pos[0]), `${heads} 个头 ${neck.name}`).toBeLessThan(shoulder - 0.025);
      }
      // 相邻两个头脸贴着脸：正中隔得比头窄一点（素体的头宽 18 cm）
      const width = 0.18 * made[0].scale!;
      for (let k = 1; k < heads; k++) {
        const apart = Math.hypot(...made[k].pos.map((v, i) => v - made[k - 1].pos[i]));
        expect(apart, `${heads} 个头，第 ${k} 和 ${k + 1} 个`).toBeLessThan(width * 0.95);
        expect(apart, `${heads} 个头，第 ${k} 和 ${k + 1} 个`).toBeGreaterThan(width * 0.7);
      }
      // 头往外歪得不多（最外面的不超过 30°）
      for (const head of made) expect(Math.abs(rotate(head.quat, [0, 1, 0])[0]), head.name).toBeLessThan(Math.sin(30 * (Math.PI / 180)));
      expect(fuseParts(figure.parts, { voxel: VOXEL.preview, blend: spec.blend }).info.components, `${heads} 个头`).toBe(1);
    }
  });

  it('多个头：正中间没挪位置的脖子用素体原装的，斜着伸出去的用圆台', () => {
    const necks = (heads: number) => {
      const spec = anime();
      return buildFigure({ ...spec, counts: { ...spec.counts, heads } }).parts.filter((p) => p.type === 'neck');
    };
    const shapes = (p: { prims: { name: string; kind: string }[] }) => p.prims.map((q) => `${q.name}:${q.kind}`);
    expect(necks(1).map(shapes)).toEqual([['Neck:grid']]);
    // 三个头：中间那根是原装的（和躯干按原样接上），两边是圆台加一团垫在根上的
    const three = necks(3);
    expect(shapes(three[1])).toEqual(['Neck:grid']);
    expect(three[1]).toHaveProperty('fuseAs', 'torso');
    expect(three[1].pos).toEqual(necks(1)[0].pos);
    for (const side of [three[0], three[2]]) {
      expect(shapes(side)).toEqual(['Neck:cone', 'NeckRoot:ellipsoid']);
      expect(side).not.toHaveProperty('fuseAs');
    }
    // 两个、四个头：没有哪根脖子在原位
    for (const heads of [2, 4]) for (const neck of necks(heads)) expect(shapes(neck)[0], `${heads} 个头`).toBe('Neck:cone');
    // 五个头：肩膀加宽过，躯干上脖子根那一片被拉开了，中间那根也用圆台
    expect(shapes(necks(5)[2])[0]).toBe('Neck:cone');
  });

  it('多个头：紧挨着别的头的那一侧不留人耳', () => {
    const heads = (n: number) => {
      const spec = anime();
      return buildFigure({ ...spec, counts: { ...spec.counts, heads: n } }).parts.filter((p) => p.type === 'head');
    };
    const shapes = (p: { prims: { name: string }[] }) => p.prims.map((q) => q.name);
    expect(shapes(heads(1)[0])).toEqual(['Head']);
    const three = heads(3);
    // 中间的头两边都挨着别的头：用去掉耳朵的那一份；两边的头各留最外面的一只
    expect(shapes(three[1])).toEqual(['Head']);
    expect(shapes(three[0])).toEqual(['Head', 'Ear']);
    expect(shapes(three[2])).toEqual(['Head', 'Ear']);
    expect(three[0].prims[1]).toHaveProperty('mirror', true);
    expect(three[2].prims[1]).not.toHaveProperty('mirror');
    expect(three[1].prims[0]).not.toEqual(heads(1)[0].prims[0]);
  });

  it('一个头几张脸：一根原装的脖子，身体和一个头时一样；每张脸用的都是去掉耳朵的头', () => {
    const base = anime();
    const spec: BodySpec = { ...base, headLayout: 'faces', counts: { ...base.counts, heads: 3 } };
    const figure = buildFigure(spec);
    const one = buildFigure(base);
    const heads = figure.parts.filter((p) => p.type === 'head');
    expect(heads.map((p) => p.name)).toEqual(['Head_01', 'Head_02', 'Head_03']);
    // 只有一根脖子，没挪位置：还是素体原装的那块，和躯干直接取并集
    const necks = figure.parts.filter((p) => p.type === 'neck');
    expect(necks).toHaveLength(1);
    expect(necks[0]).toEqual(part(one, 'Neck_01'));
    for (const head of heads) {
      expect(head.prims).toHaveLength(1);
      expect(head.prims[0]).toMatchObject({ kind: 'grid', grid: animeGrid('headBare') });
    }
    // 多出来的脸是正面那个头的子部件，一张朝左一张朝右，没有自己的骨骼
    const world = worldTransforms(figure);
    for (const [name, side] of [['Head_02', 1], ['Head_03', -1]] as const) {
      expect(part(figure, name).parent).toBe('Head_01');
      expect(part(figure, name).bones).toBeUndefined();
      expect(rotate(world.get(name)!.quat, [0, 0, 1])[0] * side).toBeGreaterThan(0.99);
      expect((world.get(name)!.pos[0] - world.get('Head_01')!.pos[0]) * side).toBeGreaterThan(0.02);
    }
    // 肩膀不加宽，头不缩小，身高不变
    expect(part(figure, 'Arm_01_L').pos).toEqual(part(one, 'Arm_01_L').pos);
    expect(part(figure, 'Head_01').scale).toBe(part(one, 'Head_01').scale);
    expect(figure.metrics.height).toBeCloseTo(one.metrics.height, 9);
    // 融合出来还是一整块，头宽了
    const made = fused(spec);
    expect(made.mesh.info.components).toBe(1);
    expect(buildSkeleton(figure).bones.map((b) => b.name)).toEqual(buildSkeleton(one).bones.map((b) => b.name));
  });

  it('屁股缝：素体自己那道浅的挖深一些；左右并排垫的胯上每条腿一瓣、胯下往上各一道缝', () => {
    const cuts = (prims: Prim[]) => prims.filter((p) => 'cut' in p && p.cut);
    const f = buildFigure(anime());
    const torso = part(f, 'Torso');
    const [cut] = cuts(torso.prims);
    if (cut?.kind !== 'ellipsoid') throw new Error('躯干上应该有一道挖掉的缝');
    expect(cut.center[0]).toBe(0);
    // 挖之前和挖之后：正中的后表面比旁边那一瓣靠前多少
    const groove = (prims: Prim[]) => {
      const field = compileField({ scale: 1, parts: [{ ...torso, prims, pos: [0, 0, 0] }] }, { blend: 0 });
      const back = (x: number) => -1 + castRay(field, [x, cut.center[1], -1], [0, 0, 1], 1);
      return back(0) - back(0.055);
    };
    expect(groove(torso.prims)).toBeGreaterThan(groove(torso.prims.filter((p) => p !== cut)) + 0.004);
    expect(groove(torso.prims)).toBeGreaterThan(0.012);
    // 左右并排：躯干原样不开缝，垫的胯上开
    const row = buildFigure(anime('', { legLayout: 'row', counts: { ...anime().counts, legs: 4 } }));
    expect(cuts(part(row, 'Torso').prims)).toHaveLength(0);
    expect(part(row, 'LowerBody').prims.filter((p) => p.name.startsWith('Glute'))).toHaveLength(4);
    expect(cuts(part(row, 'LowerBody').prims)).toHaveLength(3);
  });

  it('人腿人马：前面一对腿还是素体原装的，后面接一截腰、一副胯和一对一样的腿，融合成一整块', () => {
    const base = anime();
    const spec: BodySpec = { ...base, legLayout: 'humantaur', counts: { ...base.counts, legs: 4 } };
    const { figure, mesh, low, high } = fused(spec);
    const one = buildFigure(base);
    expect(figure.metrics.legForm).toBe('humantaur');
    // 前腿：就是双足时的那一对，和躯干直接取并集；上半身没动，身高不变
    expect(part(figure, 'Leg_01_L')).toEqual(part(one, 'Leg_01_L'));
    expect(part(figure, 'Leg_01_L').fuseAs).toBe('torso');
    // 躯干也一样，只是本来的屁股接着后面的腰，不开缝（缝开在最后那副胯上）
    const torso = part(one, 'Torso');
    expect(part(figure, 'Torso')).toEqual({ ...torso, prims: torso.prims.filter((p) => p.name !== 'Cleft') });
    expect(figure.metrics.height).toBeCloseTo(one.metrics.height, 9);
    // 后腿：同一块形状，往后挪了四十多厘米，靠圆角融进后面那副胯里
    const rear = part(figure, 'Leg_02_L');
    expect(rear.prims).toEqual(part(one, 'Leg_01_L').prims);
    expect(rear.fuseAs).toBeUndefined();
    expect(part(figure, 'Leg_01_L').pos[2] - rear.pos[2]).toBeGreaterThan(0.4);
    // 后面的腰和胯照素体自己的粗细：比白模人台的细
    const body = part(figure, 'LowerBody');
    const waist = body.prims.find((p) => p.name === 'Waist_02');
    if (waist?.kind !== 'ellipsoid') throw new Error('没有腰');
    expect(waist.radii[0]).toBeGreaterThan(0.06);
    expect(waist.radii[0]).toBeLessThan(0.12);
    // 一整块，脚踩在地上，头顶是设定的身高
    expect(mesh.info.components).toBe(1);
    expect(low).toBeGreaterThan(-0.01);
    expect(low).toBeLessThan(0.01);
    expect(high).toBeCloseTo(spec.shape.height, 1);
    // 骨架：后腿接在 LowerBody_01 上
    const bones = buildSkeleton(figure).bones;
    const parentOf = (name: string) => bones[bones.find((b) => b.name === name)!.parent].name;
    expect(parentOf('UpperLeg_L.002')).toBe('LowerBody_01');
    expect(parentOf('LowerBody_01')).toBe('Hips');
  });

  it('单足：中间那条用左腿转直，胯底下留着原来两条腿的根；粗一圈；一整块', () => {
    const one = buildFigure(anime());
    const { figure, mesh, low, high } = fused(anime('一条腿'));
    expect(figure.metrics.legForm).toBe('biped');
    expect(figure.parts.filter((p) => p.type === 'leg').map((p) => p.name)).toEqual(['Leg_01']);
    const leg = part(figure, 'Leg_01');
    expect(leg.pos[0]).toBe(0);
    expect(leg.fuseAs).toBeUndefined();
    // 转过以后脚踝在髋关节正下方
    const ankle = rotate(leg.quat, [0.04625 - 0.07687, 0.10294 - 0.86978, -0.02523 - 0.00227]);
    expect(Math.abs(ankle[0])).toBeLessThan(0.002);
    expect(leg.stretch?.[0]).toBeGreaterThan(1.1);
    // 两个腿根：原来的腿只留最上面一截，和躯干取并集，没有骨骼
    for (const name of ['Hip_L', 'Hip_R']) {
      const hip = part(figure, name);
      expect(hip.fuseAs).toBe('torso');
      expect(hip.bones).toBeUndefined();
      expect(hip.pos[0]).toBeCloseTo(part(one, name.replace('Hip', 'Leg_01')).pos[0], 9);
    }
    expect(mesh.info.components).toBe(1);
    expect(low).toBeGreaterThan(-0.01);
    expect(low).toBeLessThan(0.01);
    expect(high).toBeCloseTo(figure.metrics.height, 1);
    // 骨架：中线上的腿不分左右
    const bones = buildSkeleton(figure).bones.map((b) => b.name);
    expect(bones.filter((n) => n.startsWith('UpperLeg'))).toEqual(['UpperLeg']);
  });

  it('单数条并排、前后串联，人腿人马每副胯几条，都是一整块', () => {
    for (const [text, rest, legs] of [
      ['三条腿 腿左右并排', {}, 3],
      ['三条腿 腿前后串联', {}, 3],
      ['人腿人马 前三后三', {}, 6],
      ['人腿人马 前三后二', {}, 5],
      ['人腿人马，八条腿', { hipLegs: 4 }, 8],
      ['人腿人马，两条腿', { hipLegs: 1 }, 2],
    ] as const) {
      const { figure, mesh, low } = fused(anime(text, rest));
      expect(figure.parts.filter((p) => p.type === 'leg'), text).toHaveLength(legs);
      expect(mesh.info.components, text).toBe(1);
      expect(low, text).toBeGreaterThan(-0.01);
      expect(low, text).toBeLessThan(0.01);
    }
    // 人腿人马前面那副胯上三条：腿不在素体原来的位置上，不和躯干取并集；胯底下垫一副胯把腿根包住
    const three = buildFigure(anime('人腿人马 前三后三'));
    expect(three.parts.filter((p) => p.type === 'leg' && p.fuseAs === 'torso')).toEqual([]);
    expect(part(three, 'LowerBody').prims.map((p) => p.name)).toContain('Pelvis_01');
    // 正好一对的时候还是原装的那一对
    expect(part(buildFigure(anime('人腿人马')), 'Leg_01_L').fuseAs).toBe('torso');
  });

  it('中线上的腿摆姿势：权重不串到旁边的腿上；往后摆 70°，表面不裂', () => {
    // 三条并排时中间那条两边都挨着腿，往后摆时胯底下拉开的皮比四条并排时摆里面那条（86 条、4.0 cm）多一些
    for (const [text, limit] of [['一条腿', [100, 0.045]], ['三条腿 腿左右并排', [130, 0.05]]] as const) {
      const { figure, mesh } = fused(anime(text));
      const unit = { parts: figure.parts, scale: 1 };
      const skeleton = buildSkeleton(unit);
      const skin = bindGrafts(skinVertices(unit, skeleton, mesh.positions, mesh.triangles), mesh, skeleton);
      const count = mesh.positions.length / 3;
      // 每根骨骼是哪条腿上的：中间那条是「中」
      const leg = skeleton.bones.map((b) => {
        const m = /^(?:UpperLeg|LowerLeg|Foot|Toes)(_[LR])?(\.\d+)?$/.exec(b.name);
        return m ? `${m[1] ?? '中'}${m[2] ?? ''}` : '';
      });
      const middle = new Set(skeleton.bones.flatMap((b, i) => (/^(UpperLeg|LowerLeg|Foot|Toes)$/.test(b.name) ? [i] : [])));
      const hip = skeleton.bones.find((b) => b.name === 'UpperLeg')!.head;
      const turn = (-70 * Math.PI) / 180;
      const moved = new Float32Array(mesh.positions.length);
      for (let v = 0; v < count; v++) {
        const seen = new Set<string>();
        let share = 0;
        for (let k = 0; k < 4; k++) {
          const w = skin.weights[v * 4 + k];
          if (w > 1e-4 && leg[skin.joints[v * 4 + k]]) seen.add(leg[skin.joints[v * 4 + k]]);
          if (middle.has(skin.joints[v * 4 + k])) share += w;
        }
        if (seen.size > 1) throw new Error(`${text}：顶点 ${v} 同时跟着 ${[...seen].join('、')}`);
        const y = mesh.positions[v * 3 + 1] - hip[1];
        const z = mesh.positions[v * 3 + 2] - hip[2];
        moved[v * 3] = mesh.positions[v * 3];
        moved[v * 3 + 1] = mesh.positions[v * 3 + 1] + share * (Math.cos(turn) * y - Math.sin(turn) * z - y);
        moved[v * 3 + 2] = mesh.positions[v * 3 + 2] + share * (Math.sin(turn) * y + Math.cos(turn) * z - z);
      }
      const length = (at: ArrayLike<number>, a: number, b: number) => Math.hypot(at[a * 3] - at[b * 3], at[a * 3 + 1] - at[b * 3 + 1], at[a * 3 + 2] - at[b * 3 + 2]);
      let torn = 0;
      let worst = 0;
      for (let t = 0; t < mesh.triangles.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = mesh.triangles[t + e];
          const b = mesh.triangles[t + ((e + 1) % 3)];
          if (a > b) continue;
          const before = length(mesh.positions, a, b);
          const after = length(moved, a, b);
          worst = Math.max(worst, after - before);
          if (after > before * 2.5 && after - before > 0.004) torn++;
        }
      }
      expect(torn, text).toBeLessThan(limit[0]);
      expect(worst, text).toBeLessThan(limit[1]);
    }
  });

  it('肩部聚拢的手臂：垂得最直的一对在本来的肩膀上，其余的从它后面长出来', () => {
    for (const pose of ['A', 'T'] as const) {
      const figure = buildFigure(anime('三对手', { armLayout: 'fan', pose }));
      const single = part(buildFigure(anime('', { pose })), 'Arm_01_L').pos;
      const [back, middle, front] = ['Arm_01_L', 'Arm_02_L', 'Arm_03_L'].map((n) => part(figure, n).pos);
      expect(front).toEqual(single);
      // 一对比一对靠后、稍低
      expect(middle[2]).toBeLessThan(front[2] - 0.005);
      expect(back[2]).toBeLessThan(middle[2] - 0.005);
      expect(back[1]).toBeLessThan(front[1]);
      // 挤成一小簇，都还挨着肩膀
      expect(Math.hypot(back[0] - front[0], back[1] - front[1], back[2] - front[2])).toBeLessThan(0.05);
    }
    expect(fused(anime('三对手', { armLayout: 'fan' })).mesh.info.components).toBe(1);
  });

  it('肩部聚拢：素体的身子薄，最靠后的肩关节也留在身体里面，不悬在背后', () => {
    for (const pairs of ['两对手', '三对手', '四对手']) {
      for (const pose of ['A', 'T'] as const) {
        const figure = buildFigure(anime(pairs, { armLayout: 'fan', pose }));
        const torso = part(figure, 'Torso');
        // 只有躯干这一个部件、放在原点时的距离场：手臂是躯干的子部件，肩关节的位置就写在躯干自己的坐标里
        const torsoField = compileField({ scale: 1, parts: [{ ...torso, pos: [0, 0, 0] }] }, { blend: 0 });
        for (const arm of figure.parts.filter((p) => p.type === 'arm')) {
          expect(arm.parent).toBe(torso.name);
          // 从肩关节再往后一厘米多，还在躯干里面
          expect(fieldAt(torsoField, arm.pos[0], arm.pos[1], arm.pos[2] - 0.012), `${pairs} ${pose} ${arm.name}`).toBeLessThan(0);
        }
      }
    }
  });

  it('肩部聚拢：多出来的手臂切掉毛边的根部、垫一个包住切口的圆肩头，几条手臂只在根部互相融合', () => {
    const figure = buildFigure(anime('三对手', { armLayout: 'fan', pose: 'T' }));
    const shapes = (name: string) => {
      const prims = part(figure, name).prims;
      const arm = prims.find((p) => p.kind === 'grid');
      const cap = prims.find((p) => p.kind === 'ellipsoid');
      if (arm?.kind !== 'grid' || cap?.kind !== 'ellipsoid') throw new Error(`${name} 少了手臂或肩头`);
      return { arm, cap };
    };
    for (const name of ['Arm_01_L', 'Arm_02_R', 'Arm_03_L']) {
      const { arm, cap } = shapes(name);
      // 根部融合：有圆角，而且只在离肩关节不远的地方管用
      expect(arm.soft, name).toBeGreaterThan(0.01);
      expect(arm.fade?.[1], name).toBeLessThan(0.2);
      expect(cap.soft, name).toBeGreaterThan(0.01);
    }
    // 本来那个肩膀上的一对：整条手臂原样留着
    expect(shapes('Arm_03_L').arm.clipX).toBeUndefined();
    // 多出来的：从毛边以外切开，切口倒圆；肩头的球把切口整个包住
    for (const name of ['Arm_01_L', 'Arm_02_L']) {
      const { arm, cap } = shapes(name);
      expect(arm.clipX, name).toBeGreaterThan(0.02);
      expect(arm.clipRound, name).toBeGreaterThan(0);
      const cut = gridDist(getGrid(arm.grid), { clipX: arm.clipX });
      let outside = 0;
      for (let y = -0.08; y <= 0.06; y += 0.004) {
        for (let z = -0.07; z <= 0.07; z += 0.004) {
          // 切口那一片上、在手臂里面的点，都得在球里面
          if (cut.fn(arm.clipX!, y, z) > 0) continue;
          if (Math.hypot(arm.clipX! - cap.center[0], y - cap.center[1], z - cap.center[2]) > cap.radii[0]) outside++;
        }
      }
      expect(outside, name).toBe(0);
    }
    // 右边的是左边翻过来的
    expect(shapes('Arm_01_R').cap.center[0]).toBeCloseTo(-shapes('Arm_01_L').cap.center[0], 12);
    // 沿躯干上下排的不走这一套
    const stacked = part(buildFigure(anime('三对手', { pose: 'T' })), 'Arm_02_L').prims.find((p) => p.kind === 'grid');
    expect(stacked?.kind === 'grid' && stacked.soft).toBeFalsy();
  });

  it('肩部聚拢：两到四对手臂，两种姿势，预览和导出精度下都是一整块封闭网格', () => {
    for (const pairs of ['两对手', '三对手', '四对手']) {
      for (const pose of ['A', 'T'] as const) {
        const figure = buildFigure(anime(pairs, { armLayout: 'fan', pose }));
        for (const voxel of [VOXEL.preview, VOXEL.fine]) {
          const mesh = fuseParts(figure.parts, { voxel, blend: 0.02 });
          expect(mesh.info.components, `${pairs} ${pose} ${voxel}`).toBe(1);
        }
      }
    }
  }, 120_000);

  it('沿躯干上下排的手臂：下面每一排的肩关节贴着躯干侧面，肩头露在外面', () => {
    const figure = buildFigure(anime('三对手'));
    const top = part(figure, 'Arm_01_L').pos;
    for (const name of ['Arm_02_L', 'Arm_03_L']) {
      const pos = part(figure, name).pos;
      expect(pos[1], name).toBeLessThan(top[1] - 0.15);
      expect(pos[0], name).toBeGreaterThan(0.06);
      expect(pos[0], name).toBeLessThan(top[0] + 0.02);
    }
    expect(part(figure, 'Arm_02_R').pos[0]).toBeCloseTo(-part(figure, 'Arm_02_L').pos[0], 9);
  });

  it('体型滑块：肩宽、腰宽、胯宽、四肢粗细、体格都起作用；都在默认值时和原样一模一样', () => {
    const shaped = (shape: Partial<BodySpec['shape']>) => {
      const spec = anime();
      return buildFigure({ ...spec, shape: { ...spec.shape, ...shape } });
    };
    const base = shaped({});
    for (const p of base.parts) {
      for (const prim of p.prims) {
        expect(prim, p.name).not.toHaveProperty('widenX');
        // 脖子是一直加粗着的（素体的脖子太细），和体型滑块无关
        if (p.type !== 'neck') expect(prim, p.name).not.toHaveProperty('thicken');
        expect(prim, p.name).not.toHaveProperty('spreadX');
      }
    }
    /** 只有这一个部件时，高度 y 处往左（+X）最远到哪 */
    const side = (figure: Figure, name: string, y: number, z = 0) => {
      const f = compileField({ scale: 1, parts: [{ ...part(figure, name), parent: undefined, pos: [0, 0, 0] }] }, { blend: 0 });
      let x = 0.4;
      while (x > 0 && fieldAt(f, x, y, z) > 0) x -= 0.0005;
      return x;
    };
    // 肩宽：手臂的肩关节跟着往外、往里挪
    const shoulder = part(base, 'Arm_01_L').pos[0];
    expect(part(shaped({ shoulders: 1.3 }), 'Arm_01_L').pos[0]).toBeCloseTo(shoulder * 1.3, 3);
    expect(part(shaped({ shoulders: 0.85 }), 'Arm_01_L').pos[0]).toBeCloseTo(shoulder * 0.85, 3);
    // 腰宽：腰最细的地方变宽、变窄，胸口和胯不变
    const waist = side(base, 'Torso', 1.07);
    expect(side(shaped({ waist: 1.3 }), 'Torso', 1.07)).toBeGreaterThan(waist * 1.2);
    expect(side(shaped({ waist: 0.8 }), 'Torso', 1.07)).toBeLessThan(waist * 0.86);
    expect(side(shaped({ waist: 1.3 }), 'Torso', 1.26)).toBeCloseTo(side(base, 'Torso', 1.26), 2);
    expect(side(shaped({ waist: 1.3 }), 'Torso', 0.88)).toBeCloseTo(side(base, 'Torso', 0.88), 2);
    // 胯宽：胯最宽的地方按比例变；腿根跟着一起拉，腿和骨骼不挪
    const hip = side(base, 'Torso', 0.88);
    expect(side(shaped({ hips: 1.4 }), 'Torso', 0.88)).toBeCloseTo(hip * 1.4, 1);
    expect(side(shaped({ hips: 0.8 }), 'Torso', 0.88)).toBeCloseTo(hip * 0.8, 1);
    expect(side(shaped({ hips: 1.4 }), 'Torso', 1.2)).toBeCloseTo(side(base, 'Torso', 1.2), 3);
    const wide = shaped({ hips: 1.4 });
    expect(part(wide, 'Leg_01_L').pos).toEqual(part(base, 'Leg_01_L').pos);
    expect(part(wide, 'Leg_01_L').prims[0]).toHaveProperty('spreadX');
    // 四肢粗细：手臂、腿绕着骨头变粗变细，手腕、脚踝还是原样（手、脚接得上）
    for (const [name, at] of [['Arm_01_L', 'thicken'], ['Leg_01_L', 'thicken']] as const) {
      expect((part(shaped({ limbs: 1.3 }), name).prims[0] as { thicken?: { k: number } })[at]!.k, name).toBeCloseTo(1.3, 12);
    }
    // 体格：这几样一起乘上去
    const big = shaped({ build: 1.2 });
    expect(part(big, 'Arm_01_L').pos[0]).toBeCloseTo(shoulder * 1.2, 3);
    expect((part(big, 'Leg_01_L').prims[0] as { thicken?: { k: number } }).thicken!.k).toBeCloseTo(1.2, 12);
    expect(side(big, 'Torso', 1.07)).toBeGreaterThan(waist * 1.1);
    // 拖到两头融合出来都还是一整块
    for (const shape of [{ shoulders: 1.3, waist: 0.8, hips: 1.4, limbs: 1.3 }, { shoulders: 0.85, waist: 1.3, hips: 0.8, limbs: 0.8 }, { build: 1.3 }]) {
      const spec = anime();
      expect(fused({ ...spec, shape: { ...spec.shape, ...shape } }).mesh.info.components, JSON.stringify(shape)).toBe(1);
    }
  }, 60_000);

  it('摆位结果是纯数据，存档里记得住身体样式', () => {
    const figure = buildFigure(anime('两个头，两对手，两对胸'));
    expect(JSON.parse(JSON.stringify(figure))).toEqual(figure);
    expect(normalizeSpec(JSON.parse(serializeSpec(anime()))).bodyStyle).toBe('anime');
    expect(normalizeSpec({ bodyStyle: '乱写的' }).bodyStyle).toBe('mannequin');
  });
});

describe('采样好的形状（格子）', () => {
  it('镜像：右边那一份就是左边的翻过来', () => {
    useAnimeBody();
    const arm = getGrid(animeGrid('arm'));
    const left = gridDist(arm);
    const right = gridDist(arm, { mirror: true });
    for (const p of [[0.2, 0, 0], [0.31, 0.02, -0.01], [-0.05, 0.03, 0.02], [0.9, 0.4, 0.1]] as const) {
      expect(right.fn(-p[0], p[1], p[2])).toBeCloseTo(left.fn(p[0], p[1], p[2]), 12);
    }
    expect(right.min[0]).toBeCloseTo(-left.max[0], 12);
    expect(right.max[0]).toBeCloseTo(-left.min[0], 12);
  });

  it('手臂里面是负的、外面是正的，出了格子的范围越远越大', () => {
    const arm = gridDist(getGrid(animeGrid('arm')));
    expect(arm.fn(0.2, 0, 0)).toBeLessThan(0);
    expect(arm.fn(0.2, 0.1, 0)).toBeGreaterThan(0);
    expect(arm.fn(3, 0, 0)).toBeGreaterThan(arm.fn(2, 0, 0));
    expect(arm.fn(2, 0, 0)).toBeGreaterThan(1);
  });

  it('加长：上面的部分整体上移，加长的那一段连续、不折返', () => {
    const torso = getGrid(animeGrid('torso'));
    const plain = gridDist(torso);
    const long = gridDist(torso, { stretchY: [1.04, 1.12, 0.17] });
    // 腰以下不动，胸以上整体上移
    expect(long.fn(0.05, 0.95, 0.02)).toBeCloseTo(plain.fn(0.05, 0.95, 0.02), 12);
    expect(long.fn(0.05, 1.2 + 0.17, 0.02)).toBeCloseTo(plain.fn(0.05, 1.2, 0.02), 12);
    expect(long.max[1]).toBeCloseTo(plain.max[1] + 0.17, 12);
    // 加长的那一段：躯干的中轴一直在里面，侧面的宽度变化平缓
    let last = long.fn(0.3, 1.0, 0);
    for (let y = 1.0; y <= 1.33; y += 0.005) {
      expect(long.fn(0, y, 0.01), `y=${y.toFixed(3)}`).toBeLessThan(0);
      const side = long.fn(0.3, y, 0);
      expect(Math.abs(side - last), `y=${y.toFixed(3)}`).toBeLessThan(0.004);
      last = side;
    }
  });

  it('切口倒圆：棱附近往里收一点，离棱远的地方和一刀切平一样', () => {
    const arm = getGrid(animeGrid('arm'));
    const whole = gridDist(arm);
    const flat = gridDist(arm, { clipX: 0.035 });
    const round = gridDist(arm, { clipX: 0.035, clipRound: 0.012 });
    // 棱上的一点：切面上，从手臂里面往上走，走到手臂的表面
    let y = -0.01;
    while (whole.fn(0.035, y, 0.003) < 0) y += 0.0005;
    expect(Math.abs(flat.fn(0.035, y, 0.003))).toBeLessThan(0.001);
    // 倒圆以后这一点在外面：收进去 round / 4
    expect(round.fn(0.035, y, 0.003)).toBeGreaterThan(0.002);
    expect(round.fn(0.035, y, 0.003)).toBeLessThan(0.004);
    // 切面的正中（离棱远）、手臂中段的表面附近、切掉的那一边：都和一刀切平一样
    for (const p of [[0.035, -0.01, 0.003], [0.036, -0.01, 0.003], [0.2, 0.02, 0], [0.2, 0.04, 0.01], [0, -0.01, 0], [-0.03, 0.05, 0]] as const) {
      expect(round.fn(p[0], p[1], p[2]), p.join()).toBe(flat.fn(p[0], p[1], p[2]));
    }
    // 右边那一份翻过来以后一样
    const mirrored = gridDist(arm, { clipX: 0.035, clipRound: 0.012, mirror: true });
    expect(mirrored.fn(-0.035, y, 0.003)).toBeCloseTo(round.fn(0.035, y, 0.003), 12);
  });

  it('混合：两块一模一样大小的格子之间按比例取值', () => {
    const torso = getGrid(animeGrid('torso'));
    const plain = gridDist(torso);
    const flat = gridDist(getGrid(animeGrid('torsoFlat')));
    const at: [number, number, number] = [0.06, 1.18, 0.11];
    // 这一点在原样的胸里面、在平胸的外面
    expect(plain.fn(...at)).toBeLessThan(0);
    expect(flat.fn(...at)).toBeGreaterThan(0);
    expect(gridDist(torso, { morph: [animeGrid('torsoFlat'), 0] }).fn(...at)).toBe(plain.fn(...at));
    expect(gridDist(torso, { morph: [animeGrid('torsoFlat'), 1] }).fn(...at)).toBeCloseTo(flat.fn(...at), 12);
    expect(gridDist(torso, { morph: [animeGrid('torsoFlat'), 0.5] }).fn(...at)).toBeCloseTo((plain.fn(...at) + flat.fn(...at)) / 2, 12);
    // 胸以外的地方两块是一样的
    expect(flat.fn(0.05, 0.95, 0.02)).toBeCloseTo(plain.fn(0.05, 0.95, 0.02), 4);
    expect(() => gridDist(torso, { morph: [animeGrid('arm'), 0.5] })).toThrow();
  });

  it('弯一下：轴以外的部分整个转过去，轴以内的不动', () => {
    const arm = getGrid(animeGrid('arm'));
    const straight = gridDist(arm);
    const angle = 0.5;
    const bent = gridDist(arm, { bend: [0.22, 0, angle, 0.03] });
    // 上臂不动
    expect(bent.fn(0.1, 0.01, 0.005)).toBe(straight.fn(0.1, 0.01, 0.005));
    // 前臂上的一点：绕轴往前转 angle 以后，值和没弯时一样
    for (const [x, y, z] of [[0.35, 0, 0], [0.42, 0.01, -0.01], [0.3, -0.02, 0.03]]) {
      const dx = x - 0.22;
      const tx = 0.22 + dx * Math.cos(angle) - z * Math.sin(angle);
      const tz = dx * Math.sin(angle) + z * Math.cos(angle);
      expect(bent.fn(tx, y, tz)).toBeCloseTo(straight.fn(x, y, z), 12);
    }
    // 前臂往前（+Z）去了，占的范围也跟着变大
    expect(bent.max[2]).toBeGreaterThan(straight.max[2] + 0.05);
    // 镜像以后照样往前弯
    const mirrored = gridDist(arm, { bend: [0.22, 0, angle, 0.03], mirror: true });
    expect(mirrored.fn(-0.3, 0.01, 0.06)).toBeCloseTo(bent.fn(0.3, 0.01, 0.06), 12);
  });

  it('加宽、收窄：几段叠在一起，各段挪的加起来；收窄的地方距离跟着缩，不会比实际离表面远', () => {
    const torso = getGrid(animeGrid('torso'));
    const plain = gridDist(torso);
    // 一段从 0.95 渐渐宽出 2 厘米、到 1.07 宽足，另一段从 1.07 起渐渐收回去：合起来只在腰上鼓一下
    const bump = gridDist(torso, { widenX: [[0.02, 0.95, 1.07, 0.1], [-0.02, 1.07, 1.2, 0.1]] });
    const thin = gridDist(torso, { widenX: [[-0.015, 0.95, 1.07, 0.1], [0.015, 1.07, 1.2, 0.1]] });
    const sideOf = (fn: (x: number, y: number, z: number) => number, y: number) => {
      let x = 0.3;
      while (x > 0 && fn(x, y, 0) > 0) x -= 0.0002;
      return x;
    };
    const waist = sideOf(plain.fn, 1.07);
    expect(sideOf(bump.fn, 1.07)).toBeGreaterThan(waist + 0.015);
    expect(sideOf(thin.fn, 1.07)).toBeLessThan(waist - 0.011);
    for (const y of [0.9, 1.25]) {
      expect(bump.fn(0.08, y, 0.01)).toBe(plain.fn(0.08, y, 0.01));
      expect(thin.fn(0.08, y, 0.01)).toBe(plain.fn(0.08, y, 0.01));
    }
    // 收窄的那一段：相邻两点的值之差不超过它们的距离（不然往这里打射线会冲过表面）
    for (let x = 0; x < 0.12; x += 0.004) {
      for (let y = 1.0; y < 1.14; y += 0.01) {
        const a = thin.fn(x, y, 0.01);
        const b = thin.fn(x + 0.003, y, 0.01);
        expect(Math.abs(a - b), `${x.toFixed(3)},${y.toFixed(2)}`).toBeLessThanOrEqual(0.003 * 1.05);
      }
    }
    // 占的范围按加宽的那几段加起来放大，收窄的不缩
    expect(bump.max[0]).toBeCloseTo(plain.max[0] + 0.02, 12);
    expect(gridDist(torso, { widenX: [[-0.015, 0.95, 1.07, 0.1]] }).max[0]).toBeCloseTo(plain.max[0], 12);
  });

  it('斜过去：每个高度整片平移，往下走到 depth 那么深挪满；上面、脚底下不变形', () => {
    const leg = getGrid(animeGrid('leg'));
    const plain = gridDist(leg);
    const out = 0.1;
    const depth = 0.8;
    const lean = gridDist(leg, { lean: [out, depth] });
    // 斜着挪的那一段：距离偏小一点（错切伸长的倍数），零点的位置对得上
    const s = out / depth;
    const lip = Math.sqrt((2 + s * s + s * Math.sqrt(4 + s * s)) / 2);
    expect(lean.fn(0.03 + out / 2, -0.4, 0.01) * lip).toBeCloseTo(plain.fn(0.03, -0.4, 0.01), 12);
    // 脚踝往下整个平移，距离不变；髋关节往上不动
    expect(lean.fn(0.03 + out, -0.85, 0.05)).toBe(plain.fn(0.03, -0.85, 0.05));
    expect(lean.fn(0.03, 0.02, 0.01)).toBe(plain.fn(0.03, 0.02, 0.01));
    // 占的范围往那边多留出去
    expect(lean.max[0]).toBeCloseTo(plain.max[0] + out, 12);
    expect(lean.min[0]).toBeCloseTo(plain.min[0], 12);
  });

  it('胯部聚拢：腿往外斜着散开，融合出来还是一整块', () => {
    const spec = anime('六条腿，腿胯部聚拢');
    const figure = buildFigure(spec);
    expect(figure.metrics.legForm).toBe('gather');
    const lean = (name: string) => (part(figure, name).prims[0] as { lean?: [number, number] }).lean?.[0] ?? 0;
    expect(lean('Leg_01_L')).toBe(0);
    expect(lean('Leg_02_L')).toBeGreaterThan(0.1);
    expect(lean('Leg_03_L')).toBeGreaterThan(2 * lean('Leg_02_L'));
    expect(fused(spec).mesh.info.components).toBe(1);
  }, 30_000);

  it('变粗变细：轴的中段离轴的距离乘 k，根上、手腕两头还是原样', () => {
    const arm = getGrid(animeGrid('arm'));
    const plain = gridDist(arm);
    const thicken = (k: number) => gridDist(arm, { thicken: { from: [0, 0, 0], to: [0.43, -0.011, 0.02], k, ramp: [0.05, 0.12, 0.05] } });
    /** 轴上 x 处往 +Y 走到表面有多远 */
    const radius = (fn: (x: number, y: number, z: number) => number, x: number) => {
      const t = x / 0.43;
      const [cy, cz] = [-0.011 * t, 0.02 * t];
      let r = 0;
      while (fn(x, cy + r, cz) < 0 && r < 0.2) r += 0.0002;
      return r;
    };
    const mid = radius(plain.fn, 0.25);
    expect(radius(thicken(1.3).fn, 0.25)).toBeCloseTo(mid * 1.3, 2);
    expect(radius(thicken(0.8).fn, 0.25)).toBeCloseTo(mid * 0.8, 2);
    // 根上没到 ramp[0] 的、过了轴的另一头的（手腕往外）
    for (const x of [0.02, 0.45]) {
      expect(thicken(1.3).fn(x, 0.03, 0.01), `x=${x}`).toBe(plain.fn(x, 0.03, 0.01));
      expect(thicken(0.8).fn(x, 0.03, 0.01), `x=${x}`).toBe(plain.fn(x, 0.03, 0.01));
    }
    // 变粗了，占的范围也跟着变大
    expect(thicken(1.3).max[1]).toBeGreaterThan(plain.max[1]);
  });

  it('按比例拉宽：离中线的距离乘 k，上下渐渐变回原样；躯干和腿根照同一份拉，叠着的地方还对得上', () => {
    const torso = getGrid(animeGrid('torso'));
    const leg = getGrid(animeGrid('leg'));
    const levels: [number, number, number, number] = [1.06, 0.92, 0.82, 0.58];
    const k = 1.3;
    const plain = gridDist(torso);
    const wide = gridDist(torso, { spreadX: { mid: 0, rise: 0, k, levels } });
    // 拉足的那一段：(x, y) 处的值就是原来 (x / k, y) 处的（离表面近的地方距离不变）
    expect(wide.fn(0.13, 0.87, 0.02)).toBeCloseTo(plain.fn(0.1, 0.87, 0.02), 12);
    // 上面不变
    expect(wide.fn(0.1, 1.2, 0.02)).toBe(plain.fn(0.1, 1.2, 0.02));
    // 腿：髋关节在 (hx, hy) 的那条腿，在它自己的坐标里身体中线在 x = -hx、高度差 hy
    const [hx, hy] = [0.077, 0.87];
    const legPlain = gridDist(leg);
    const legWide = gridDist(leg, { spreadX: { mid: -hx, rise: hy, k, levels } });
    // 世界坐标里的同一点 (0.12, 0.85)：拉过以后的值是原来 (0.12 / k, 0.85) 处的
    expect(legWide.fn(0.12 - hx, 0.85 - hy, 0.02)).toBeCloseTo(legPlain.fn(0.12 / k - hx, 0.85 - hy, 0.02), 12);
    // 膝盖往下不变
    expect(legWide.fn(0.02, -0.4, 0.01)).toBe(legPlain.fn(0.02, -0.4, 0.01));
  });

  it('切掉一截：切面以内算在外面', () => {
    const arm = getGrid(animeGrid('arm'));
    const whole = gridDist(arm);
    const cut = gridDist(arm, { clipX: 0.1 });
    expect(whole.fn(0.05, 0, 0)).toBeLessThan(0);
    expect(cut.fn(0.05, 0, 0)).toBeCloseTo(0.05, 12);
    expect(cut.fn(0.2, 0, 0)).toBeCloseTo(whole.fn(0.2, 0, 0), 12);
    // 镜像以后切的是另一边
    expect(gridDist(arm, { clipX: 0.1, mirror: true }).fn(-0.05, 0, 0)).toBeCloseTo(0.05, 12);
  });
});
