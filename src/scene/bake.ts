/**
 * 场景里别的角色（见 docs/scene-plan.md）：只凭一份设定，在后台算出它摆好姿势以后的样子。
 *
 * 和 main.ts 里给当前角色导出的那几段（exportFused、exportParts、exportCharacter）做法一样，
 * 只是不碰界面上的任何状态（屏幕上的模型、摆姿势的骨架、选中的部件）：当前角色正在改的时候也能算别人。
 * 摆过姿势的照摆好的样子（不管现在在不在「摆姿势」那一页）；没摆过的是静止姿势。
 *
 * 算出来的东西三处用：屏幕上定住显示（toObject）、导出整个场景的 GLB（toGlb）、OBJ / STL（shapes）。
 */
import * as THREE from 'three';
import { animeGrid } from '../anime/body';
import { FOOT_CREDIT } from '../anime/foot';
import { GENITAL_CREDIT } from '../anime/genital';
import { TORSO_CREDIT } from '../anime/body';
import { type CharacterBuild, assembleCharacter } from '../character/assemble';
import { characterGlb, characterShape, characterSkeleton, poseBuild } from '../character/export';
import { characterSource, hairDonor } from '../character/load';
import { skinInPlace } from '../character/pose';
import { rosterEntry } from '../character/roster';
import { tweakCharacter } from '../character/tweak';
import { type Figure, worldTransforms } from '../geometry/figure';
import { buildPartGeometry } from '../geometry/partsMesh';
import { buildFigure } from '../geometry/layout';
import { type GlbMesh, writeGlb } from '../io/glb';
import { type BodySpec, type CharacterChoice, OWN_CHARACTER, torsoSides } from '../model/spec';
import { isPosed } from '../pose/posing';
import { type Frame, type PoseRig, forward, poseMatrices, posedBones } from '../pose/rig';
import { makeSolver, stateOf } from '../pose/solver';
import { type Skeleton, buildSkeleton } from '../rig/skeleton';
import { bindPartGrafts, skinVertices } from '../rig/skin';
import { VOXEL } from '../sdf/fuse';
import { MeshClient } from '../sdf/meshClient';
import { refusable } from '../sdf/posedField';
import { CharacterModel } from '../view/characterModel';
import { MATERIALS, MATERIAL_INFO } from '../view/materials';
import { type BakedMesh, PartsModel } from '../view/partsModel';
import { WHITE_BLEND } from '../view/posedMeshes';

/** 一块只有形状的网格（米，摆好的样子），OBJ / STL 用 */
export interface ShapeMesh {
  name: string;
  positions: Float32Array;
  normals?: Float32Array;
  triangles: Uint32Array;
}

export interface Baked {
  /** 成品角色：拼好、套了微调、摆好姿势的那一副（屏幕上照它建网格、带贴图） */
  character?: CharacterBuild;
  /** 白模：几块网格（融合的是一整块，分部件是一块一个部件） */
  meshes?: GlbMesh[];
  /** 带骨骼时的骨架（摆过姿势的是摆好的样子，当成新的静止姿势） */
  skeleton?: Skeleton;
  shapes: ShapeMesh[];
  /** 用到了要求署名的素材：每句一条 */
  credits: string[];
  triangles: number;
  /** 包围盒，角色自己的坐标（米） */
  box: THREE.Box3;
  /** 融合的白模的眼睛标记：只在屏幕上显示，不导出（和当前角色一样） */
  eyes?: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[];
}

export interface BakeOptions {
  /** 带不带骨骼和蒙皮权重（导出带骨骼的 GLB） */
  rig?: boolean;
  /** 融合的白模用多细的格子：屏幕上定住显示用预览精度，导出用精细的 */
  fine?: boolean;
}

