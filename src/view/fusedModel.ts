/**
 * 融合模式在场景里的模型：身体是一整块网格（在 Worker 里算），眼睛是另外摆上去的标记。
 *
 * 身体网格按 Figure 自己的单位来算，整体缩放放在根节点上：拖「身高」只改缩放，不用重新融合。
 * 参数变了以后先出一版粗的（拖动时跟手），停下来再换成细一档的预览网格。
 * 摆姿势时身体不再变了，预览网格到了以后再换成更细的一张（最细和导出的一样）：关节弯起来更顺。
 * （手不在这张格子里：它是缝上去的现成网格，什么精度下手指都是分开的，见 sdf/graft.ts。）
 * 部件特别多的身体细不到那个程度：顶点太多，拖圆点的时候每一帧都要把它们搬一遍，会卡。
 *
 * 摆姿势时屏幕上其实有两张身体：
 * - 拖着圆点的时候，是静止的那张网格照蒙皮权重跟着骨骼动（快，每一帧都跟手，但关节转得多的地方是扯出来的）；
 * - 手一松，后台照摆好的姿势重新融合一张（各部件的形状照骨骼搬过去再融合，见 sdf/posedField.ts），
 *   算好就换上：肩膀、腿根和「造型」里一样是融合出来的。再动姿势又先换回会跟手的那张。
 */
import * as THREE from 'three';
import { type Figure, type Part, worldTransforms } from '../geometry/figure';
import { buildPartGeometry } from '../geometry/partsMesh';
import type { SkinWeights } from '../rig/skin';
import { hasBindPose } from '../sdf/bindPose';
import { VOXEL } from '../sdf/fuse';
import { MeshClient, Superseded } from '../sdf/meshClient';
import type { FusedMesh, FusedMeshInfo } from '../sdf/surfaceNets';
import { MATERIALS } from './materials';
import { shapeKey } from './partsModel';
import { type SkinSource, WHITE_BLEND } from './posedMeshes';

export interface FusedStats {
  triangles: number;
  box: THREE.Box3;
  info: FusedMeshInfo;
  /** 屏幕上这一版是不是还是拖动时的粗网格 */
  draft: boolean;
  /** 屏幕上这一版是不是比预览的细（摆姿势时） */
  fine: boolean;
}

/** 导出用的精细网格 */
export interface FusedExport {
  /** 顶点位置，米 */
  positions: Float32Array;
  normals: Float32Array;
  /** 四边面（每 4 个下标一个）；全部的三角面（四边面对半切开，再加上本来就是三角面的那些，每 3 个下标一个） */
  quads: Uint32Array;
  triangles: Uint32Array;
  /** 本来就是三角面的那些（缝上去的手）；没有就没有这一项 */
  tris?: Uint32Array;
  info: FusedMeshInfo;
  /** 蒙皮权重；骨骼的顺序和 buildSkeleton(figure) 给出的一样 */
  skin?: SkinWeights;
}

/** 预览网格算得比这个快（毫秒）时，拖动中也直接出预览精度，不用先出粗的 */
const FAST_ENOUGH = 110;
/** 记网格是照哪副参数算的时候，「手臂是先张开再融合的」那一种带着这个后缀 */
const BOUND = '|bind';
/** 停止拖动多久以后把粗网格换成预览精度 */
const SETTLE_MS = 200;
/** 姿势停下来多久以后照它重新融合一张 */
const POSE_SETTLE_MS = 160;
/** 预览精度的网格到了以后再等这么久，还没有新的改动就换一张更细的 */
const FINE_SETTLE_MS = 250;

function toGeometry(mesh: FusedMesh): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.triangles, 1));
  geo.computeBoundingBox();
  return geo;
}

export class FusedModel {
  readonly root = new THREE.Group();
  /** 网格更新（或者只是整体缩放变了）时调用 */
  onUpdate: (stats: FusedStats) => void = () => {};
  /** 照摆好的姿势重新融合的那张换上来了 */
  onPosed: () => void = () => {};
  onError: (err: Error) => void = () => {};
  /** 停下来以后换上的细网格最多细到大约多少个顶点（手机上调低一些） */
  meshBudget = 110_000;

