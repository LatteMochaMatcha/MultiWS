/**
 * 3D 视口：渲染器、相机、灯光、地面阴影、视角按钮。不关心模型是怎么来的，只管显示。
 */
import { t } from '../i18n';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** side 是从角色的左手边看过去；right 是从右手边；top、bottom 是正上方、正下方（略偏一点，免得镜头转不动） */
export type ViewName = 'front' | 'side' | 'back' | 'three' | 'right' | 'top' | 'bottom';

const VIEW_DIR: Record<ViewName, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.08, 1).normalize(),
  side: new THREE.Vector3(1, 0.08, 0).normalize(),
  back: new THREE.Vector3(0, 0.08, -1).normalize(),
  three: new THREE.Vector3(0.62, 0.18, 1).normalize(),
  right: new THREE.Vector3(-1, 0.08, 0).normalize(),
  top: new THREE.Vector3(0, 1, 0.03).normalize(),
  bottom: new THREE.Vector3(0, -1, 0.03).normalize(),
};

/** 镜头的视角（竖直方向，度）和主灯的方向（绕着角色转多少度、抬多高），原样是这几个数 */
export const VIEW_DEFAULTS = { fov: 32, lightTurn: 35, lightLift: 47 } as const;
export const VIEW_LIMITS = { fov: [10, 80], lightTurn: [-180, 180], lightLift: [5, 90] } as const;

