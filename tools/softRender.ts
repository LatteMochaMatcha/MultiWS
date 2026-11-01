// 不开浏览器出图：把网格软光栅化成 PNG（正交投影、灰白色、一盏主光加一点轮廓光）。
// 验收台（tools/accept.ts）和离线试做法的工具用；工坊页面藏在后面时不重画，截不到图，所以另做了这个。
import { deflateSync } from 'node:zlib';

export type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** 看的方向：从哪边看过去（单位向量，从模型指向相机），朝上是 +Y */
export const VIEWS = {
  front: [0, 0, 1],
  side: [1, 0, 0],
  back: [0, 0, -1],
  rear: norm([0.68, 0.22, -0.7]),
  three: norm([0.6, 0.15, 0.78]),
} satisfies Record<string, V3>;
export type ViewName = keyof typeof VIEWS;

/** 一个视角的相机：屏幕右、上、往里三个方向 */
function camera(dir: V3) {
  const f: V3 = [-dir[0], -dir[1], -dir[2]];
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  return { f, r, u };
}

/**
 * 几个视角共用的取景：模型在这几个方向上投影出来的范围都放得下（留一点边），中心对齐包围盒中心。
 * 返回每米多少像素和中心；同一个组合的几张图用同一个取景，大小才对得上。
 * keep：只按这些顶点取景（特写），别的照样画，出了画面就裁掉
 */
export function frameFor(
  pos: ArrayLike<number>,
  views: readonly V3[],
  W: number,
  H: number,
  margin = 1.08,
  keep: (x: number, y: number, z: number) => boolean = () => true,
): { k: number; center: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    if (!keep(pos[i], pos[i + 1], pos[i + 2])) continue;
    for (let q = 0; q < 3; q++) {
      lo[q] = Math.min(lo[q], pos[i + q]);
      hi[q] = Math.max(hi[q], pos[i + q]);
    }
  }
  const center: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let k = Infinity;
  for (const dir of views) {
    const { r, u } = camera(dir);
    let w = 0;
    let h = 0;
    for (let i = 0; i < pos.length; i += 3) {
      if (!keep(pos[i], pos[i + 1], pos[i + 2])) continue;
      const p = sub([pos[i], pos[i + 1], pos[i + 2]], center);
      w = Math.max(w, Math.abs(dot(p, r)));
      h = Math.max(h, Math.abs(dot(p, u)));
    }
    k = Math.min(k, W / (2 * w * margin), H / (2 * h * margin));
  }
  return { k, center };
}

/**
 * 正交投影画一张图（先画两倍大再缩小，边上不起锯齿）。
 * pos 是米，idx 三个一组；返回 RGB
 */
export function render(pos: ArrayLike<number>, idx: ArrayLike<number>, dir: V3, frame: { k: number; center: V3 }, W: number, H: number): Uint8Array {
  const S = 2;
  const w2 = W * S;
  const h2 = H * S;
  const { f, r, u } = camera(dir);
  const k = frame.k * S;
  const n = pos.length / 3;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = sub([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], frame.center);
    sx[i] = w2 / 2 + dot(p, r) * k;
    sy[i] = h2 / 2 - dot(p, u) * k;
    sz[i] = dot(p, f);
  }
  const nrm = new Float32Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const pa: V3 = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
    const fn = cross(sub([pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], pa), sub([pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]], pa));
    for (const v of [a, b, c]) for (let q = 0; q < 3; q++) nrm[v * 3 + q] += fn[q];
  }
  // 主光从相机的左上前方打过来
  const light = norm([-f[0] * 0.65 - r[0] * 0.45 + u[0] * 0.6, -f[1] * 0.65 - r[1] * 0.45 + u[1] * 0.6, -f[2] * 0.65 - r[2] * 0.45 + u[2] * 0.6]);
  const shade = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const nn = norm([nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]);
    const lam = Math.max(0, dot(nn, light));
    const facing = Math.max(0, -dot(nn, f));
    shade[i] = 0.46 + 0.5 * lam + 0.1 * (1 - facing) * (1 - facing);
  }
  const zb = new Float32Array(w2 * h2).fill(Infinity);
  const big = new Float32Array(w2 * h2).fill(-1);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
    if (!area) continue;
    const x0 = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c])));
    const x1 = Math.min(w2 - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])));
    const y0 = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c])));
    const y1 = Math.min(h2 - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c])));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 = ((sx[b] - px) * (sy[c] - py) - (sx[c] - px) * (sy[b] - py)) / area;
        const w1 = ((sx[c] - px) * (sy[a] - py) - (sx[a] - px) * (sy[c] - py)) / area;
        const w3 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w3 < 0) continue;
        const z = w0 * sz[a] + w1 * sz[b] + w3 * sz[c];
        const o = y * w2 + x;
        if (z >= zb[o]) continue;
        zb[o] = z;
        big[o] = Math.min(1, w0 * shade[a] + w1 * shade[b] + w3 * shade[c]);
      }
    }
  }
  const img = new Uint8Array(W * H * 3);
  const BG = [246, 246, 247];
  const BODY = [214, 218, 224];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sum = [0, 0, 0];
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const s = big[(y * S + j) * w2 + x * S + i];
          for (let q = 0; q < 3; q++) sum[q] += s < 0 ? BG[q] : BODY[q] * s;
        }
      }
      for (let q = 0; q < 3; q++) img[(y * W + x) * 3 + q] = sum[q] / (S * S);
    }
  }
  return img;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** RGB 编成 PNG */
export function png(W: number, H: number, rgb: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    let c = -1;
    for (const b of body) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
    const crc = Buffer.alloc(4);
    crc.writeInt32BE(~c);
    return Buffer.concat([len, body, crc]);
  };
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
