/**
 * 参考图：用户自己的正面、侧面设定图，竖着垫在模型后面（像 Blender 的「参考图像」），对着它调体型。
 *
 * 两张图各是一片竖着的面，都过角色的中线：正面图在 XY 平面上、朝前，侧面图在 YZ 平面上、朝左手边
 * （从「左侧」看是正着的，画里的人脸朝屏幕左边）。它们画在模型之前的另一遍里（Viewport.backdrop），
 * 不管远近总在模型后面，也可以改成盖在模型上面；截图里没有它们。
 * 镜头转开就淡掉：正面图只在从正面、背面看时看得见，侧面图只在从左右看时看得见，斜着看是半透明的。
 */
import { t } from '../i18n';
import * as THREE from 'three';

export type RefSlot = 'front' | 'side';
export const REF_SLOTS: readonly RefSlot[] = ['front', 'side'];

/** 一张参考图怎么摆。长度都是米 */
export interface RefPlacement {
  /** 画里的人（图里去掉四周空白的那一块）有多高 */
  height: number;
  /** 画里的人脚底离地多高，往上为正 */
  up: number;
  /** 画里的人的中线往屏幕右边挪多少（从图正着的那一边看） */
  shift: number;
  /** 0–1 */
  opacity: number;
  /** 左右翻转 */
  flip: boolean;
}

/** 图里画着东西的那一块，按整张图的比例算（0–1，原点在左上角） */
export interface ContentBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const WHOLE: ContentBox = { left: 0, top: 0, right: 1, bottom: 1 };

type Pixels = { data: ArrayLike<number>; width: number; height: number };
/** 图的底：透明底；一种颜色的纸（白纸、灰底）；或者花的（照片、画了背景），那就没法分出哪里是画的 */
export type Paper = 'clear' | [number, number, number] | null;

const diff = (data: ArrayLike<number>, i: number, c: readonly number[]) =>
  Math.abs(data[i] - c[0]) + Math.abs(data[i + 1] - c[1]) + Math.abs(data[i + 2] - c[2]);

/** 看图的四条边：四分之一以上透明是透明底；八成以上和中间色差不多是一种颜色的纸；不然是花的 */
export function paperOf(image: Pixels): Paper {
  const { data, width: w, height: h } = image;
  if (w < 3 || h < 3) return null;
  const edge: number[] = [];
  for (let x = 0; x < w; x++) edge.push(x * 4, ((h - 1) * w + x) * 4);
  for (let y = 1; y < h - 1; y++) edge.push(y * w * 4, (y * w + w - 1) * 4);
  if (edge.filter((i) => data[i + 3] < 250).length > edge.length / 4) return 'clear';
  const median = (c: number) => {
    const v = edge.map((i) => data[i + c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const paper: [number, number, number] = [median(0), median(1), median(2)];
  return edge.filter((i) => diff(data, i, paper) <= 30).length >= edge.length * 0.8 ? paper : null;
}

/** 和纸色差多少以内算纸（压缩的噪点、纸的纹理），差多少以上算画上去的；中间是线条边上的半透明 */
const INK = [24, 60] as const;

/**
 * 找图里画的那个人：先把画着东西的地方分成一团一团（隔着两个像素以内也算连着，线稿上断开的笔画），
 * 最高的那一团是人；和它的框挨着、叠着的几团（分开画的头发、饰品、腿）也算进来。
 * 旁边离得远的字、签名、别的小图不算，零星的脏点也不算。底是花的、或者什么都没找到，就是整张图。
 */
export function findContent(image: Pixels, paper: Paper = paperOf(image)): ContentBox {
  const { data, width: w, height: h } = image;
  if (!paper) return WHOLE;
  const ink = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (data[i + 3] > 40 && (paper === 'clear' || diff(data, i, paper) > INK[1])) ink[p] = 1;
  }
  // 一团一团地数：从一个点出发，把周围 5×5 里画着的点都算进来
  const seen = new Uint8Array(w * h);
  const blobs: { x0: number; y0: number; x1: number; y1: number; count: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || seen[start]) continue;
    const blob = { x0: w, y0: h, x1: -1, y1: -1, count: 0 };
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      blob.count++;
      blob.x0 = Math.min(blob.x0, x);
      blob.x1 = Math.max(blob.x1, x);
      blob.y0 = Math.min(blob.y0, y);
      blob.y1 = Math.max(blob.y1, y);
      for (let ny = Math.max(0, y - 2); ny <= Math.min(h - 1, y + 2); ny++) {
        for (let nx = Math.max(0, x - 2); nx <= Math.min(w - 1, x + 2); nx++) {
          const q = ny * w + nx;
          if (ink[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (blob.count >= 3) blobs.push(blob);
  }
  if (!blobs.length) return WHOLE;
  const pick = { ...blobs.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 || (b.y1 - b.y0 === a.y1 - a.y0 && b.count > a.count) ? b : a)) };
  // 框外这么多以内的也算挨着（图长边的 2%）
  const gap = Math.max(2, Math.round(Math.max(w, h) * 0.02));
  const left = new Set(blobs);
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of left) {
      if (b.x0 > pick.x1 + gap || b.x1 < pick.x0 - gap || b.y0 > pick.y1 + gap || b.y1 < pick.y0 - gap) continue;
      pick.x0 = Math.min(pick.x0, b.x0);
      pick.x1 = Math.max(pick.x1, b.x1);
      pick.y0 = Math.min(pick.y0, b.y0);
      pick.y1 = Math.max(pick.y1, b.y1);
      left.delete(b);
      grew = true;
    }
  }
  return { left: pick.x0 / w, top: pick.y0 / h, right: (pick.x1 + 1) / w, bottom: (pick.y1 + 1) / h };
}

/** 把一种颜色的纸抠成透明，只留画上去的；线条边上和纸色差得不多的地方半透明 */
export function keyOut(data: Uint8ClampedArray, paper: readonly number[]) {
  for (let i = 0; i < data.length; i += 4) {
    const k = (diff(data, i, paper) - INK[0]) / (INK[1] - INK[0]);
    if (k < 1) data[i + 3] = Math.round(data[i + 3] * Math.max(0, k));
  }
}

/**
 * 那片面摆在哪、多大（米）：across 是面的中心在它自己的横轴上（从图正着的那一边看往右为正），
 * up 是面的中心多高；width 为负是左右翻转。aspect 是整张图的宽比高。
 */
export function planeLayout(aspect: number, box: ContentBox, p: RefPlacement) {
  const tall = p.height / Math.max(box.bottom - box.top, 1e-3);
  const wide = tall * aspect;
  // 画着东西的那一块的中线，在翻转以后的图上在哪
  const mid = (box.left + box.right) / 2;
  const seen = p.flip ? 1 - mid : mid;
  return {
    width: p.flip ? -wide : wide,
    height: tall,
    across: p.shift - (seen - 0.5) * wide,
    up: p.up + (box.bottom - 0.5) * tall,
  };
}

/** 图最长的一边缩到这么多像素以内：手机的显卡也吃得下，占的显存也少 */
const MAX_SIDE = 2048;
/** 找画着东西的那一块时，先缩到这么小再看 */
const PROBE_SIDE = 256;

export interface RefPicture {
  canvas: HTMLCanvasElement;
  box: ContentBox;
}

/**
 * 把用户选的图片文件读成一张画布，找出画里的人；纸是一种颜色的话抠成透明，垫在后面只看得到画的线和色块。
 * 读不了（格式不认、文件坏了）就抛错
 */
export async function loadPicture(bytes: ArrayBuffer): Promise<RefPicture> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const draw = (side: number) => {
      const k = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * k));
      canvas.height = Math.max(1, Math.round(bitmap.height * k));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error(t('浏览器没能准备画布'));
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return { canvas, ctx };
    };
    const probe = draw(PROBE_SIDE);
    const small = probe.ctx.getImageData(0, 0, probe.canvas.width, probe.canvas.height);
    const paper = paperOf(small);
    const box = findContent(small, paper);
    const full = draw(MAX_SIDE);
    if (paper && paper !== 'clear') {
      const pixels = full.ctx.getImageData(0, 0, full.canvas.width, full.canvas.height);
      keyOut(pixels.data, paper);
      full.ctx.putImageData(pixels, 0, 0);
    }
    return { canvas: full.canvas, box };
  } finally {
    bitmap.close();
  }
}