/** 镜头摆在哪、看着哪、视角多大：姿势文件里连它一起存 */
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(VIEW_DEFAULTS.fov, 1, 0.05, 200);
  readonly controls: OrbitControls;
  /** 只在屏幕上看的辅助物（选中高亮、操纵杆）：放在这一组里，截图时不会拍进去 */
  readonly overlay = new THREE.Group();
  /** 在模型之前另画一遍的东西（参考图）：不管远近都在模型后面，截图时不会拍进去 */
  readonly backdrop = new THREE.Scene();
  /** true 时 backdrop 改成盖在模型上面（选中高亮、操纵杆、圆点还在它上面） */
  backdropOnTop = false;
  /** 想看帧率的话接上这个：每半秒调用一次，参数是这半秒里每秒画了多少帧 */
  onFps: ((fps: number) => void) | null = null;
  private readonly key: THREE.DirectionalLight;
  private readonly ring: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  /** 主灯从哪边照过来（单位向量，从角色指向灯） */
  private readonly lightDir = new THREE.Vector3();
  private groundOn = true;
  private box = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.8, 0.5));
  /** 视口还没有尺寸时要求的观察方向，等有了尺寸再摆 */
  private pendingDir: THREE.Vector3 | null = null;

  constructor(private readonly stage: HTMLElement) {
    // preserveDrawingBuffer：截图时要能读回画面
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.prepend(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.4;
    // 视角调小（长焦）的时候镜头要退得很远才框得住
    this.controls.maxDistance = 60;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8a8e, 1.7));
    this.key = new THREE.DirectionalLight(0xffffff, 2.1);
    this.setLightDir(VIEW_DEFAULTS.lightTurn, VIEW_DEFAULTS.lightLift);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);
    const rim = new THREE.DirectionalLight(0xdbe8ff, 0.7);
    rim.position.set(-3, 2.5, -2.5);
    this.scene.add(rim);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.2 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // 地上一圈半径 1 m 的细线，给大小一个参照
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.995, 1.005, 128),
      new THREE.MeshBasicMaterial({ color: 0x6f8389, transparent: true, opacity: 0.45 }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.001;
    this.scene.add(this.ring, this.overlay);

    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    this.fitShadow();

    let frames = 0;
    let since = performance.now();
    const loop = () => {
      this.controls.update();
      this.draw();
      // 每半秒报一次帧率（有人听才算）
      frames++;
      const now = performance.now();
      if (now - since >= 500) {
        this.onFps?.((frames * 1000) / (now - since));
        frames = 0;
        since = now;
      }
      requestAnimationFrame(loop);
    };
    loop();
  }

  private resize() {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    this.renderer.setSize(w, h, false);
    if (!w || !h) return;
    const before = this.camera.aspect;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.pendingDir) {
      // 页面是在看不见的时候（宽高为 0）摆的镜头：现在有了真实的画面比例，重摆一次
      this.lookFrom(this.pendingDir);
    } else {
      // 画面变窄、变宽了（手机上放大视图、转屏，电脑上拉窗口）：镜头跟着退远、拉近，
      // 原来整个看得见的模型还是整个看得见，原来凑近看的还是凑近看
      const k = this.fitDistance(this.camera.aspect) / this.fitDistance(before);
      const offset = this.camera.position.clone().sub(this.controls.target);
      this.camera.position.copy(this.controls.target).addScaledVector(offset, k);
    }
    // 改大小会把画面清空：马上补画一帧，免得闪一下白
    this.draw();
  }

  /** 画一帧：有参考图的话先画它垫在后面（或者画完模型再盖上去），后几遍不清屏，叠在前一遍上 */
  private draw() {
    const r = this.renderer;
    if (!this.backdrop.children.some((c) => c.visible)) {
      r.render(this.scene, this.camera);
      return;
    }
    if (this.backdropOnTop) {
      this.overlay.visible = false;
      r.render(this.scene, this.camera);
      r.autoClear = false;
      r.render(this.backdrop, this.camera);
      this.overlay.visible = true;
      r.render(this.overlay, this.camera);
    } else {
      r.render(this.backdrop, this.camera);
      r.autoClear = false;
      r.render(this.scene, this.camera);
    }
    r.autoClear = true;
  }

  /** 让阴影相机正好罩住模型：范围越小，阴影越清晰 */
  private fitShadow() {
    const center = this.box.getCenter(new THREE.Vector3());
    const radius = this.box.getSize(new THREE.Vector3()).length() / 2 + 0.3;
    this.key.target.position.copy(center);
    this.key.position.copy(center).addScaledVector(this.lightDir, radius + 4);
    const cam = this.key.shadow.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = 0.5;
    cam.far = radius * 2 + 8;
    cam.updateProjectionMatrix();
  }

  /** 模型换了大小：跟着调整阴影范围。镜头不动，免得拖滑块时画面乱跳 */
  setBounds(box: THREE.Box3) {
    this.box.copy(box);
    this.fitShadow();
  }

  /** 画面的宽高比是 aspect 时，镜头离多远正好把整个模型框进去 */
  private fitDistance(aspect: number): number {
    const size = this.box.getSize(new THREE.Vector3());
    // 按竖直方向的视角来算；画面比模型窄时按宽度来算距离
    const half = Math.tan((this.camera.fov * Math.PI) / 360);
    const wide = Math.max(size.x, size.z);
    return Math.max(size.y / 2 / half, wide / 2 / (half * aspect)) * 1.12 + wide / 2;
  }

  /** 从 dir 方向看过去，让整个模型落在画面里 */
  private lookFrom(dir: THREE.Vector3) {
    this.pendingDir = this.stage.clientWidth && this.stage.clientHeight ? null : dir.clone();
    const center = this.box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, this.fitDistance(this.camera.aspect));
    this.controls.update();
  }

  /** 把镜头摆到指定视角 */
  frame(view: ViewName) {
    this.lookFrom(VIEW_DIR[view]);
  }

  private setLightDir(turn: number, lift: number) {
    const a = (turn * Math.PI) / 180;
    const e = (lift * Math.PI) / 180;
    this.lightDir.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  }

  /** 主灯的方向：turn 是绕着角色转多少度（0 是正前方，正数往角色的左手边转），lift 是抬多高（90 是正上方） */
  setLight(turn: number, lift: number) {
    this.setLightDir(turn, lift);
    this.fitShadow();
  }

  /**
   * 镜头的视角（度）：越大近大远小越夸张（广角），越小越平（长焦）。
   * 镜头同时退远、拉近，画面里的角色还是原来那么大。
   */
  setFov(fov: number) {
    const before = Math.tan((this.camera.fov * Math.PI) / 360);
    const after = Math.tan((fov * Math.PI) / 360);
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.controls.target).addScaledVector(offset, before / after);
    this.controls.update();
  }

  /** 地面上的影子和那一圈参照线，显示还是收起来 */
  setGround(on: boolean) {
    this.groundOn = on;
    this.ground.visible = this.ring.visible = on;
  }

  /** 镜头现在的样子 */
  cameraState(): CameraState {
    const p = this.camera.position;
    const t = this.controls.target;
    const r = (v: number) => Math.round(v * 1e4) / 1e4;
    return { position: [r(p.x), r(p.y), r(p.z)], target: [r(t.x), r(t.y), r(t.z)], fov: this.camera.fov };
  }

  /** 把镜头摆回存下来的样子 */
  setCamera(state: CameraState) {
    this.pendingDir = null;
    this.camera.fov = state.fov;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(state.target[0], state.target[1], state.target[2]);
    this.camera.position.set(state.position[0], state.position[1], state.position[2]);
    this.controls.update();
  }

  /** 保持现在的观察方向，重新把整个模型框进画面（换预设、载入配置后用） */
  refit() {
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.copy(VIEW_DIR.three);
    this.lookFrom(dir.normalize());
  }

  /** 当前画面的 PNG，背景透明，不带地上的参照圈、选中高亮和操纵杆 */
  snapshot(): Promise<Blob> {
    const canvas = this.renderer.domElement;
    if (!canvas.width || !canvas.height) return Promise.reject(new Error(t('3D 视图现在没有显示出来')));
    this.ring.visible = this.overlay.visible = false;
    this.renderer.render(this.scene, this.camera);
    this.ring.visible = this.groundOn;
    this.overlay.visible = true;
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t('浏览器没能生成图片')))), 'image/png');
    });
  }
}
