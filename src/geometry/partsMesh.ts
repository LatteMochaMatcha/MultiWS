/**
 * 「分部件」网格：把每个部件的基本体各自做成几何体再并成一个网格，部件之间不融合。
 * 这是 v1 的做法，留作可选模式；融合成一整块的网格在 SDF 模块里做。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { graftMeshOf } from '../anime/grafts';
import { HAND_CUFF, HAND_STUMP } from '../anime/hand';
import { fieldFromFunction } from '../sdf/field';
import { getGrid, gridDist } from '../sdf/grids';
import { meshField } from '../sdf/surfaceNets';
import {
  type Cone,
  type Ellipsoid,
  type Graft,
  type GridShape,
  type Loft,
  type Part,
  type Prim,
  type Tube,
  type Wing,
  graftFrame,
  shapeMatrix,
} from './figure';
import { WING_OUTLINE, tubeCurve, tubeRadius, tubeTipRadius } from './shapes';

const Y = new THREE.Vector3(0, 1, 0);
const vec = (p: readonly number[]) => new THREE.Vector3(p[0], p[1], p[2]);

/**
 * 网格是一圈一圈排的（每圈 cols + 1 个顶点，首尾两个重合）。
 * 重新算过法线后接缝两侧的法线不一样，会看到一条缝；这里把它们取平均。
 */
function weldSeam(geo: THREE.BufferGeometry, rows: number, cols: number) {
  const n = geo.attributes.normal;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    const i0 = i * (cols + 1);
    const i1 = i0 + cols;
    a.fromBufferAttribute(n, i0).add(b.fromBufferAttribute(n, i1)).normalize();
    n.setXYZ(i0, a.x, a.y, a.z);
    n.setXYZ(i1, a.x, a.y, a.z);
  }
}

function ellipsoidGeo(p: Pick<Ellipsoid, 'center' | 'radii' | 'quat'>, coarse = false) {
  // 眼睛、关节封口这类小东西不需要那么密
  const small = coarse || Math.max(...p.radii) < 0.02;
  const geo = new THREE.SphereGeometry(1, small ? 16 : 28, small ? 10 : 18);
  geo.scale(p.radii[0], p.radii[1], p.radii[2]);
  if (p.quat) geo.applyQuaternion(new THREE.Quaternion(p.quat[0], p.quat[1], p.quat[2], p.quat[3]));
  geo.translate(p.center[0], p.center[1], p.center[2]);
  return geo;
}

/** 圆台，两端各用一个球封口 */
function coneGeos(p: Cone) {
  const a = vec(p.a);
  const d = vec(p.b).sub(a);
  const length = d.length();
  const caps = [
    ellipsoidGeo({ center: p.a, radii: [p.ra, p.ra, p.ra] }, true),
    ellipsoidGeo({ center: p.b, radii: [p.rb, p.rb, p.rb] }, true),
  ];
  if (length < 1e-6) return caps;
  // 细的圆棒（手指）沿长度多切几段：摆姿势时一根手指里面要能弯
  const rows = Math.max(p.ra, p.rb) < 0.02 ? Math.min(8, Math.max(1, Math.ceil(length / 0.01))) : 1;
  const side = new THREE.CylinderGeometry(p.rb, p.ra, length, 22, rows, true);
  side.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()));
  side.translate(a.x + d.x / 2, a.y + d.y / 2, a.z + d.z / 2);
  return [side, ...caps];
}

/** 沿曲线渐细的管，两端各加一个球封口 */
function tubeGeos(p: Tube) {
  const curve = tubeCurve(p);
  const along = 56;
  const around = 16;
  const geo = new THREE.TubeGeometry(curve, along, 1, around, false);
  const pos = geo.attributes.position;
  const q = new THREE.Vector3();
  for (let i = 0; i <= along; i++) {
    const u = i / along;
    const c = curve.getPointAt(u);
    const r = tubeRadius(p, u);
    for (let j = 0; j <= around; j++) {
      const k = i * (around + 1) + j;
      q.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, q.x, q.y, q.z);
    }
  }
  geo.computeVertexNormals();
  weldSeam(geo, along + 1, around);
  const tip = curve.getPointAt(1);
  const tipR = tubeTipRadius(p);
  return [
    geo,
    ellipsoidGeo({ center: p.points[0], radii: [p.r0, p.r0, p.r0] }),
    ellipsoidGeo({ center: [tip.x, tip.y, tip.z], radii: [tipR, tipR, tipR] }),
  ];
}

