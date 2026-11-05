/**
 * 手动微调在 3D 视图里的那一半：点选部件、选中高亮、移动 / 旋转 / 缩放的操纵杆。
 * 这里只负责把鼠标操作换算成「这个部件的位置 / 角度 / 大小应该改成多少」，改数据的事交给外面。
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { type Figure, worldTransforms } from '../geometry/figure';
import { buildPartGeometry } from '../geometry/partsMesh';
import { type PartFrame, partFrame } from '../geometry/tweak';
import { type Quat, eulerOf, quatConj, quatEuler, quatMul, rotate } from '../geometry/vec';
import type { PartOverride, Vec3 } from '../model/spec';
import { shapeKey } from './partsModel';
import type { Viewport } from './viewport';

export const GIZMO_MODES = ['translate', 'rotate', 'scale'] as const;
export type GizmoMode = (typeof GIZMO_MODES)[number];

const DEG = Math.PI / 180;
/** 鼠标按下到松开挪了不超过这么多像素，才算「点了一下」（否则是在转视角） */
const CLICK_SLOP = 4;
/** 手指比鼠标抖得多，放宽一些 */
const TAP_SLOP = 10;
/** 同一个部件改了形状，停手多久以后重算高亮外壳（毫秒） */
const GLOW_SETTLE_MS = 400;

export class Gizmo {
  /** 在模型上点了一下：点中的部件名；点在空白处是 null */
  onPick: (name: string | null) => void = () => {};
  /** 拖动操纵杆：选中部件的微调应该改成这样（只给出这次在改的那一项） */
  onChange: (patch: PartOverride) => void = () => {};
  /** 一次拖动开始（true）/ 结束（false） */
  onDrag: (active: boolean) => void = () => {};
  /** 屏幕上的一条射线点中了哪个部件。两种网格模式的查法不一样，由外面提供 */
  pick: (ray: THREE.Raycaster) => string | null = () => null;
  /** 缩放时锁定比例：拖哪根轴都是整体放大缩小 */
  lockRatio = true;
  /** 关掉以后不接点选（摆姿势的时候，模型上点的是关节，不是部件） */
  enabled = true;

  private readonly controls: TransformControls;
  /** 操纵杆抓着的是这个看不见的物体，不是模型本身 */
  private readonly handle = new THREE.Object3D();
  private readonly glow: THREE.Mesh;
  private glowKey = '';
  /** 高亮外壳是哪个部件的；同一个部件形状变了时，等停手再重算（见 sync） */
  private glowName = '';
  private glowTimer = 0;
  private mode: GizmoMode = 'translate';
  private frame: PartFrame | null = null;
  private override: PartOverride = {};
  /** 这次拖动开始时的状态 */
  private start: { frame: PartFrame; position: Vec3; scale: Vec3; at: THREE.Vector3 } | null = null;
  private down: { x: number; y: number; busy: boolean } | null = null;
  /** 现在按在屏幕上的手指 */
  private readonly fingers = new Set<number>();
  /** 这一次触摸里用过两根手指（在缩放、平移）：松手时不算点选 */
  private pinched = false;