  private readonly body = new THREE.Mesh(new THREE.BufferGeometry(), MATERIALS.clay);
  /** 照摆好的姿势重新融合出来的那张（没有、或者过时了就藏着） */
  private readonly exact = new THREE.Mesh(new THREE.BufferGeometry(), MATERIALS.clay);
  private readonly eyes = new THREE.Group();
  private eyeCache = new Map<string, THREE.BufferGeometry>();
  private readonly preview = new MeshClient();
  private readonly exporter = new MeshClient();
  private readonly poser = new MeshClient();

  private parts: Part[] = [];
  private blend = 0;
  private scale = 1;
  /** 想要的形状 / 屏幕上现在的形状 */
  private wantKey = '';
  private shownKey = '';
  /** 现在这副身体（部件和融合圆角），不管要不要权重 */
  private shape = '';
  private shownVoxel = Infinity;
  private info: FusedMeshInfo | null = null;
  private previewMs = Infinity;
  private timer = 0;
  private fineTimer = 0;
  /** 要不要顺便算蒙皮权重（摆姿势时要）；屏幕上这张网格的权重（没算就是 null） */
  private wantSkin = false;
  private skin: SkinWeights | null = null;
  /** 现在摆的姿势（每根骨骼的蒙皮矩阵，这张网格自己的单位）；每换一个姿势、换一副身体，序号加一 */
  private posing: Float64Array | null = null;
  private poseSerial = 0;
  /** exact 那张是照多细的格子算的（没有就是无穷大） */
  private exactVoxel = Infinity;
  private poseTimer = 0;

  constructor() {
    this.root.name = 'OC_BaseMesh';
    this.body.name = 'Body';
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.exact.name = 'Body_Posed';
    this.exact.castShadow = true;
    this.exact.receiveShadow = true;
    this.exact.visible = false;
    this.eyes.name = 'Eyes';
    this.root.add(this.body, this.exact, this.eyes);
  }

  /** 屏幕上的网格是不是已经跟上了最新的参数（预览精度） */
  get settled() {
    return this.shownKey === this.wantKey && this.shownVoxel <= VOXEL.preview;
  }

