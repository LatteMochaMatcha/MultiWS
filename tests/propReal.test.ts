import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { propBounds, shapeOf, touchShapeOf } from '../src/geometry/propMesh';
import { readGlb } from '../src/io/glbRead';
import { mergeGlbs } from '../src/io/mergeGlb';
import { propGlbParts, propWorldShapes } from '../src/io/propFiles';
import { type SceneProp, clampProp, makeAssetProp, normalizeProps, updateProp } from '../src/model/props';
import { PROP_ASSETS, PROP_ASSET_GROUPS, REAL_ASSETS, REAL_STORE, propAsset, realAsset } from '../src/props/catalog';
import { installRealAsset, propAssetShape, propTouchShape, realAssetFile } from '../src/props/library';
import { type RealAssetFile, encodeRealAsset, parseRealAsset } from '../src/props/realFile';
import { closestOnSolid, propSolid } from '../src/scene/propTouch';
import { propAssetLabel } from '../src/view/propNames';
import { buildFigure } from '../src/geometry/layout';
import { defaultSpec } from '../src/model/spec';
import { emptyPosing } from '../src/pose/posing';
import { forward, posedBones } from '../src/pose/rig';
import { makeSolver, stateOf } from '../src/pose/solver';
import { propContacts } from '../src/props/contacts';
import { buildSkeleton } from '../src/rig/skeleton';
import { topUnder } from '../src/scene/follow';
import { capsulesOf, heightOf, placeCapsules } from '../src/scene/interact';
import { PROP_ACTIONS, actionBlock, solvePropAction } from '../src/scene/propActions';
import { propClashes } from '../src/scene/propTouch';

/** 一块 1 × 1 米的板，两批面、两张（假的）贴图，带一份粗网格 */
function sample(): RealAssetFile {
  return {
    id: 'sample',
    size: [1, 0, 1],
    positions: new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    groups: [
      { start: 0, count: 3, material: 0 },
      { start: 3, count: 3, material: 1 },
    ],
    materials: [
      { name: 'wood', map: 0, normal: 1, color: [1, 1, 1], roughness: 1, metalness: 0 },
      { name: 'metal', map: 0, color: [0.5, 0.5, 0.5], roughness: 0.4, metalness: 1, doubleSided: true },
    ],
    textures: [
      { mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3, 4, 5]) },
      { mime: 'image/png', bytes: new Uint8Array([9, 8, 7]) },
    ],
    touch: { positions: new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5]), indices: new Uint32Array([0, 2, 1]) },
  };
}

const bufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe('写实款道具：文件', () => {
  it('写了再读一模一样（法线压成一个字节，差不到百分之一）', () => {
    const from = sample();
    const back = parseRealAsset(bufferOf(encodeRealAsset(from)));
    expect(back.id).toBe('sample');
    expect(back.size).toEqual(from.size);
    expect(back.positions).toEqual(from.positions);
    expect(back.uvs).toEqual(from.uvs);
    expect(back.indices).toEqual(from.indices);
    expect(back.groups).toEqual(from.groups);
    expect(back.materials).toEqual(from.materials);
    expect(back.textures).toEqual(from.textures);
    expect(back.touch).toEqual(from.touch);
    back.normals.forEach((v, i) => expect(v).toBeCloseTo(from.normals[i], 2));
  });

  it('没有粗网格、没有贴图的也行', () => {
    const { touch: _touch, ...plain } = sample();
    const back = parseRealAsset(bufferOf(encodeRealAsset({ ...plain, textures: [], materials: plain.materials.map(({ map: _m, normal: _n, ...rest }) => rest) })));
    expect(back.touch).toBeUndefined();
    expect(back.textures).toEqual([]);
  });

  it('下了一半的、不是这种文件的、里面对不上的都不认', () => {
    const bytes = encodeRealAsset(sample());
    expect(() => parseRealAsset(bufferOf(bytes.slice(0, bytes.length - 4)))).toThrow();
    expect(() => parseRealAsset(bufferOf(bytes.slice(0, 6)))).toThrow();
    const wrong = bytes.slice();
    wrong[0] = 0x58;
    expect(() => parseRealAsset(bufferOf(wrong))).toThrow();
    // 多出来一截也不认
    const longer = new Uint8Array(bytes.length + 4);
    longer.set(bytes);
    expect(() => parseRealAsset(bufferOf(longer))).toThrow();
    // 面指到了没有的点、材质要一张没有的贴图
    expect(() => parseRealAsset(bufferOf(encodeRealAsset({ ...sample(), indices: new Uint32Array([0, 2, 9, 0, 3, 2]) })))).toThrow();
    expect(() => parseRealAsset(bufferOf(encodeRealAsset({ ...sample(), textures: [] })))).toThrow();
  });
});