/** 算别人用的网格线程：一次只算一个（MeshClient 后排的会顶掉先排的，这里自己排队） */
const client = new MeshClient();
let queue: Promise<unknown> = Promise.resolve();
function fuseOne<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** 摆的姿势：骨架、每根骨骼的蒙皮矩阵。没摆过是 null */
interface PoseOf {
  rig: PoseRig;
  frame: Frame;
  matrices: Float64Array;
}
function poseOf(spec: BodySpec, skeleton: Skeleton): PoseOf | null {
  if (!isPosed(spec.posing)) return null;
  const solver = makeSolver(skeleton.bones);
  const frame = forward(solver.rig, stateOf(solver, spec.posing));
  return { rig: solver.rig, frame, matrices: poseMatrices(solver.rig, frame) };
}

/** 摆好以后的骨架：当成新的静止姿势（和 main.ts 的 posedSkeleton 一样） */
const posedSkeleton = (pose: PoseOf, rest: Skeleton): Skeleton => ({
  bones: posedBones(pose.rig, pose.frame).map((b, i) => ({ ...b, part: rest.bones[i].part })),
});

/** 白模用到了要求署名的素材（和 main.ts 的 footCredit 一样） */
function figureCredits(target: Figure): string[] {
  const list: string[] = [];
  if (target.parts.some((p) => p.grafts?.some((g) => g.mesh === 'foot'))) list.push(FOOT_CREDIT);
  if (target.parts.some((p) => p.prims.some((q) => q.kind === 'grid' && q.grid === animeGrid('torso')))) list.push(TORSO_CREDIT);
  if (target.parts.some((p) => p.type === 'genital')) list.push(GENITAL_CREDIT);
  return list;
}

/** 成品角色用到的角色（身子的，加上换了角色的上半身的） */
export function charactersOf(spec: BodySpec): CharacterChoice[] {
  if (spec.bodyStyle !== 'character') return [];
  const ids = torsoSides(spec.counts.torsos).map((side) => spec.torsoCharacters?.[side]).filter((id): id is NonNullable<typeof id> => Boolean(id));
  return [...new Set([spec.character, ...ids])];
}

function boxOf(positions: Float32Array, box = new THREE.Box3()): THREE.Box3 {
  for (let i = 0; i < positions.length; i += 3) {
    box.expandByPoint(new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]));
  }
  return box;
}

function bakeCharacter(spec: BodySpec): Baked | null {
  const source = characterSource(spec.character);
  if (!source) return null;
  const rest = tweakCharacter(assembleCharacter(source, spec, hairDonor(spec.hair.style), characterSource), spec.characterOverrides).build;
  const pose = poseOf(spec, characterSkeleton(rest));
  const build = pose ? poseBuild(rest, pose.matrices, posedBones(pose.rig, pose.frame), spec.posing.faces) : rest;
  const credits = charactersOf(spec).flatMap((id) => {
    if (id === OWN_CHARACTER) {
      const own = characterSource(OWN_CHARACTER);
      return own ? [[own.title, own.author, own.license].filter(Boolean).join(' / ')] : [];
    }
    const credit = rosterEntry(id).credit;
    return credit ? [credit] : [];
  });
  const shape = characterShape(build);
  return {
    character: build,
    shapes: [{ name: 'OC_Character', positions: shape.positions, normals: shape.normals, triangles: shape.triangles }],
    credits,
    triangles: shape.triangles.length / 3,
    box: boxOf(shape.positions),
  };
}