/** 一摞椭圆截面放样成躯干，上下各封一个口 */
function loftGeo(p: Loft) {
  const { rings } = p;
  const around = 44;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of rings) {
    for (let j = 0; j <= around; j++) {
      const t = -Math.PI / 2 + (j / around) * Math.PI * 2;
      pos.push(r.w * Math.cos(t), r.y, r.z + r.d * Math.sin(t));
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j;
      const b = a + around + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const bottom = rings[0];
  const top = rings[rings.length - 1];
  const cap = (top.y - bottom.y) * 0.004;
  const c0 = pos.length / 3;
  pos.push(0, bottom.y - cap, bottom.z);
  const c1 = c0 + 1;
  pos.push(0, top.y + cap, top.z);
  const last = (rings.length - 1) * (around + 1);
  for (let j = 0; j < around; j++) {
    idx.push(c0, j, j + 1);
    idx.push(c1, last + j + 1, last + j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  weldSeam(geo, rings.length, around);
  return geo;
}

function wingGeo(p: Wing) {
  const shape = new THREE.Shape();
  WING_OUTLINE.forEach(([x, y], i) => {
    const px = x * p.size * p.side;
    const py = y * p.size;
    if (i) shape.lineTo(px, py);
    else shape.moveTo(px, py);
  });
  shape.closePath();
  const bevel = p.thickness / 3;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: p.thickness,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 4,
  });
  geo.translate(0, 0, -p.thickness / 2);
  geo.computeVertexNormals();
  return geo;
}

/** cuff：见 gridGeo */
function primGeos(p: Prim, cuff = 1): THREE.BufferGeometry[] {
  switch (p.kind) {
    case 'ellipsoid':
      // 挖掉的体块（眼窝）只在融合网格里有意义
      return p.cut ? [] : [ellipsoidGeo(p)];
    case 'cone':
      return p.cut ? [] : coneGeos(p);
    case 'tube':
      return tubeGeos(p);
    case 'loft':
      return [loftGeo(p)];
    case 'wing':
      return [wingGeo(p)];
    case 'grid':
      return p.cut ? [] : [gridGeo(p, cuff)];
  }
}

/**
 * 采样好的形状：从它的距离场里取一张网格出来（和格子差不多细）。
 * cuff：手的袖口相对手臂（沿手臂的方向）是原来的几分之几长——手臂被手动拉长以后手不跟着拉长，袖口就显得短了
 */
function gridGeo(p: GridShape, cuff: number) {
  const grid = getGrid(p.grid);
  // 手臂的格子在融合时多留了一截伸进手里（见 anime/hand.ts）；这里不融合，切到手的切口里面一点就够了，免得和手叠着
  const d = gridDist(grid, p.clipTo === undefined ? p : { ...p, clipTo: p.clipTo - HAND_STUMP - HAND_CUFF * cuff + 0.003 });
  const mesh = meshField(fieldFromFunction(d.fn, d.min, d.max), grid.cell * 1.2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
  return geo;
}

/** 接在部件上的现成网格（手、脚），摆到部件自己的坐标里（部件的拉伸已经算进去，见 graftFrame） */
function graftGeo(part: Part, graft: Graft) {
  const hand = graftMeshOf(graft.mesh);
  const { matrix: m, offset } = graftFrame(part, graft);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(hand.positions.slice(), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(hand.normals.slice(), 3));
  const flipped = new THREE.Matrix3().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]).determinant() < 0;
  // 镜像过的（右手）面要反过来才朝外
  const index = Uint32Array.from(hand.triangles);
  if (flipped) for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.applyMatrix4(new THREE.Matrix4().set(m[0], m[1], m[2], offset[0], m[3], m[4], m[5], offset[1], m[6], m[7], m[8], offset[2], 0, 0, 0, 1));
  return geo;
}

/** 一个部件的网格，坐标在部件自己的局部空间里（stretch、resize 已经算进顶点） */
export function buildPartGeometry(part: Part): THREE.BufferGeometry {
  const m = shapeMatrix(part);
  const grafts = part.grafts ?? [];
  // 手臂被手动拉长了的话，手不跟着拉长：手的袖口沿手臂的方向就比手臂短了一截
  let cuff = 1;
  if (m && grafts.length) {
    const frame = graftFrame(part, grafts[0]);
    const fore = new THREE.Vector3(...grafts[0].reach);
    const turn = new THREE.Matrix3().set(...grafts[0].matrix);
    const kept = new THREE.Matrix3().set(...frame.matrix);
    const before = fore.clone().applyMatrix3(turn);
    const stretched = before.clone().applyMatrix3(new THREE.Matrix3().set(...m));
    cuff = fore.clone().applyMatrix3(kept).length() / stretched.length();
  }
  const prims = part.prims.flatMap((p) => primGeos(p, cuff));
  // 拉伸只作用在部件自己的基本体上
  if (m) for (const g of prims) g.applyMatrix4(new THREE.Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1));
  const geos = [...prims, ...grafts.map((graft) => graftGeo(part, graft))];
  let geo = geos[0];
  if (geos.length > 1) {
    // 合并要求各块的顶点属性一致：白模用不到 UV，统一去掉
    for (const g of geos) g.deleteAttribute('uv');
    const merged = mergeGeometries(geos, false);
    if (!merged) throw new Error(`部件 ${part.name} 的网格合并失败`);
    for (const g of geos) g.dispose();
    geo = merged;
  }
  return geo;
}

export function triangleCount(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
}
