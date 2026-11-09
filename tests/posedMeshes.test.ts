// 摆姿势时屏幕上的网格跟着骨骼动（src/view/posedMeshes.ts）：只重算矩阵变了的骨骼带着的顶点，结果要和全部重算的逐值一样
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SkinBlend } from '../src/character/pose';
import { PosedMeshes, type SkinSource } from '../src/view/posedMeshes';

const BONES = 6;
const COUNT = 400;

/** 一串可重复的伪随机数 */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 一张随便的网格：每个顶点挂在相邻的两三根骨骼上（有的只挂一根，有的一根都不挂） */
function source(blend: SkinBlend, seed = 1): SkinSource {
  const r = random(seed);
  const position = new Float32Array(COUNT * 3).map(() => r() * 2 - 1);
  const normal = new Float32Array(COUNT * 3);
  const joints = new Uint16Array(COUNT * 4);
  const weights = new Float32Array(COUNT * 4);
  for (let v = 0; v < COUNT; v++) {
    const n = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    normal.set([n.x, n.y, n.z], v * 3);
    if (v % 37 === 0) continue;
    const first = Math.floor(r() * BONES);
    const used = 1 + (v % 3);
    let left = 1;
    for (let k = 0; k < used; k++) {
      joints[v * 4 + k] = (first + k) % BONES;
      const w = k === used - 1 ? left : left * r();
      weights[v * 4 + k] = w;
      left -= w;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  return { geometry, joints, weights, unit: 1, blend };
}

/** 每根骨骼一个转动加平移（蒙皮矩阵，每根 12 个数）；bones 里的那几根用 seed 另算 */
function pose(seed: number, bones?: number[], base?: Float64Array): Float64Array {
  const r = random(seed);
  const out = base ? base.slice() : new Float64Array(BONES * 12);
  for (let j = 0; j < BONES; j++) {
    if (base && !bones?.includes(j)) continue;
    const q = new THREE.Quaternion(r() - 0.5, r() - 0.5, r() - 0.5, r() + 0.5).normalize();
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
    // three 的矩阵按列存；蒙皮矩阵前 9 个数按行
    out.set([m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10], r() - 0.5, r() - 0.5, r() - 0.5], j * 12);
  }
  return out;
}

const positions = (s: SkinSource) => s.geometry.getAttribute('position').array as Float32Array;
const normals = (s: SkinSource) => s.geometry.getAttribute('normal').array as Float32Array;

describe('摆姿势时只重算动了的顶点', () => {
  for (const blend of ['dual', 'linear'] as const) {
    it(`${blend === 'dual' ? '对偶四元数' : '线性混合'}：一根一根骨骼地改，每次都和全部重算的逐值一样`, () => {
      const live = source(blend);
      const posed = new PosedMeshes([live]);
      let now = pose(1);
      posed.apply(now);
      // 最后一步大半骨骼都动了：走全部重算那条路
      for (const [step, bones] of [[2, [3]], [3, [0, 4]], [4, []], [5, [1, 2, 5]], [6, [0, 1, 2, 3, 5]], [7, [4]]] as const) {
        now = pose(step, [...bones], now);
        posed.apply(now, step % 2 === 0);
        const check = source(blend);
        new PosedMeshes([check]).apply(now);
        expect(positions(live)).toEqual(positions(check));
        expect(normals(live)).toEqual(normals(check));
      }
    });
  }

  it('成品角色的表情（静止的样子先改一改）换了，骨骼没动也重算', () => {
    const live = source('dual', 7);
    const posed = new PosedMeshes([live]);
    let smile = 0;
    const edit = (_: number, position: Float32Array) => {
      for (let v = 0; v < 40; v++) position[v * 3 + 1] += smile;
    };
    posed.edit = edit;
    const now = pose(3);
    posed.apply(now);
    smile = 0.05;
    posed.apply(now);
    const check = source('dual', 7);
    const fresh = new PosedMeshes([check]);
    fresh.edit = edit;
    fresh.apply(now);
    expect(positions(live)).toEqual(positions(check));
  });

  it('拖着时估的包围盒、包围球框得住所有顶点；不拖了算回准的', () => {
    const live = source('dual', 3);
    const posed = new PosedMeshes([live]);
    let now = pose(1);
    posed.apply(now);
    for (let step = 2; step < 8; step++) {
      now = pose(step, [step % BONES], now);
      posed.apply(now, true);
      const box = live.geometry.boundingBox!;
      const sphere = live.geometry.boundingSphere!;
      const p = positions(live);
      for (let v = 0; v < COUNT; v++) {
        const point = new THREE.Vector3(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
        expect(box.containsPoint(point)).toBe(true);
        expect(sphere.distanceToPoint(point)).toBeLessThanOrEqual(1e-6);
      }
    }
    posed.apply(now);
    const exact = new THREE.Box3().setFromBufferAttribute(live.geometry.getAttribute('position') as THREE.BufferAttribute);
    expect(live.geometry.boundingBox!.equals(exact)).toBe(true);
  });

  it('放回静止的样子以后再摆，从头全部重算', () => {
    const live = source('linear', 5);
    const posed = new PosedMeshes([live]);
    posed.apply(pose(1));
    posed.restore();
    const now = pose(2, [1], pose(1));
    posed.apply(now);
    const check = source('linear', 5);
    new PosedMeshes([check]).apply(now);
    expect(positions(live)).toEqual(positions(check));
  });
});

/** 顶点全拿掉了的网格（连体没有腿时，裤子、鞋只剩 0 个顶点） */
function emptySource(): SkinSource {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(0), 3));
  return { geometry, joints: new Uint16Array(0), weights: new Float32Array(0), unit: 1, blend: 'linear' };
}

describe('包围盒', () => {
  it('0 个顶点的网格不把整个包围盒撑成无穷大（阴影、镜头会算成 NaN）', () => {
    const full = source('linear', 3);
    const posed = new PosedMeshes([full, emptySource()]);
    posed.apply(pose(1));
    const box = posed.bounds();
    expect([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)).toBe(true);
    expect(box.equals(full.geometry.boundingBox!)).toBe(true);
  });
});