describe('写实款道具：清单', () => {
  it('编号不重复、不和低模的撞，都分了组、起了名字，文件大小和 SHA-256 都写着', () => {
    expect(new Set(REAL_ASSETS.map((a) => a.id)).size).toBe(REAL_ASSETS.length);
    expect(REAL_STORE).toMatch(/^https:\/\/.+\/props\/$/);
    for (const asset of REAL_ASSETS) {
      expect(PROP_ASSETS.some((a) => a.id === asset.id), asset.id).toBe(false);
      expect(PROP_ASSET_GROUPS).toContain(asset.group);
      expect(propAssetLabel(asset.id), asset.id).not.toBe('');
      asset.size.forEach((v) => expect(v).toBeGreaterThan(0.01));
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.bytes).toBeGreaterThan(1000);
      expect(propAsset(asset.id)).toBe(asset);
      expect(realAsset(asset.id)).toBe(asset);
    }
    expect(realAsset('chair')).toBeUndefined();
  });

  it('「刷成灰色」只有写实款记着', () => {
    const chair = clampProp({ ...makeAssetProp([], 'chair', { x: 0, z: 0, yaw: 0 })!, gray: true });
    expect('gray' in chair).toBe(false);
    for (const asset of REAL_ASSETS.slice(0, 1)) {
      const prop = makeAssetProp([], asset.id, { x: 0, z: 0, yaw: 0 })!;
      expect('gray' in prop).toBe(false);
      const gray = updateProp([prop], prop.id, { gray: true });
      expect(gray[0].gray).toBe(true);
      expect(normalizeProps(JSON.parse(JSON.stringify(gray)))).toEqual(gray);
      expect('gray' in updateProp(gray, prop.id, { gray: undefined })[0]).toBe(false);
    }
  });
});

/** 转好的文件只在转过素材的电脑上有（不进仓库）：有才测 */
const storePath = (sha256: string) => `.props-store/${sha256}`;
const built = REAL_ASSETS.filter((a) => existsSync(storePath(a.sha256)));

