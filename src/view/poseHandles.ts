/**
 * 摆姿势在 3D 视图里的那一半：关节上的圆点、拖圆点、点一下出现的旋转环。
 * 这里只负责把鼠标（手指）换算成「这个点要去哪」「这根骨骼多转了多少」，怎么解、怎么存交给外面。
 *
 * 圆点在屏幕上一样大（离得远也点得中），隔着身体也看得见；放在 overlay 里，截图不会拍进去。
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Quat, V3 } from '../geometry/vec';
import type { Handle, HandleKind } from '../pose/handles';
import type { Viewport } from './viewport';

/** 鼠标按下到松开挪了不超过这么多像素，才算「点了一下」 */
const CLICK_SLOP = 4;
const TAP_SLOP = 10;

type Look = 'reach' | 'bend' | 'aim' | 'picked' | 'pinned';
/** 每种圆点画成什么样：底色、边、形状、屏幕上的直径（像素） */
const LOOKS: Record<Look, { fill: string; edge: string; shape: 'dot' | 'diamond' | 'ring'; size: number }> = {
  reach: { fill: '#19a8b6', edge: '#ffffff', shape: 'dot', size: 17 },
  pinned: { fill: '#19a8b6', edge: '#10343a', shape: 'ring', size: 19 },
  bend: { fill: '#f2b63c', edge: '#4a3300', shape: 'diamond', size: 14 },
  aim: { fill: '#ffffff', edge: '#3d5057', shape: 'dot', size: 12 },
  picked: { fill: '#ff7a2e', edge: '#ffffff', shape: 'dot', size: 19 },
};
const lookOf = (kind: HandleKind): Look => (kind === 'bend' ? 'bend' : kind === 'aim' ? 'aim' : 'reach');

