/**
 * 融合模式在场景里的模型：身体是一整块网格（在 Worker 里算），眼睛是另外摆上去的标记。
 *
 * 身体网格按 Figure 自己的单位来算，整体缩放放在根节点上：拖「身高」只改缩放，不用重新融合。
 * 参数变了以后先出一版粗的（拖动时跟手），停下来再换成细一档的预览网格。
 * 一直在拖的时候，后台算好一张就换上一张（它照的是稍早一点的参数）；新网格到之前，屏幕上那张照每个顶点属于哪个部件
 * 整块挪到现在的样子（见 sdf/labels.ts）：手臂每一帧都跟着操纵杆走，肩膀那里的融合圆角等新网格到了再补上。
 * 换上新网格那一下不是直接跳过去：新网格先贴在原来那张的表面上，再平滑地变成自己的样子（见 view/morph.ts）。
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
import { type VertexLabels, followInto, followMatrices, outline, pieceFrames } from '../sdf/labels';
import { MeshClient, Superseded } from '../sdf/meshClient';
import type { BindMesh } from '../sdf/posedFuse';
import type { FusedMesh, FusedMeshInfo } from '../sdf/surfaceNets';
import { MATERIALS } from './materials';
import { shapeKey } from './partsModel';
import { morphLeft, surfaceOffsets } from './morph';
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

/** 拖动中一张网格最好在这么久（毫秒）以内算出来：照各档格子上一张算了多久，挑够快的最细的那档 */
const DRAG_TARGET = 110;
/**
 * 拖动中能挑的几档格子，从细到粗（预览那档够快就直接出预览）。
 * 0.012 和 0.02 之间的不要：二次元素体的胸照格子粗细烤成格子，那中间每换一档都要在每个线程里重烤一遍。
 * 比 0.02 粗的也不要：素体快不了多少（0.025 只快两成），脸和胸却糊成一团；拖着的时候手臂本来就是整块挪着跟手的
 */
const DRAG_VOXELS = [VOXEL.preview, VOXEL.draft];
/** 记网格是照哪副参数算的时候，「手臂是先张开再融合的」那一种带着这个后缀 */
const BOUND = '|bind';
/**
 * 换网格时的过渡（见 view/morph.ts）：新网格从贴着原来那张的表面变到自己的样子要多久（毫秒），
 * 照上一张网格隔了多久来（拖着的时候一张接一张，过渡正好接上下一张），在这两个数之间
 */
const MORPH_MS = [90, 220] as const;
/** 新网格的顶点离原来那张最近的顶点比这还远（部件自己的单位）就不过渡，直接是新的样子 */
const MORPH_REACH = 0.05;
/** 停止拖动多久以后把粗网格换成预览精度 */
const SETTLE_MS = 200;
/** 姿势停下来多久以后照它重新融合一张 */
const POSE_SETTLE_MS = 160;
/**
 * 预览精度的网格到了以后再等一会儿，还没有新的改动就换一张更细的。等多久照这张预览算了多久（细的那张大约要它的两三倍），
 * 在这两个数之间：算得快的早点换上；算得慢的（胸换了样子要重烤）多等等，连着改的时候后台不白忙一张多半要扔的
 */