  /** skin：顺便算出蒙皮权重（摆姿势时屏幕上的网格要跟着骨骼动），并且随后换成精细的网格 */
  request(figure: Figure, blend: number, skin = false) {
    this.scale = figure.scale;
    this.blend = blend;
    this.root.scale.setScalar(figure.scale);
    this.placeEyes(figure);
    // 眼睛不参与融合，眼睛的数量和位置变了不用重算身体
    this.parts = figure.parts.filter((p) => p.material !== 'eye');
    const shape = `${blend}|${JSON.stringify(this.parts)}`;
    // 要权重时，聚在一个肩膀上的几条手臂是先张开再融合的（见 sdf/bindPose.ts）：和不要权重时不是同一张网格
    const key = skin && hasBindPose(this.parts) ? `${shape}${BOUND}` : shape;
    if (key === this.wantKey && (this.wantSkin || !skin)) {
      // 形状没变，只是整体缩放变了：包围盒跟着变，通知一声
      if (this.shownKey === key) this.emit();
      return;
    }
    const sameShape = shape === (this.shownKey.endsWith(BOUND) ? this.shownKey.slice(0, -BOUND.length) : this.shownKey);
    // 身体变了：照旧身体摆出来的那张作废；还在给旧身体算的细网格也停下（拖动时那种粗的、预览的不停：
    // 一直在拖的话每一张都会被下一张顶掉，就一张都出不来了）
    if (shape !== this.shape) {
      this.shape = shape;
      this.posing = null;
      this.dropExact();
      this.preview.cancel((job) => job.voxel < VOXEL.preview);
    }
    this.wantKey = key;
    this.wantSkin = skin;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.fineTimer);
    if (sameShape) {
      // 形状没变，只是现在要权重了（或者不要了）：直接照预览的精度再算一遍，不先换成粗的
      this.send(key, VOXEL.preview);
    } else if (this.previewMs <= FAST_ENOUGH) {
      this.send(key, VOXEL.preview);
    } else {
      this.send(key, VOXEL.draft);
      this.timer = window.setTimeout(() => this.send(key, VOXEL.preview), SETTLE_MS);
    }
  }

  private send(key: string, voxel: number) {
    const withSkin = this.wantSkin;
    this.preview.run({ parts: this.parts, voxel, blend: this.blend, skin: withSkin }).then(
      ({ mesh, skin }) => {
        if (voxel === VOXEL.preview) this.previewMs = mesh.info.ms;
        // 参数又变了，或者屏幕上已经是同一形状更细的一版：这份结果不用了（除非它带来了屏幕上那张没有的权重）
        const brings = Boolean(skin) && !this.skin && voxel <= this.shownVoxel;
        if (key !== this.wantKey || (key === this.shownKey && voxel >= this.shownVoxel && !brings)) return;
        this.body.geometry.dispose();
        this.body.geometry = toGeometry(mesh);
        this.shownKey = key;
        this.shownVoxel = voxel;
        this.info = mesh.info;
        this.skin = skin ?? null;
        this.emit();
        // 照摆好的姿势重新融合的那张也跟着细一档
        if (this.exact.visible && voxel < this.exactVoxel) this.sendPosed(this.poseSerial, voxel);
        // 预览的到了，停一下没有新的改动，就接着算一张更细的（算好之前先用预览的摆着；摆姿势时不等）。
        // 顶点数大致和格子边长的平方成反比：照预算定能细到多少（不比导出的细），细不了多少的就不换了
        if (voxel === VOXEL.preview) {
          const want = VOXEL.preview * Math.sqrt(mesh.info.vertices / this.meshBudget);
          const finer = Math.max(VOXEL.fine, Math.ceil(want * 2000) / 2000);
          if (finer <= VOXEL.preview * 0.85) {
            window.clearTimeout(this.fineTimer);
            if (withSkin) this.send(key, finer);
            else this.fineTimer = window.setTimeout(() => key === this.wantKey && this.send(key, finer), FINE_SETTLE_MS);
          }
        }
      },
      (err) => {
        if (!(err instanceof Superseded)) this.onError(err);
      },
    );
  }

  private emit() {
    const geo = this.body.geometry;
    if (!this.info || !geo.boundingBox || !geo.index) return;
    const box = geo.boundingBox.clone();
    box.min.multiplyScalar(this.scale);
    box.max.multiplyScalar(this.scale);
    this.onUpdate({
      triangles: geo.index.count / 3,
      box,
      info: this.info,
      draft: this.shownVoxel > VOXEL.preview,
      fine: this.shownVoxel < VOXEL.preview,
    });
  }

  /**
   * 摆姿势：matrices 是每根骨骼的蒙皮矩阵（这张网格自己的单位，骨骼的顺序同 buildSkeleton）；null 是不摆了。
   * 每次姿势变了都叫一声：先换回跟着骨骼动的那张，停下来以后照新的姿势重新融合一张换上。
   */
  pose(matrices: Float64Array | null) {
    if (!matrices) {
      this.posing = null;
      this.dropExact();
      return;
    }
    const before = this.posing;
    if (before && before.length === matrices.length) {
      let moved = false;
      for (let i = 0; i < matrices.length && !moved; i++) moved = Math.abs(matrices[i] - before[i]) > 1e-7;
      if (!moved) return;
    }
    this.posing = matrices.slice();
    this.dropExact();
    const serial = this.poseSerial;
    this.poseTimer = window.setTimeout(() => this.sendPosed(serial, VOXEL.preview), POSE_SETTLE_MS);
  }

  /** 摆好以后重新融合的那张作废（藏起来，还在算的也停下：再松手时新的一张不用等它算完） */
  private dropExact() {
    window.clearTimeout(this.poseTimer);
    this.poser.cancel();
    this.poseSerial++;
    this.exactVoxel = Infinity;
    this.exact.visible = false;
    this.body.visible = true;
  }

  private sendPosed(serial: number, voxel: number) {
    if (serial !== this.poseSerial || !this.posing) return;
    this.poser.run({ parts: this.parts, voxel, blend: this.blend, pose: this.posing }).then(
      ({ mesh }) => {
        if (serial !== this.poseSerial || voxel >= this.exactVoxel) return;
        this.exact.geometry.dispose();
        this.exact.geometry = toGeometry(mesh);
        this.exactVoxel = voxel;
        this.exact.visible = true;
        this.body.visible = false;
        this.onPosed();
        // 再照屏幕上那张跟着骨骼动的网格的精度细一档
        const finer = Math.min(voxel, this.shownVoxel);
        if (finer < voxel * 0.85) this.sendPosed(serial, finer);
      },
      (err) => {
        if (!(err instanceof Superseded)) this.onError(err);
      },
    );
  }

  /** 眼睛：照部件数据摆好，不融合进身体 */
  private placeEyes(figure: Figure) {
    this.eyes.clear();
    const xfs = worldTransforms({ parts: figure.parts, scale: 1 });
    const next = new Map<string, THREE.BufferGeometry>();
    for (const part of figure.parts) {
      if (part.material !== 'eye') continue;
      const key = shapeKey(part);
      const geo = this.eyeCache.get(key) ?? next.get(key) ?? buildPartGeometry(part);
      next.set(key, geo);
      const xf = xfs.get(part.name)!;
      const mesh = new THREE.Mesh(geo, MATERIALS.eye);
      mesh.name = part.name;
      mesh.position.set(xf.pos[0], xf.pos[1], xf.pos[2]);
      mesh.quaternion.set(xf.quat[0], xf.quat[1], xf.quat[2], xf.quat[3]);
      mesh.scale.setScalar(xf.scale);
      this.eyes.add(mesh);
    }
    for (const [key, geo] of this.eyeCache) if (!next.has(key)) geo.dispose();
    this.eyeCache = next;
  }

  /** 屏幕上这张身体网格和它的蒙皮权重；权重还没算出来（或者网格还没跟上最新的参数）时是 null */
  skinSource(): SkinSource | null {
    if (!this.skin || this.shownKey !== this.wantKey) return null;
    return { geometry: this.body.geometry, joints: this.skin.joints, weights: this.skin.weights, unit: this.scale, blend: WHITE_BLEND };
  }

  /**
   * 摆姿势时让眼睛的标记跟着头走：matrixOf 给出某个眼睛（按部件名）所跟的那根骨骼的变换（按这张网格自己的单位），
   * 没有就留在原地。传 null 是都放回原处。
   */
  poseEyes(matrixOf: ((part: string) => THREE.Matrix4 | null) | null) {
    for (const eye of this.eyes.children) {
      const moved = matrixOf?.(eye.name);
      eye.matrixAutoUpdate = !moved;
      eye.updateMatrix();
      if (moved) eye.matrix.premultiply(moved);
      eye.matrixWorldNeedsUpdate = true;
    }
  }

  /**
   * 导出用：按当前参数重新算一张精细的网格，整体缩放已经乘进顶点（单位米）。
   * 只有身体这一整块，不带眼睛标记。skin：顺便算出蒙皮权重。
   * pose：照这个姿势融合（每根骨骼的蒙皮矩阵，这张网格自己的单位）；这时不算权重。
   */
  async exportData(options: { skin?: boolean; pose?: Float64Array } = {}): Promise<FusedExport> {
    const { mesh, skin } = await this.exporter.run({
      parts: this.parts,
      voxel: VOXEL.fine,
      blend: this.blend,
      skin: options.skin,
      pose: options.pose,
    });
    const s = this.scale;
    return {
      positions: s === 1 ? mesh.positions : mesh.positions.map((v) => v * s),
      normals: mesh.normals,
      quads: mesh.quads,
      triangles: mesh.triangles,
      tris: mesh.tris,
      info: mesh.info,
      skin,
    };
  }
}