function drawLook(look: Look): THREE.Texture {
  const { fill, edge, shape } = LOOKS[look];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  g.fillStyle = fill;
  g.strokeStyle = edge;
  g.lineWidth = shape === 'ring' ? 10 : 6;
  g.beginPath();
  if (shape === 'diamond') {
    g.moveTo(32, 5);
    g.lineTo(59, 32);
    g.lineTo(32, 59);
    g.lineTo(5, 32);
    g.closePath();
  } else {
    g.arc(32, 32, shape === 'ring' ? 25 : 27, 0, Math.PI * 2);
  }
  g.fill();
  g.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Dot {
  handle: Handle;
  sprite: THREE.Sprite;
  look: Look;
}

export class PoseHandles {
  /** 按住了一个圆点，准备拖 */
  onGrab: (handle: Handle) => void = () => {};
  /** 拖着：这个点应该去 target（世界坐标，米） */
  onDrag: (handle: Handle, target: V3) => void = () => {};
  /** 松手。moved：是真的拖过，还是只点了一下 */
  onRelease: (handle: Handle, moved: boolean) => void = () => {};
  /** 点了一下：点中的圆点；点在空白处是 null */
  onPick: (handle: Handle | null) => void = () => {};
  /** 旋转环：开始转、转到了（相对开始时在世界里多转了多少）、松手 */
  onTurnStart: () => void = () => {};
  onTurn: (delta: Quat) => void = () => {};
  onTurnEnd: () => void = () => {};

  private readonly root = new THREE.Group();
  private readonly turner: TransformControls;
  /** 旋转环抓着的是这个看不见的物体 */
  private readonly grip = new THREE.Object3D();
  private readonly materials: Record<Look, THREE.SpriteMaterial>;
  private dots: Dot[] = [];
  private on = false;
  private coarse = window.matchMedia('(pointer: coarse)').matches;
  /** 旋转环开始转的时候朝哪 */
  private turnFrom: THREE.Quaternion | null = null;
  private down: { x: number; y: number; id: number; dot: Dot | null; moved: boolean; busy: boolean; plane: THREE.Plane; offset: THREE.Vector3 } | null = null;
  private readonly fingers = new Set<number>();
  private pinched = false;

  constructor(private readonly viewport: Viewport) {
    const dom = viewport.renderer.domElement;
    this.materials = Object.fromEntries(
      (Object.keys(LOOKS) as Look[]).map((look) => [
        look,
        new THREE.SpriteMaterial({ map: drawLook(look), sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true }),
      ]),
    ) as Record<Look, THREE.SpriteMaterial>;
    this.root.visible = false;

    this.turner = new TransformControls(viewport.camera, dom);
    this.turner.setMode('rotate');
    this.turner.setSpace('local');
    this.turner.setSize(this.coarse ? 0.95 : 0.6);
    this.turner.enabled = false;
    viewport.overlay.add(this.root, this.grip, this.turner.getHelper());

    this.turner.addEventListener('dragging-changed', (event) => {
      const active = event.value === true;
      viewport.controls.enabled = !active;
      if (active) {
        this.turnFrom = this.grip.quaternion.clone();
        this.onTurnStart();
      } else {
        this.turnFrom = null;
        this.onTurnEnd();
      }
    });
    this.turner.addEventListener('objectChange', () => {
      if (!this.turnFrom) return;
      const d = this.grip.quaternion.clone().multiply(this.turnFrom.clone().invert());
      this.onTurn([d.x, d.y, d.z, d.w]);
    });

    // 这几个监听排在旋转环自己的监听后面：按下时它已经知道鼠标是不是落在环上
    dom.addEventListener('pointerdown', (e) => {
      if (!this.on || e.button !== 0) return;
      if (e.isPrimary) {
        this.fingers.clear();
        this.pinched = false;
      }
      this.fingers.add(e.pointerId);
      if (this.fingers.size > 1) {
        // 第二根手指落下来：这是在缩放、平移，正拖着的圆点松开
        this.pinched = true;
        this.letGo();
        return;
      }
      const busy = this.turner.dragging || this.turner.axis !== null;
      const dot = busy ? null : this.dotAt(e);
      const plane = new THREE.Plane();
      const offset = new THREE.Vector3();
      if (dot) {
        // 拖的时候，圆点在「过它自己、正对着镜头」的那个平面上走
        plane.setFromNormalAndCoplanarPoint(viewport.camera.getWorldDirection(new THREE.Vector3()), dot.sprite.position);
        const at = this.rayOf(e).ray.intersectPlane(plane, new THREE.Vector3());
        if (at) offset.copy(dot.sprite.position).sub(at);
        viewport.controls.enabled = false;
        this.onGrab(dot.handle);
      }
      this.down = { x: e.clientX, y: e.clientY, id: e.pointerId, dot, moved: false, busy, plane, offset };
    });
    dom.addEventListener('pointermove', (e) => {
      const down = this.down;
      if (!this.on) return;
      if (!down) {
        // 鼠标移到圆点上：换成手的样子，提示这里能拖
        if (e.pointerType === 'mouse') dom.style.cursor = this.dotAt(e) ? 'grab' : '';
        return;
      }
      if (e.pointerId !== down.id) return;
      const slop = e.pointerType === 'mouse' ? CLICK_SLOP : TAP_SLOP;
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= slop) return;
      down.moved = true;
      if (!down.dot) return;
      const at = this.rayOf(e).ray.intersectPlane(down.plane, new THREE.Vector3());
      if (!at) return;
      at.add(down.offset);
      this.onDrag(down.dot.handle, [at.x, at.y, at.z]);
    });
    dom.addEventListener('pointerup', (e) => {
      this.fingers.delete(e.pointerId);
      const down = this.down;
      if (!down || e.pointerId !== down.id) return;
      this.down = null;
      if (down.dot) {
        viewport.controls.enabled = true;
        this.onRelease(down.dot.handle, down.moved);
        if (!down.moved) this.onPick(down.dot.handle);
      } else if (this.on && !down.moved && !down.busy && !this.pinched && e.button === 0) {
        this.onPick(null);
      }
    });
    dom.addEventListener('pointercancel', (e) => {
      this.fingers.delete(e.pointerId);
      this.letGo();
    });
  }

  /** 正拖着的圆点松开（当作拖到这里为止） */
  private letGo() {
    const down = this.down;
    this.down = null;
    if (!down?.dot) return;
    this.viewport.controls.enabled = true;
    this.onRelease(down.dot.handle, down.moved);
  }

  private rayOf(e: PointerEvent): THREE.Raycaster {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((e.clientY - rect.top) / rect.height) * 2),
      this.viewport.camera,
    );
    return ray;
  }

  /** 屏幕上这个位置按中了哪个圆点：离得最近、又在指头够得着的范围里的那个 */
  private dotAt(e: PointerEvent): Dot | null {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const reach = e.pointerType === 'mouse' ? 11 : 22;
    let best: Dot | null = null;
    let bestDist = Infinity;
    const p = new THREE.Vector3();
    for (const dot of this.dots) {
      if (!dot.sprite.visible) continue;
      p.copy(dot.sprite.position).project(this.viewport.camera);
      if (p.z < -1 || p.z > 1) continue;
      const x = rect.left + ((p.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - p.y) / 2) * rect.height;
      // 手、脚、胯的圆点大，优先；小的圆点要按得更准才算
      const d = Math.hypot(e.clientX - x, e.clientY - y) + (dot.handle.kind === 'aim' ? 3 : 0);
      if (d < reach + LOOKS[dot.look].size / 2 && d < bestDist) {
        best = dot;
        bestDist = d;
      }
    }
    return best;
  }

  /** 摆姿势模式开着没有：关着的时候圆点和旋转环都收起来，鼠标也不接 */
  set enabled(on: boolean) {
    this.on = on;
    this.root.visible = on;
    if (!on) {
      this.letGo();
      this.ring(null);
      this.viewport.renderer.domElement.style.cursor = '';
    }
  }

  /** 正拖着圆点，或者正转着旋转环 */
  get busy(): boolean {
    return Boolean(this.down?.dot) || this.turner.dragging;
  }

  /** 换一批圆点 */
  setHandles(handles: readonly Handle[]) {
    this.root.clear();
    this.dots = handles.map((handle) => {
      const look = lookOf(handle.kind);
      const sprite = new THREE.Sprite(this.materials[look]);
      sprite.renderOrder = handle.kind === 'aim' ? 8 : 9;
      this.root.add(sprite);
      return { handle, sprite, look };
    });
  }

  /** 各个圆点现在在哪（和 setHandles 给的顺序一样）；visible：哪些圆点亮出来 */
  place(positions: readonly V3[], visible: (handle: Handle) => boolean) {
    this.dots.forEach((dot, i) => {
      const p = positions[i];
      dot.sprite.position.set(p[0], p[1], p[2]);
      dot.sprite.visible = visible(dot.handle);
    });
    this.resize();
  }

  /** 选中的、钉住的圆点换个样子 */
  mark(picked: string | null, pinned: (handle: Handle) => boolean) {
    for (const dot of this.dots) {
      dot.look = dot.handle.id === picked ? 'picked' : dot.handle.kind === 'reach' && pinned(dot.handle) ? 'pinned' : lookOf(dot.handle.kind);
      dot.sprite.material = this.materials[dot.look];
    }
    this.resize();
  }

  /** 圆点在屏幕上保持固定的像素大小 */
  private resize() {
    const height = this.viewport.renderer.domElement.clientHeight;
    if (!height) return;
    const perPixel = (2 * Math.tan((this.viewport.camera.fov * Math.PI) / 360)) / height;
    const grow = this.coarse ? 1.35 : 1;
    for (const dot of this.dots) dot.sprite.scale.setScalar(LOOKS[dot.look].size * grow * perPixel);
  }

  /** 旋转环放在哪、朝哪（绿色那一圈绕着骨头自己转）；null 是收起来。正转着的时候不去动它 */
  ring(at: { pos: V3; quat: Quat } | null) {
    if (this.turner.dragging) return;
    if (!at || !this.on) {
      if (this.turner.object) this.turner.detach();
      this.turner.enabled = false;
      return;
    }
    this.grip.position.set(at.pos[0], at.pos[1], at.pos[2]);
    this.grip.quaternion.set(at.quat[0], at.quat[1], at.quat[2], at.quat[3]);
    this.grip.updateMatrixWorld(true);
    this.turner.enabled = true;
    if (this.turner.object !== this.grip) this.turner.attach(this.grip);
  }
}
