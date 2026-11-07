/**
 * 场景里别的角色在屏幕上的样子（见 docs/scene-plan.md）：每个是一组定住的网格，摆在它相对当前角色的位置上。
 * 当前角色永远站在原点（它自己的网格在 main.ts 的那几个模型里），这里只给它画一个底座圈。
 *
 * 底座圈：每个角色脚下一圈，前面一个小球指着它脸朝哪。拖圈挪位置，拖小球转方向（见 main.ts 的 wirePlacing）。
 * 定住的网格还没算出来时，先摆一个灰色的人影（切走那一刻屏幕上那张网格的复制，或者一根柱子）。
 */
import * as THREE from 'three';
import type { Place } from '../model/scene';
import type { FrozenView } from '../scene/bake';

const RAD = Math.PI / 180;
/** 还没算出来时的颜色 */
const GHOST = new THREE.MeshStandardMaterial({ color: 0x9aa7ab, roughness: 0.9, transparent: true, opacity: 0.55, name: 'Ghost' });
const RING = new THREE.MeshBasicMaterial({ color: 0x7f9196, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
const RING_ON = new THREE.MeshBasicMaterial({ color: 0x0d7883, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
const KNOB = new THREE.MeshBasicMaterial({ color: 0x7f9196, transparent: true, opacity: 0.9, depthWrite: false });
const KNOB_ON = new THREE.MeshBasicMaterial({ color: 0x0d7883, depthWrite: false });
/** 圈比角色从上往下看的半宽再宽多少（米）；最小多大 */
const RING_MARGIN = 0.08;
const RING_MIN = 0.28;
/** 圈有多宽（米）：太细了点不中 */
const RING_BAND = 0.05;

interface Entry {
  /** 摆在相对位置上的那一组 */
  group: THREE.Group;
  /** 网格放在这一组里（它的子节点） */
  body: THREE.Group;
  view: FrozenView | null;
  ghost: THREE.Object3D | null;
  ring: THREE.Mesh;
  knob: THREE.Mesh;
  /** 角色自己的坐标里的包围盒（米） */
  box: THREE.Box3;
  radius: number;
}

export type RingPart = 'ring' | 'knob';

export class SceneFigures {
  readonly root = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  /** 底座圈显不显示（场景里只有一个角色时不显示） */
  private ringsOn = false;
  private active: string | null = null;

  constructor() {
    this.root.name = 'SceneFigures';
  }

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      const group = new THREE.Group();
      group.name = `Figure_${id}`;
      const body = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.BufferGeometry(), RING);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.003;
      ring.renderOrder = 3;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 10), KNOB);
      knob.renderOrder = 4;
      group.add(body, ring, knob);
      this.root.add(group);
      e = { group, body, view: null, ghost: null, ring, knob, box: new THREE.Box3(), radius: 0 };
      this.entries.set(id, e);
      this.fitRing(e, RING_MIN);
    }
    return e;
  }

  private fitRing(e: Entry, radius: number) {
    const r = Math.max(RING_MIN, radius + RING_MARGIN);
    if (Math.abs(r - e.radius) < 1e-4) return;
    e.radius = r;
    e.ring.geometry.dispose();
    e.ring.geometry = new THREE.RingGeometry(r - RING_BAND / 2, r + RING_BAND / 2, 64);
    e.knob.position.set(0, 0.035, r + 0.06);
  }

  /** 从上往下看的半宽（米）：照包围盒 */
  private static radiusOf(box: THREE.Box3): number {
    if (box.isEmpty()) return 0;
    return Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** 换上算好的网格（旧的放掉）。box：角色自己的坐标里的包围盒 */
  setView(id: string, view: FrozenView, box: THREE.Box3) {
    const e = this.entry(id);
    this.dropView(e);
    this.dropGhost(e);
    e.view = view;
    view.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
    });
    e.body.add(view.root);
    e.box.copy(box);
    this.fitRing(e, SceneFigures.radiusOf(box));
  }

  /** 还没算出来：先摆一个灰色的人影。from：屏幕上那几张网格（复制一份，换成灰色）；没有就是一根柱子 */
  setGhost(id: string, from: readonly THREE.Object3D[], box: THREE.Box3) {
    const e = this.entry(id);
    this.dropGhost(e);
    const ghost = new THREE.Group();
    for (const root of from) {
      root.updateWorldMatrix(true, true);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.visible || !isShown(mesh)) return;
        const copy = new THREE.Mesh(mesh.geometry.clone(), GHOST);
        copy.applyMatrix4(mesh.matrixWorld);
        ghost.add(copy);
      });
    }
    if (!ghost.children.length) {
      const h = box.isEmpty() ? 1.6 : box.max.y;
      const pillar = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, Math.max(0.2, h - 0.36), 6, 16), GHOST);
      pillar.position.y = h / 2;
      ghost.add(pillar);
    }
    e.ghost = ghost;
    // 有了算好的网格就先藏着，新的算好了再换（不然是两个叠在一起）
    if (e.view) e.view.root.visible = false;
    e.body.add(ghost);
    if (!box.isEmpty()) e.box.copy(box);
    this.fitRing(e, SceneFigures.radiusOf(e.box));
  }

  /** 当前角色：不显示定住的网格（它自己的网格在别处），只留底座圈 */
  setActive(id: string) {
    this.active = id;
    for (const [other, o] of this.entries) o.body.visible = other !== id || this.holding;
    this.syncRings();
  }

  /**
   * 刚切过来、它自己的网格还没算出来：先接着显示定住的那份（在原点，也就是它自己的位置），
   * 算出来了再收起来（见 main.ts 的 holdLive）
   */
  private holding = false;
  holdActive(on: boolean) {
    this.holding = on;
    if (this.active) this.entry(this.active).body.visible = on;
  }

  /** 当前角色的包围盒变了（造型改了）：底座圈跟着变大变小 */
  setActiveBox(box: THREE.Box3) {
    if (!this.active) return;
    const e = this.entry(this.active);
    e.box.copy(box);
    this.fitRing(e, SceneFigures.radiusOf(box));
  }

  /** 摆到相对当前角色的位置 */
  place(id: string, rel: Place) {
    const e = this.entry(id);
    e.group.position.set(rel.x, 0, rel.z);
    e.group.rotation.set(0, rel.yaw * RAD, 0);
    e.group.updateMatrixWorld(true);
  }

  remove(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    this.dropView(e);
    this.dropGhost(e);
    e.ring.geometry.dispose();
    e.knob.geometry.dispose();
    this.root.remove(e.group);
    this.entries.delete(id);
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }

  private dropView(e: Entry) {
    if (!e.view) return;
    e.body.remove(e.view.root);
    e.view.dispose();
    e.view = null;
  }

  private dropGhost(e: Entry) {
    if (!e.ghost) return;
    e.body.remove(e.ghost);
    e.ghost.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    e.ghost = null;
    if (e.view) e.view.root.visible = true;
  }

  /** 是不是还在等算好的网格 */
  waiting(id: string): boolean {
    return Boolean(this.entries.get(id)?.ghost);
  }

  showRings(on: boolean) {
    this.ringsOn = on;
    this.syncRings();
  }

  private syncRings() {
    for (const [id, e] of this.entries) {
      e.ring.visible = e.knob.visible = this.ringsOn;
      const on = id === this.active;
      e.ring.material = on ? RING_ON : RING;
      e.knob.material = on ? KNOB_ON : KNOB;
    }
  }

  /** 别的角色（不算当前的）在场景里的包围盒，当前角色的坐标 */
  othersBox(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const [id, e] of this.entries) {
      if (id === this.active || e.box.isEmpty()) continue;
      box.union(e.box.clone().applyMatrix4(e.group.matrixWorld));
    }
    return box;
  }

  /** 某一个的包围盒（当前角色的坐标） */
  boxOf(id: string): THREE.Box3 {
    const e = this.entries.get(id);
    return e && !e.box.isEmpty() ? e.box.clone().applyMatrix4(e.group.matrixWorld) : new THREE.Box3();
  }

  /** 从上往下看占多大（米，圈的半径） */
  radiusOf(id: string): number {
    return this.entries.get(id)?.radius ?? RING_MIN;
  }

  /** 点中了哪个定住的角色（当前的不算），离镜头多远 */
  hitFigure(ray: THREE.Raycaster): { id: string; distance: number } | null {
    let best: { id: string; distance: number } | null = null;
    for (const [id, e] of this.entries) {
      if (id === this.active || !e.body.visible) continue;
      const hit = ray.intersectObject(e.body, true)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { id, distance: hit.distance };
    }
    return best;
  }

  /** 点中了哪个底座圈、圈前面的小球（显示着才算） */
  hitRing(ray: THREE.Raycaster): { id: string; part: RingPart; distance: number } | null {
    if (!this.ringsOn) return null;
    let best: { id: string; part: RingPart; distance: number } | null = null;
    for (const [id, e] of this.entries) {
      for (const [part, mesh] of [
        ['knob', e.knob],
        ['ring', e.ring],
      ] as const) {
        const hit = ray.intersectObject(mesh, false)[0];
        if (hit && (!best || hit.distance < best.distance - (part === 'knob' ? 0.05 : 0))) best = { id, part, distance: hit.distance };
      }
    }
    return best;
  }
}

/** 网格自己和所有上级都显示着 */
function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