/** 视线和图的法线夹角小于 20° 时全显示，大于 45° 时看不见，中间渐渐淡掉 */
const FADE = [Math.cos((45 * Math.PI) / 180), Math.cos((20 * Math.PI) / 180)] as const;
const NORMAL: Record<RefSlot, THREE.Vector3> = { front: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0) };

interface Slot {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  picture: RefPicture | null;
  /** 用户设的不透明度；实际的还要乘上转开以后淡掉的那一点 */
  opacity: number;
}

export class ReferenceImages {
  /** 加到 Viewport.backdrop 里。没有一张显示着的时候它是隐藏的，视口就少画一遍 */
  readonly root = new THREE.Group();
  private readonly slots = {} as Record<RefSlot, Slot>;

  constructor() {
    const plane = new THREE.PlaneGeometry(1, 1);
    const look = new THREE.Vector3();
    for (const slot of REF_SLOTS) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(plane, material);
      // 侧面图转到朝左手边：图的横轴朝角色背后，从左边看过去是正着的
      if (slot === 'side') mesh.rotation.y = Math.PI / 2;
      mesh.visible = false;
      const entry: Slot = { mesh, picture: null, opacity: 1 };
      mesh.onBeforeRender = (_renderer, _scene, camera) => {
        camera.getWorldDirection(look);
        material.opacity = entry.opacity * THREE.MathUtils.smoothstep(Math.abs(look.dot(NORMAL[slot])), FADE[0], FADE[1]);
      };
      this.slots[slot] = entry;
      this.root.add(mesh);
    }
    this.root.visible = false;
  }

  /** 换图（null 是去掉） */
  setImage(slot: RefSlot, picture: RefPicture | null) {
    const s = this.slots[slot];
    s.mesh.material.map?.dispose();
    s.picture = picture;
    if (picture) {
      const texture = new THREE.CanvasTexture(picture.canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      s.mesh.material.map = texture;
    } else {
      s.mesh.material.map = null;
      s.mesh.visible = false;
    }
    s.mesh.material.needsUpdate = true;
    this.syncRoot();
  }

  /** 摆一张图；placement 为 null 或者 show 为 false 时不显示 */
  place(slot: RefSlot, placement: RefPlacement | null, show: boolean) {
    const s = this.slots[slot];
    s.mesh.visible = !!(s.picture && placement && show);
    if (s.picture && placement) {
      const { canvas, box } = s.picture;
      const at = planeLayout(canvas.width / canvas.height, box, placement);
      s.mesh.scale.set(at.width, at.height, 1);
      // 正面图的横轴是 +X；侧面图转过 90° 以后横轴是 -Z
      if (slot === 'front') s.mesh.position.set(at.across, at.up, 0);
      else s.mesh.position.set(0, at.up, -at.across);
      s.opacity = placement.opacity;
    }
    this.syncRoot();
  }

  private syncRoot() {
    this.root.visible = REF_SLOTS.some((slot) => this.slots[slot].mesh.visible);
  }
}