  constructor(viewport: Viewport) {
    const dom = viewport.renderer.domElement;
    this.controls = new TransformControls(viewport.camera, dom);
    // 用手指的屏幕上操纵杆画大一点，才捏得住
    this.controls.setSize(window.matchMedia('(pointer: coarse)').matches ? 1.15 : 0.75);
    this.controls.setSpace('local');

    // 选中的部件罩上一层半透明的颜色，隔着身体也看得见
    this.glow = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0x19a8b6, transparent: true, opacity: 0.34, depthTest: false, depthWrite: false }),
    );
    this.glow.renderOrder = 5;
    this.glow.visible = false;
    viewport.overlay.add(this.handle, this.glow, this.controls.getHelper());

    this.controls.addEventListener('dragging-changed', (event) => {
      const active = event.value === true;
      // 拖操纵杆的时候不转视角
      viewport.controls.enabled = !active;
      if (active && this.frame) {
        this.start = {
          frame: this.frame,
          position: this.override.position ?? [0, 0, 0],
          scale: this.override.scale ?? [1, 1, 1],
          at: this.handle.position.clone(),
        };
      } else {
        this.start = null;
      }
      this.onDrag(active);
    });
    this.controls.addEventListener('objectChange', () => this.dragged());

    // 点选。这两个监听排在操纵杆自己的监听后面：按下时它已经知道鼠标是不是落在操纵杆上
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // 第一根手指按下：新的一次触摸，从头数起
      if (e.isPrimary) {
        this.fingers.clear();
        this.pinched = false;
      }
      this.fingers.add(e.pointerId);
      if (this.fingers.size > 1) this.pinched = true;
      this.down = { x: e.clientX, y: e.clientY, busy: this.controls.dragging || this.controls.axis !== null };
    });
    dom.addEventListener('pointerup', (e) => {
      this.fingers.delete(e.pointerId);
      const down = this.down;
      this.down = null;
      if (!this.enabled || !down || down.busy || e.button !== 0 || this.pinched) return;
      const slop = e.pointerType === 'mouse' ? CLICK_SLOP : TAP_SLOP;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > slop) return;
      const rect = dom.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((e.clientY - rect.top) / rect.height) * 2),
        viewport.camera,
      );
      this.onPick(this.pick(ray));
    });
    dom.addEventListener('pointercancel', (e) => {
      this.fingers.delete(e.pointerId);
      this.down = null;
    });
  }

  get dragging(): boolean {
    return this.controls.dragging;
  }

  /** 选中的部件在世界坐标里占的那块地方（手机上镜头凑过去用）；没选中就是 null */
  selectionBox(): THREE.Box3 | null {
    if (!this.glow.visible) return null;
    const geometry = this.glow.geometry;
    if (!geometry.getAttribute('position')) return null;
    geometry.computeBoundingBox();
    if (!geometry.boundingBox) return null;
    this.glow.updateWorldMatrix(true, false);
    return geometry.boundingBox.clone().applyMatrix4(this.glow.matrixWorld);
  }

  setMode(mode: GizmoMode) {
    this.mode = mode;
    this.controls.setMode(mode);
    // 缩放模式下 three 的操纵杆总是沿物体自己的轴；另外两种也统一用自己的轴
    this.controls.setSpace('local');
    if (this.frame && !this.controls.dragging) this.place();
  }

  /**
   * 模型重建以后调用：把高亮和操纵杆摆到选中部件现在的位置。
   * name 为空、或者这个部件已经不存在时，两样都收起来。
   */
  sync(figure: Figure | null, name: string | null, override: PartOverride | undefined) {
    const part = name && figure ? figure.parts.find((p) => p.name === name) : undefined;
    this.frame = part && figure ? partFrame(figure, part.name) : null;
    this.override = override ?? {};
    if (!part || !figure || !this.frame) {
      if (this.controls.object) this.controls.detach();
      this.glow.visible = false;
      window.clearTimeout(this.glowTimer);
      this.glowName = '';
      return;
    }

    // 高亮外壳照这个部件自己的形状现算（粗一档）。格子做的部件（胸、躯干、手臂）算一次要几十到几百毫秒：
    // 换了选中的部件马上算；同一个部件拖着、滑着改形状时先沿用原来的外壳（下面照位置、朝向、大小摆过去），
    // 停手一会儿再照最新的形状算一次——不然每动一下都要等它，选中部件时调体型、微调就一顿一顿的
    const key = shapeKey(part);
    window.clearTimeout(this.glowTimer);
    if (key !== this.glowKey) {
      const rebuild = () => {
        this.glow.geometry.dispose();
        this.glow.geometry = buildPartGeometry(part, true);
        this.glowKey = key;
        this.glowName = part.name;
      };
      if (part.name !== this.glowName) rebuild();
      else this.glowTimer = window.setTimeout(rebuild, GLOW_SETTLE_MS);
    }
    const xf = worldTransforms(figure).get(part.name)!;
    this.glow.position.set(xf.pos[0], xf.pos[1], xf.pos[2]);
    this.glow.quaternion.set(xf.quat[0], xf.quat[1], xf.quat[2], xf.quat[3]);
    this.glow.scale.setScalar(xf.scale);
    this.glow.visible = true;

    // 正在拖的时候操纵杆归鼠标管，不去动它
    if (!this.controls.dragging) this.place();
    if (this.controls.object !== this.handle) this.controls.attach(this.handle);
  }

  /**
   * 成品角色用：部件不是一块块的基本体，支点、朝向是算好的（frame），高亮用给好的三角面（世界坐标，每三个点一个面）。
   * key 变了才换高亮的形状。frame 为空时两样都收起来
   */
  syncFrame(frame: PartFrame | null, glow: () => Float32Array, key: string, override: PartOverride | undefined) {
    this.frame = frame;
    this.override = override ?? {};
    if (!frame) {
      if (this.controls.object) this.controls.detach();
      this.glow.visible = false;
      return;
    }
    if (key !== this.glowKey) {
      window.clearTimeout(this.glowTimer);
      this.glowName = '';
      this.glow.geometry.dispose();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(glow(), 3));
      this.glow.geometry = geometry;
      this.glowKey = key;
    }
    this.glow.position.set(0, 0, 0);
    this.glow.quaternion.identity();
    this.glow.scale.setScalar(1);
    this.glow.visible = true;
    if (!this.controls.dragging) this.place();
    if (this.controls.object !== this.handle) this.controls.attach(this.handle);
  }

  /** 把操纵杆摆到支点上，朝向按当前模式来 */
  private place() {
    const f = this.frame;
    if (!f) return;
    const o = this.override;
    let q: Quat;
    if (this.mode === 'translate') {
      // 位置偏移是沿父部件的轴算的
      q = f.parentQuat;
    } else if (this.mode === 'rotate') {
      const r = o.rotation ?? [0, 0, 0];
      q = quatMul(f.parentQuat, quatEuler(r[0] * DEG, r[1] * DEG, r[2] * DEG));
    } else {
      q = f.axesQuat;
    }
    const s = this.mode === 'scale' ? (o.scale ?? [1, 1, 1]) : [1, 1, 1];
    this.handle.position.set(f.pivot[0], f.pivot[1], f.pivot[2]);
    this.handle.quaternion.set(q[0], q[1], q[2], q[3]);
    this.handle.scale.set(s[0], s[1], s[2]);
    this.handle.updateMatrixWorld(true);
  }

  /** 操纵杆被拖动了：换算成微调的数值 */
  private dragged() {
    const s = this.start;
    if (!s) return;
    if (this.mode === 'translate') {
      const d = this.handle.position.clone().sub(s.at);
      const local = rotate(quatConj(s.frame.parentQuat), [d.x, d.y, d.z]);
      const k = 1 / s.frame.parentScale;
      this.onChange({
        position: [s.position[0] + local[0] * k, s.position[1] + local[1] * k, s.position[2] + local[2] * k],
      });
    } else if (this.mode === 'rotate') {
      const q = this.handle.quaternion;
      const e = eulerOf(quatMul(quatConj(s.frame.parentQuat), [q.x, q.y, q.z, q.w]));
      this.onChange({ rotation: [e[0] / DEG, e[1] / DEG, e[2] / DEG] });
    } else {
      const v = this.handle.scale;
      let next: Vec3 = [Math.max(v.x, 0.01), Math.max(v.y, 0.01), Math.max(v.z, 0.01)];
      if (this.lockRatio) {
        // 拖的是哪根轴，就按那根轴的倍率整体缩放
        const ratios = next.map((n, i) => n / s.scale[i]);
        const most = ratios.reduce((a, b) => (Math.abs(Math.log(b)) > Math.abs(Math.log(a)) ? b : a));
        next = [s.scale[0] * most, s.scale[1] * most, s.scale[2] * most];
      }
      this.onChange({ scale: next });
    }
  }
}