/** 融合的白模的眼睛：照部件摆好；摆过姿势的跟着所在的那个头的骨骼走（和 main.ts 的 ensureKit、showPose 一样） */
function eyesOf(target: Figure, rest: Skeleton, pose: PoseOf | null): NonNullable<Baked['eyes']> {
  const xfs = worldTransforms({ parts: target.parts, scale: 1 });
  const byName = new Map(target.parts.map((p) => [p.name, p]));
  const scale = new THREE.Matrix4().makeScale(target.scale, target.scale, target.scale);
  const out: NonNullable<Baked['eyes']> = [];
  for (const part of target.parts) {
    if (part.material !== 'eye') continue;
    const xf = xfs.get(part.name);
    if (!xf) continue;
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(xf.pos[0], xf.pos[1], xf.pos[2]),
      new THREE.Quaternion(xf.quat[0], xf.quat[1], xf.quat[2], xf.quat[3]),
      new THREE.Vector3(xf.scale, xf.scale, xf.scale),
    );
    const matrix = scale.clone().multiply(local);
    if (pose) {
      let bone = -1;
      for (let p = part.parent ? byName.get(part.parent) : undefined; p && bone < 0; p = p.parent ? byName.get(p.parent) : undefined) {
        bone = rest.bones.findIndex((b) => b.part === p!.name);
      }
      if (bone >= 0) {
        const m = pose.matrices;
        const o = bone * 12;
        matrix.premultiply(new THREE.Matrix4().set(m[o], m[o + 1], m[o + 2], m[o + 9], m[o + 3], m[o + 4], m[o + 5], m[o + 10], m[o + 6], m[o + 7], m[o + 8], m[o + 11], 0, 0, 0, 1));
      }
    }
    out.push({ geometry: buildPartGeometry(part), matrix });
  }
  return out;
}

async function bakeFused(spec: BodySpec, target: Figure, options: BakeOptions): Promise<Baked> {
  const rest = buildSkeleton(target);
  const pose = poseOf(spec, rest);
  // 摆过姿势、不带骨骼的：照摆好的姿势重新融合；带骨骼的（或者这副身体不这么办，见 refusable）：静止的网格照权重搬过去
  const exactMatrices = pose && !options.rig ? poseMatrices(pose.rig, pose.frame, target.scale) : undefined;
  const exact = exactMatrices && refusable(target, exactMatrices) ? exactMatrices : undefined;
  const parts = target.parts.filter((p) => p.material !== 'eye');
  const { mesh, skin } = await fuseOne(() =>
    client.run({ parts, voxel: options.fine ? VOXEL.fine : VOXEL.preview, blend: spec.blend, skin: options.rig || Boolean(pose && !exact), pose: exact }),
  );
  const s = target.scale;
  const positions = s === 1 ? mesh.positions.slice() : mesh.positions.map((v) => v * s);
  const normals = mesh.normals.slice();
  // 带骨骼的也一样：顶点照权重搬到摆好的位置，骨架换成摆好的（当成新的静止姿势）
  if (pose && !exact) {
    if (!skin) throw new Error('no skin');
    skinInPlace(WHITE_BLEND, positions, normals, skin.joints, skin.weights, pose.matrices);
  }
  const glb: GlbMesh = {
    name: 'OC_BaseMesh',
    positions,
    normals,
    indices: mesh.triangles,
    material: MATERIAL_INFO.clay,
    ...(options.rig && skin ? { joints: skin.joints, weights: skin.weights } : {}),
  };
  return {
    meshes: [glb],
    ...(options.rig ? { skeleton: pose ? posedSkeleton(pose, rest) : rest } : {}),
    shapes: [{ name: 'OC_BaseMesh', positions, normals, triangles: mesh.triangles }],
    credits: figureCredits(target),
    triangles: mesh.triangles.length / 3,
    box: boxOf(positions),
    ...(options.rig ? {} : { eyes: eyesOf(target, rest, pose) }),
  };
}

const parts = new PartsModel();