describe.skipIf(!built.length)('写实款道具：转好的文件', () => {
  const propOf = (id: string, patch: Partial<SceneProp> = {}): SceneProp => clampProp({ ...makeAssetProp([], id, { x: 0, z: 0, yaw: 0 })!, ...patch });

  it('文件还没读进来时用一个同样大的方块顶着', () => {
    const asset = built[0];
    expect(realAssetFile(asset.id)).toBeUndefined();
    expect(shapeOf(propOf(asset.id)).indices.length / 3).toBe(12);
    expect(touchShapeOf(propOf(asset.id)).indices.length / 3).toBe(12);
  });

  it('大小、SHA-256 和清单里写的一样；读进来以后盒子就是清单里的大小，原点在底面正中', () => {
    for (const asset of built) {
      const file = readFileSync(storePath(asset.sha256));
      expect(file.byteLength, asset.id).toBe(asset.bytes);
      expect(createHash('sha256').update(file).digest('hex'), asset.id).toBe(asset.sha256);
      installRealAsset(asset.id, bufferOf(file));
      const shape = propAssetShape(asset.id)!;
      expect(shape.positions.length / 3, asset.id).toBe(asset.vertices);
      expect(shape.indices.length / 3, asset.id).toBe(asset.triangles);
      expect(shape.uvs!.length / 2, asset.id).toBe(asset.vertices);
      expect(shape.groups!.reduce((n, g) => n + g.count, 0), asset.id).toBe(shape.indices.length);
      const { min, max } = propBounds(propOf(asset.id));
      [0, 1, 2].forEach((k) => expect(max[k] - min[k], `${asset.id} 第 ${k} 个方向`).toBeCloseTo(asset.size[k], 2));
      expect(min[1], asset.id).toBeCloseTo(0, 3);
      expect(min[0] + max[0], asset.id).toBeCloseTo(0, 3);
      expect(min[2] + max[2], asset.id).toBeCloseTo(0, 3);
      // 每个材质都有底色贴图
      const real = realAssetFile(asset.id)!;
      for (const m of real.materials) expect(m.map, `${asset.id} ${m.name}`).toBeDefined();
    }
  });

  it('别的编号的文件、清单外的编号不认', () => {
    const [a, b] = built;
    if (b) expect(() => installRealAsset(a.id, bufferOf(readFileSync(storePath(b.sha256))))).toThrow();
    expect(() => installRealAsset('chair', bufferOf(readFileSync(storePath(a.sha256))))).toThrow();
  });

  it('碰撞用的粗网格：面不多，照着画的那份上的点离它不到 3 厘米', () => {
    for (const asset of built) {
      const touch = propTouchShape(asset.id)!;
      expect(touch.indices.length / 3, asset.id).toBeLessThanOrEqual(1600);
      const solid = propSolid(propOf(asset.id));
      const shape = propAssetShape(asset.id)!;
      const step = Math.max(1, Math.floor(shape.positions.length / 3 / 400));
      let worst = 0;
      for (let i = 0; i < shape.positions.length / 3; i += step) {
        const p: [number, number, number] = [shape.positions[i * 3], shape.positions[i * 3 + 1], shape.positions[i * 3 + 2]];
        worst = Math.max(worst, closestOnSolid(solid, p).dist);
      }
      expect(worst, asset.id).toBeLessThan(0.03);
    }
  });

  it('改了尺寸，照着画的和碰撞用的一起拉伸', () => {
    const asset = built[0];
    const wide = propOf(asset.id, { size: [asset.size[0] * 2, asset.size[1], asset.size[2]] });
    const { min, max } = propBounds(wide);
    expect(max[0] - min[0]).toBeCloseTo(asset.size[0] * 2, 3);
    const solid = propSolid(wide);
    expect(solid.max[0] - solid.min[0]).toBeCloseTo(asset.size[0] * 2, 1);
  });

  it('标的接触面下面都有东西，高度像样（坐的、躺的不到一米，撑手的台面在半米到一米之间）', () => {
    for (const asset of built) {
      const prop = propOf(asset.id);
      const solid = propSolid(prop);
      const contacts = propContacts(prop);
      expect(Object.keys(contacts).length, asset.id).toBeGreaterThan(0);
      const spots = [
        ...(contacts.sit ? [contacts.sit, ...(contacts.sit.also ?? [])].map((s) => ['sit', s.rect] as const) : []),
        ...(contacts.lie ? [['lie', contacts.lie.rect] as const] : []),
        ...(contacts.top ? [['top', contacts.top.rect] as const] : []),
      ];
      for (const [key, rect] of spots) {
        const y = topUnder([solid], ((rect.x[0] + rect.x[1]) / 2) * prop.size[0], ((rect.z[0] + rect.z[1]) / 2) * prop.size[2], 10);
        expect(y, `${asset.id} ${key}`).not.toBeNull();
        expect(y!, `${asset.id} ${key}`).toBeLessThan(key === 'top' ? 1 : 0.95);
        expect(y!, `${asset.id} ${key}`).toBeGreaterThan(key === 'top' ? 0.4 : 0.25);
      }
    }
  });

  it('一键动作：每件上能做的都做得成，摆好以后身体没有明显插进道具里', () => {
    const bones = buildSkeleton(buildFigure(defaultSpec())).bones;
    const solver = makeSolver(bones);
    const height = heightOf(bones);
    for (const asset of built) {
      const prop = propOf(asset.id);
      let done = 0;
      for (const { key } of PROP_ACTIONS) {
        if (actionBlock(key, solver, prop)) continue;
        // 角色站在道具的右前方；另一边也试一次（野餐桌的两条凳各坐一次）
        for (const x of [0.4, -0.6]) {
          const got = solvePropAction(key, { solver, place: { x, z: 1.5, yaw: 180 }, posing: emptyPosing(), prop, props: [prop] });
          if ('error' in got) {
            // 矮的东西靠不住是正常的；别的都该做得成
            expect(key, `${asset.id} ${key}：${got.error}`).toBe('lean');
            continue;
          }
          done++;
          const f = forward(solver.rig, stateOf(solver, got.posing));
          const caps = placeCapsules(capsulesOf(posedBones(solver.rig, f), height), got.place);
          expect(propClashes(caps, [propSolid(prop)]).map((c) => `${c.part} ${Math.round(c.depth * 100)}`), `${asset.id} ${key} 从 ${x}`).toEqual([]);
        }
      }
      expect(done, asset.id).toBeGreaterThan(0);
    }
    // 野餐桌：站在哪一边就坐哪一边的凳，脸朝桌子
    const table = propOf('picnicTable');
    if (built.some((a) => a.id === 'picnicTable')) {
      const sitFrom = (x: number) => solvePropAction('sit', { solver, place: { x, z: 0.3, yaw: 0 }, posing: emptyPosing(), prop: table, props: [table] });
      const right = sitFrom(2);
      const left = sitFrom(-2);
      if ('error' in right || 'error' in left) throw new Error('野餐桌坐不上去');
      expect(right.place.x).toBeGreaterThan(0.6);
      expect(right.place.yaw).toBe(-90);
      expect(left.place.x).toBeLessThan(-0.6);
      expect(left.place.yaw).toBe(90);
    }
  });

  it('导出：带着底色贴图和贴图坐标，一个物体每批面一个材质；刷成灰色的不带贴图', () => {
    const asset = built[0];
    const real = realAssetFile(asset.id)!;
    const prop = propOf(asset.id, { pos: [1, 0, 2] });
    const { json } = readGlb(mergeGlbs(propGlbParts([prop], () => '写实_1')));
    expect(json.nodes[json.scenes[0].nodes[0]].translation).toEqual([1, 0, 2]);
    expect(json.meshes).toHaveLength(1);
    expect(json.meshes[0].primitives).toHaveLength(real.groups.length);
    for (const prim of json.meshes[0].primitives) expect(prim.attributes.TEXCOORD_0).toBeDefined();
    expect(json.images.length).toBe(new Set(real.materials.map((m) => m.map)).size);
    expect(json.materials.every((m: { pbrMetallicRoughness: { baseColorTexture?: unknown } }) => m.pbrMetallicRoughness.baseColorTexture)).toBe(true);
    const total = json.meshes[0].primitives.reduce((n: number, prim: { indices: number }) => n + json.accessors[prim.indices].count, 0);
    expect(total).toBe(asset.triangles * 3);

    const gray = readGlb(mergeGlbs(propGlbParts([propOf(asset.id, { gray: true })], () => '写实_1'))).json;
    expect(gray.images).toBeUndefined();
    expect(gray.meshes[0].primitives).toHaveLength(1);
    // OBJ、STL：只有网格
    expect(propWorldShapes([prop], () => 'x')[0].triangles.length / 3).toBe(asset.triangles);
  });
});
