/**
 * 道具在 3D 视图里的操纵杆：移动、旋转、缩放（见 docs/props-plan.md）。
 * 和手动微调部件的那一套（view/gizmo.ts）分开：那边管的是身体上的部件，这边管场景里的道具。
 * 这里只把拖动换算成「位置 / 旋转 / 尺寸应该改成多少」，改数据的事交给外面。
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { SceneProp } from '../model/props';
import type { Vec3 } from '../model/spec';
import type { GizmoMode } from './gizmo';
import type { Viewport } from './viewport';

const RAD = Math.PI / 180;
/** 按住 Shift 拖：位置每 5 厘米一档，旋转每 15° 一档 */
const SNAP_MOVE = 0.05;
const SNAP_TURN = 15 * RAD;

export interface PropPatch {
  pos?: Vec3;
  rot?: Vec3;
  size?: Vec3;
}

export class PropGizmo {
  /** 拖动操纵杆：选中的道具应该改成这样（只给出这次在改的那一项） */
  onChange: (patch: PropPatch) => void = () => {};
  /** 一次拖动开始（true）/ 结束（false） */
  onDrag: (active: boolean) => void = () => {};

  private readonly controls: TransformControls;
  /** 操纵杆抓着的是这个看不见的物体，不是道具的网格；它和道具放在同一组里，所以它的位置就是场景里的位置 */
  private readonly handle = new THREE.Object3D();
  private mode: GizmoMode = 'translate';
  private prop: SceneProp | null = null;
  /** 这次缩放开始时道具多大 */
  private startSize: Vec3 | null = null;

  /** parent：道具那一组（view/propsModel.ts 的 root） */
  constructor(viewport: Viewport, parent: THREE.Object3D) {
    const dom = viewport.renderer.domElement;
    this.controls = new TransformControls(viewport.camera, dom);
    // 用手指的屏幕上操纵杆画大一点，才捏得住
    this.controls.setSize(window.matchMedia('(pointer: coarse)').matches ? 1.15 : 0.75);
    this.handle.rotation.order = 'YXZ';
    parent.add(this.handle);
    viewport.overlay.add(this.controls.getHelper());
    this.applyMode();

    this.controls.addEventListener('dragging-changed', (event) => {
      const active = event.value === true;
      // 拖操纵杆的时候不转视角
      viewport.controls.enabled = !active;
      this.startSize = active && this.prop ? [...this.prop.size] : null;
      if (!active) {
        // 缩放拖完：尺寸已经改进道具里了，操纵杆自己的大小回到 1
        this.handle.scale.set(1, 1, 1);
      }
      this.onDrag(active);
    });
    this.controls.addEventListener('objectChange', () => this.dragged());

    const snap = (e: KeyboardEvent) => {
      this.controls.setTranslationSnap(e.shiftKey ? SNAP_MOVE : null);
      this.controls.setRotationSnap(e.shiftKey ? SNAP_TURN : null);
    };
    window.addEventListener('keydown', snap);
    window.addEventListener('keyup', snap);
  }

  /** 正拖着，或者光标正指着操纵杆（这时候点一下不算点选别的东西） */
  get busy(): boolean {
    return this.controls.dragging || (Boolean(this.controls.object) && this.controls.axis !== null);
  }

  get dragging(): boolean {
    return this.controls.dragging;
  }

  setMode(mode: GizmoMode) {
    this.mode = mode;
    this.applyMode();
  }

  private applyMode() {
    this.controls.setMode(this.mode);
    // 移动沿场景的方向（上就是上）；旋转、缩放沿道具自己的轴
    this.controls.setSpace(this.mode === 'translate' ? 'world' : 'local');
  }

  /** 把操纵杆摆到选中的道具上；prop 为空就收起来。正在拖的时候操纵杆归鼠标管，不去动它 */
  sync(prop: SceneProp | null) {
    this.prop = prop;
    if (!prop) {
      if (this.controls.object) this.controls.detach();
      return;
    }
    if (!this.controls.dragging) {
      this.handle.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
      this.handle.rotation.set(prop.rot[0] * RAD, prop.rot[1] * RAD, prop.rot[2] * RAD);
      this.handle.scale.set(1, 1, 1);
      this.handle.updateMatrixWorld(true);
    }
    if (this.controls.object !== this.handle) this.controls.attach(this.handle);
  }

  /** 操纵杆被拖动了：换算成道具的数值 */
  private dragged() {
    if (!this.prop) return;
    const h = this.handle;
    if (this.mode === 'translate') {
      this.onChange({ pos: [h.position.x, h.position.y, h.position.z] });
    } else if (this.mode === 'rotate') {
      const e = new THREE.Euler().setFromQuaternion(h.quaternion, 'YXZ');
      this.onChange({ rot: [e.x / RAD, e.y / RAD, e.z / RAD] });
    } else if (this.startSize) {
      const s = this.startSize;
      this.onChange({ size: [s[0] * Math.abs(h.scale.x), s[1] * Math.abs(h.scale.y), s[2] * Math.abs(h.scale.z)] });
    }
  }
}