const FINE_SETTLE_MS = [250, 1500] as const;

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
  /** 拖动中各档粗格子上一张算了多久（毫秒） */
  private readonly draftMs = new Map<number, number>();
  /** 每发一个任务加一；屏幕上那张是第几个任务算出来的 */
  private sent = 0;
  private shownSent = 0;
  /** 屏幕上这张是照哪些部件算的、每个顶点属于哪一块（没标就是 null）、那些部件各怎么摆、由哪些块拼成 */
  private shownParts: Part[] = [];
  private labels: VertexLabels | null = null;
  private shownFrames: Map<string, Float64Array> | null = null;
  private shownOutline = '';
  /** 现在这副身体由哪些块拼成（见 sdf/labels.ts 的 outline） */
  private outline = '';
  /** 整块挪之前的顶点、法线、包围盒、包围球（还没挪过就是 null） */
  private rest: { positions: Float32Array; normals: Float32Array; box: THREE.Box3; sphere: THREE.Sphere } | null = null;
  /** 整块挪过几次（量拖动跟不跟手用，见 tools/bench-drag.mjs） */
  follows = 0;
  /**
   * 摆姿势时预览精度、带权重的那张（静止的样子，复制一份：屏幕上那张会被拖着的骨骼改掉）和它是照哪副身体算的。
   * 照姿势融合时一起交给那个 Worker，它就不用再算一遍（见 FuseJob.bind）
   */
  private bind: { shape: string; mesh: BindMesh } | null = null;
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
  /**
   * 换网格时的过渡（见 view/morph.ts）：base 是这张网格该在的位置（整块挪过的），off 是贴到原来那张表面上要挪的，
   * 从 t0 起 ms 毫秒收回到 0。没在过渡是 null
   */
  private morph: { base: Float32Array; off: Float32Array; t0: number; ms: number } | null = null;
  /** 推过渡的那一帧排上了没有（同一时间只排一个） */
  private morphing = false;
  /** 上一次换网格是什么时候（定过渡多长用） */
  private swappedAt = 0;

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
      this.outline = outline(this.parts);
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
    } else {
      const voxel = this.dragVoxel();
      this.send(key, voxel);
      if (voxel !== VOXEL.preview) this.timer = window.setTimeout(() => this.send(key, VOXEL.preview), SETTLE_MS);
    }
    this.follow();
  }

  /** 拖动中这一张用哪档格子：照各档上一张算了多久，挑够快的最细的那档 */
  private dragVoxel(): number {
    let ms = this.previewMs;
    let last: number = VOXEL.preview;
    for (const voxel of DRAG_VOXELS) {
      // 没量过的照细一档的估：用时大致和格子边长成反比（缝手、编译这些不跟着格子变，减不到平方那么多）
      const known = voxel === VOXEL.preview ? this.previewMs : this.draftMs.get(voxel);
      const guess = known ?? ms * (last / voxel);
      // 什么都还没量过：先出一张粗的
      if (!Number.isFinite(guess)) return VOXEL.draft;
      if (guess <= DRAG_TARGET) return voxel;
      ms = guess;
      last = voxel;
    }
    return last;
  }

  private send(key: string, voxel: number) {
    const withSkin = this.wantSkin;
    const parts = this.parts;
    const shape = this.shape;
    const serial = ++this.sent;
    this.preview.run({ parts, voxel, blend: this.blend, skin: withSkin, labels: !withSkin }).then(
      ({ mesh, skin, labels }) => {
        if (skin && voxel === VOXEL.preview) {
          this.bind = { shape, mesh: { positions: mesh.positions.slice(), normals: mesh.normals.slice(), joints: skin.joints, weights: skin.weights } };
        }
        if (voxel === VOXEL.preview) this.previewMs = mesh.info.ms;
        else if (voxel > VOXEL.preview) this.draftMs.set(voxel, mesh.info.ms);
        // 参数又变了：比屏幕上那张新的照样换上，再整块挪到现在的样子（一直在拖的时候参数一直在变，
        // 要求一模一样的话一张都换不上）；比屏幕上那张旧的、摆姿势时的就不要了。
        // 参数没变，但屏幕上已经是同一形状更细的一版：也不要（除非它带来了屏幕上那张没有的权重）
        const fresh = key === this.wantKey;
        const brings = Boolean(skin) && !this.skin && voxel <= this.shownVoxel;
        if (fresh ? key === this.shownKey && voxel >= this.shownVoxel && !brings : serial < this.shownSent || this.wantSkin) return;
        // 屏幕上原来那张现在的样子（整块挪过的、过渡到一半的都算）：新网格从贴着它开始过渡。要权重的（摆姿势）不过渡
        const before = this.info && !skin && !this.wantSkin ? (this.body.geometry.getAttribute('position')?.array as Float32Array | undefined) : undefined;
        this.morph = null;
        this.body.geometry.dispose();
        this.body.geometry = toGeometry(mesh);
        if (before) this.startMorph(before);
        this.shownKey = key;
        this.shownVoxel = voxel;
        this.shownSent = serial;
        this.shownParts = parts;
        this.labels = labels ?? null;
        this.shownFrames = null;
        this.shownOutline = labels ? outline(parts) : '';
        this.rest = null;
        this.info = mesh.info;
        this.skin = skin ?? null;
        this.emit();
        if (!fresh) {
          this.follow();
          return;
        }
        // 照摆好的姿势重新融合的那张也跟着细一档
        if (this.exact.visible && voxel < this.exactVoxel) this.sendPosed(this.poseSerial, voxel);
        // 预览的到了，停一下没有新的改动，就接着算一张更细的（算好之前先用预览的摆着；摆姿势时不等）。
        // 顶点数大致和格子边长的平方成反比：照预算定能细到多少（不比导出的细），细不了多少的就不换了
        if (voxel === VOXEL.preview) {
          const want = VOXEL.preview * Math.sqrt(mesh.info.vertices / this.meshBudget);
          const finer = Math.max(VOXEL.fine, Math.ceil(want * 2000) / 2000);
          if (finer <= VOXEL.preview * 0.85) {
            window.clearTimeout(this.fineTimer);
            const wait = Math.min(FINE_SETTLE_MS[1], Math.max(FINE_SETTLE_MS[0], mesh.info.ms));
            if (withSkin) this.send(key, finer);
            else this.fineTimer = window.setTimeout(() => key === this.wantKey && this.send(key, finer), wait);
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
    const bounds = this.rest?.box ?? geo.boundingBox;
    if (!this.info || !bounds || !geo.index) return;
    const box = bounds.clone();
    box.min.multiplyScalar(this.scale);
    box.max.multiplyScalar(this.scale);
    this.onUpdate({
      triangles: geo.index.count / 3,
      box,
      info: this.info,
      // 照稍早一点的参数算的那张也算粗略的：还要换
      draft: this.shownVoxel > VOXEL.preview || this.shownKey !== this.wantKey,
      fine: this.shownVoxel < VOXEL.preview,
    });
  }

  /**
   * 屏幕上这张不是照现在的参数算的：照每个顶点属于哪一块，把它整块挪到现在的样子（见 sdf/labels.ts）；
   * 已经跟上了、或者身体换得挪不过去了（换了样式、多了少了部件），就放回原样。
   * 摆姿势时不挪：那时形状不变，屏幕上的网格是跟着骨骼动的
   */
  private follow() {
    const labels = this.labels;
    if (!labels || this.wantSkin) return;
    const geo = this.body.geometry;
    const position = geo.getAttribute('position') as THREE.BufferAttribute;
    const normal = geo.getAttribute('normal') as THREE.BufferAttribute;
    const movable = this.shownKey !== this.wantKey && this.shownOutline === this.outline;
    if (!this.rest) {
      if (!movable || !geo.boundingBox) return;
      geo.computeBoundingSphere();
      this.rest = {
        // 正在过渡的话，屏幕上的顶点还没到位：照这张网格该在的位置记
        positions: (this.morph?.base ?? (position.array as Float32Array)).slice(),
        normals: (normal.array as Float32Array).slice(),
        box: geo.boundingBox.clone(),
        sphere: geo.boundingSphere!.clone(),
      };
    }
    const rest = this.rest;
    this.shownFrames ??= pieceFrames(this.shownParts);
    const moves = movable ? followMatrices(labels.pieces, this.shownFrames, pieceFrames(this.parts)) : labels.pieces.map(() => null);
    const far = followInto(labels, moves, rest.positions, rest.normals, position.array as Float32Array, normal.array as Float32Array);
    position.needsUpdate = true;
    normal.needsUpdate = true;
    // 包围盒、包围球照挪得最远的那个顶点放大一圈（点选、视锥裁剪用），不逐个顶点重算
    geo.boundingBox = rest.box.clone().expandByScalar(far);
    geo.boundingSphere = rest.sphere.clone();
    geo.boundingSphere.radius += far;
    if (moves.some(Boolean)) this.follows++;
    // 正在过渡：整块挪过的是这张网格该在的位置，过渡还没收回去的那一截加在上面
    if (this.morph) {
      this.morph.base.set(position.array as Float32Array);
      geo.boundingBox.expandByScalar(MORPH_REACH);
      geo.boundingSphere.radius += MORPH_REACH;
      this.applyMorph();
    }
  }

  /** 新网格刚换上：量出每个顶点贴到原来那张表面上要挪多少，从那里开始过渡 */
  private startMorph(before: Float32Array) {
    const geo = this.body.geometry;
    const position = geo.getAttribute('position') as THREE.BufferAttribute;
    const normal = geo.getAttribute('normal') as THREE.BufferAttribute;
    const now = performance.now();
    const gap = now - this.swappedAt;
    this.swappedAt = now;
    const off = surfaceOffsets(before, position.array as Float32Array, normal.array as Float32Array, MORPH_REACH);
    this.morph = { base: (position.array as Float32Array).slice(), off, t0: now, ms: Math.min(MORPH_MS[1], Math.max(MORPH_MS[0], gap)) };
    geo.boundingBox?.expandByScalar(MORPH_REACH);
    geo.computeBoundingSphere();
    this.applyMorph();
    // 每一帧把过渡往前推一点（一帧一次：阴影、画面各画一遍也只推一次、只传一次顶点）
    if (!this.morphing) {
      this.morphing = true;
      requestAnimationFrame(this.stepMorph);
    }
  }

  /** 照过渡进行到哪儿写顶点；过渡完了放回这张网格该在的位置 */
  private applyMorph(): void {
    const morph = this.morph;
    if (!morph) return;
    const position = this.body.geometry.getAttribute('position') as THREE.BufferAttribute;
    const out = position.array as Float32Array;
    const left = morphLeft((performance.now() - morph.t0) / morph.ms);
    if (left <= 0) {
      out.set(morph.base);
      this.morph = null;
    } else {
      const { base, off } = morph;
      for (let i = 0; i < out.length; i++) out[i] = base[i] + off[i] * left;
    }
    position.needsUpdate = true;
  }

  private readonly stepMorph = () => {
    this.morphing = Boolean(this.morph);
    if (!this.morph) return;
    // 进了摆姿势：顶点要交给骨骼去搬，过渡直接做完
    if (this.wantSkin) this.morph.t0 = -Infinity;
    this.applyMorph();
    this.morphing = Boolean(this.morph);
    if (this.morph) requestAnimationFrame(this.stepMorph);
  };

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

  /** 静止姿势、预览精度、带权重的那张，是照现在这副身体算的才给 */
  private bindNow(): BindMesh | undefined {
    return this.bind?.shape === this.shape ? this.bind.mesh : undefined;
  }

  private sendPosed(serial: number, voxel: number) {
    if (serial !== this.poseSerial || !this.posing) return;
    this.poser.run({ parts: this.parts, voxel, blend: this.blend, pose: this.posing, bind: this.bindNow() }).then(
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
      bind: options.pose ? this.bindNow() : undefined,
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