function bakeParts(spec: BodySpec, target: Figure, options: BakeOptions): Baked {
  parts.update(target);
  const meshes: BakedMesh[] = parts.bakedMeshes();
  const rest = buildSkeleton(target);
  const pose = poseOf(spec, rest);
  let joints: Uint16Array | null = null;
  let weights: Float32Array | null = null;
  if (options.rig || pose) {
    // 所有部件的顶点放在一起算一次权重，再分回各个部件（和 main.ts 的 exportParts 一样）
    const positions = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0));
    const triangles = new Uint32Array(meshes.reduce((n, m) => n + m.indices.length, 0));
    let vertex = 0;
    let corner = 0;
    for (const m of meshes) {
      positions.set(m.positions, vertex * 3);
      for (let i = 0; i < m.indices.length; i++) triangles[corner++] = m.indices[i] + vertex;
      vertex += m.positions.length / 3;
    }
    const skin = bindPartGrafts(skinVertices(target, rest, positions, triangles, meshes), target, rest, meshes);
    joints = skin.joints;
    weights = skin.weights;
  }
  let first = 0;
  let triangles = 0;
  const box = new THREE.Box3();
  const glb: GlbMesh[] = meshes.map((m) => {
    const n = m.positions.length / 3;
    const j = joints?.slice(first * 4, (first + n) * 4);
    const w = weights?.slice(first * 4, (first + n) * 4);
    first += n;
    if (pose && j && w) skinInPlace(WHITE_BLEND, m.positions, m.normals, j, w, pose.matrices);
    boxOf(m.positions, box);
    triangles += m.indices.length / 3;
    return {
      name: m.name,
      positions: m.positions,
      normals: m.normals,
      indices: m.indices,
      material: MATERIAL_INFO[m.material],
      ...(options.rig && j && w ? { joints: j, weights: w } : {}),
    };
  });
  return {
    meshes: glb,
    ...(options.rig ? { skeleton: pose ? posedSkeleton(pose, rest) : rest } : {}),
    shapes: meshes.map((m) => ({ name: m.name, positions: m.positions, normals: m.normals, triangles: m.indices })),
    credits: figureCredits(target),
    triangles,
    box,
  };
}

/**
 * 照这份设定算出摆好的样子。用到的素材（素体、头发、成品角色的文件）要先载入好（见 main.ts 的 loadAssetsFor）；
 * 成品角色的文件没载入就退回白模人台，和屏幕上一样
 */
export async function bakeFigure(spec: BodySpec, options: BakeOptions = {}): Promise<Baked> {
  if (spec.bodyStyle === 'character') {
    const done = bakeCharacter(spec);
    if (done) return done;
  }
  const target = buildFigure(spec);
  return spec.meshMode === 'fused' ? bakeFused(spec, target, options) : bakeParts(spec, target, options);
}

/** 写成一个 GLB（一个角色）：带不带骨骼照算的时候的 rig */
export function bakedGlb(baked: Baked, rig: boolean, name: string): ArrayBuffer {
  const copyright = baked.credits.length ? baked.credits.join('；') : undefined;
  if (baked.character) return characterGlb(baked.character, { rig, ...(copyright ? { copyright } : {}) });
  return writeGlb(
    (baked.meshes ?? []).map((m) => ({ ...m, object: m.object ?? `${name}_${m.name}` })),
    {
      ...(copyright ? { copyright } : {}),
      ...(rig && baked.skeleton ? { skeleton: baked.skeleton, rigName: `${name}_Rig` } : {}),
    },
  );
}

/** 一个定住的角色在屏幕上的样子 */
export interface FrozenView {
  root: THREE.Object3D;
  dispose(): void;
}

/** 屏幕上定住显示：成品角色照原样带贴图，白模用和当前角色一样的材质 */
export function bakedView(baked: Baked): FrozenView {
  if (baked.character) {
    const model = new CharacterModel();
    model.update(baked.character);
    model.root.visible = true;
    return { root: model.root, dispose: () => model.dispose() };
  }
  const root = new THREE.Group();
  const byName = new Map(Object.values(MATERIAL_INFO).map((info, i) => [info.name, Object.values(MATERIALS)[i]]));
  for (const m of baked.meshes ?? []) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    if (m.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    else geometry.computeVertexNormals();
    geometry.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, byName.get(m.material?.name ?? '') ?? MATERIALS.clay);
    mesh.name = m.name;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  for (const eye of baked.eyes ?? []) {
    const mesh = new THREE.Mesh(eye.geometry, MATERIALS.eye);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(eye.matrix);
    root.add(mesh);
  }
  return {
    root,
    dispose: () => root.traverse((o) => (o as THREE.Mesh).geometry?.dispose()),
  };
}
