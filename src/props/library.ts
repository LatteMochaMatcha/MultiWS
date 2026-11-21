/**
 * 道具素材的网格（清单见 catalog.ts）。
 *
 * - 低模家具：全部在一个文件 public/props/lowpoly.bin 里，一件接一件，
 *   每件依次是点（Float32 ×3）、法线（Int8 ×3，除以 127）、面（Uint16 ×3），各自补齐到 4 字节。
 * - 写实款：一件一个文件（排法见 realFile.ts），带贴图坐标、材质、贴图，面多的另带一份碰撞用的粗网格；
 *   文件从哪来（本机存的、下载站）见 realLoad.ts，这里只管读进来记着。
 * - 我的：用户自己导入的，文件和写实款是同一种，存在本机（见 userStore.ts）。
 *
 * 网格是原样的大小，原点在底面正中，正面朝 +Z。
 */
import type { PropShape } from '../geometry/propMesh';
import { t } from '../i18n';
import { fetchFile } from '../io/fetchFile';
import { PROP_ASSETS, PROP_ASSET_BYTES, realAsset } from './catalog';
import { type RealAssetFile, parseRealAsset } from './realFile';

export const PROP_ASSETS_URL = 'props/lowpoly.bin';

const shapes = new Map<string, PropShape>();
/** 写实款：碰撞用的粗网格（没有的就用 shapes 里那份）、材质和贴图 */
const touches = new Map<string, PropShape>();
const reals = new Map<string, RealAssetFile>();
let lowpolyReady = false;
const pad4 = (n: number) => (n + 3) & ~3;

/** 把 lowpoly.bin 拆成一件一件的网格记下来（测试里直接拿文件内容调） */
export function installPropAssets(buffer: ArrayBuffer): void {
  if (buffer.byteLength !== PROP_ASSET_BYTES) throw new Error(t('道具素材的文件大小不对'));
  for (const asset of PROP_ASSETS) {
    const n = asset.vertices;
    let at = asset.at;
    const positions = new Float32Array(buffer.slice(at, at + n * 12));
    at += n * 12;
    const packed = new Int8Array(buffer, at, n * 3);
    at += pad4(n * 3);
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [packed[i * 3], packed[i * 3 + 1], packed[i * 3 + 2]];
      const l = Math.hypot(x, y, z) || 1;
      normals[i * 3] = x / l;
      normals[i * 3 + 1] = y / l;
      normals[i * 3 + 2] = z / l;
    }
    const indices = Uint32Array.from(new Uint16Array(buffer.slice(at, at + asset.triangles * 6)));
    shapes.set(asset.id, { positions, normals, indices });
  }
  lowpolyReady = true;
}

/** 面的朝向照点的顺序现算（碰撞用的粗网格文件里不带法线） */
function faceNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const at of [a, b, c]) for (let k = 0; k < 3; k++) normals[at + k] += n[k];
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l;
    normals[i + 1] /= l;
    normals[i + 2] /= l;
  }
  return normals;
}

/**
 * 把一件写实款的文件读进来记下。不是清单里的那一件（编号、点数、面数对不上）就报错：
 * 清单换了新版以后，本机存的旧文件不认
 */
export function installRealAsset(id: string, buffer: ArrayBuffer): void {
  const entry = realAsset(id);
  const file = parseRealAsset(buffer);
  if (!entry || file.id !== id || file.positions.length / 3 !== entry.vertices || file.indices.length / 3 !== entry.triangles)
    throw new Error(t('道具素材的文件坏了'));
  shapes.set(id, { positions: file.positions, normals: file.normals, indices: file.indices, uvs: file.uvs, groups: file.groups });
  if (file.touch) touches.set(id, { positions: file.touch.positions, normals: faceNormals(file.touch.positions, file.touch.indices), indices: file.touch.indices });
  reals.set(id, file);
}

/** 把一件导入的素材读进来记下（编号对不上就报错）。同一个编号再来一次是换掉 */
export function installUserAsset(id: string, buffer: ArrayBuffer): void {
  const file = parseRealAsset(buffer);
  if (file.id !== id) throw new Error(t('道具素材的文件坏了'));
  shapes.set(id, { positions: file.positions, normals: file.normals, indices: file.indices, uvs: file.uvs, groups: file.groups });
  if (file.touch) touches.set(id, { positions: file.touch.positions, normals: faceNormals(file.touch.positions, file.touch.indices), indices: file.touch.indices });
  else touches.delete(id);
  reals.set(id, file);
}

/** 一件导入的素材从这里拿掉（删了它以后） */
export function dropUserAsset(id: string): void {
  shapes.delete(id);
  touches.delete(id);
  reals.delete(id);
}

/** 一件素材原样的网格；文件还没读进来时没有 */
export const propAssetShape = (id: string | undefined): PropShape | undefined => (id ? shapes.get(id) : undefined);

/** 碰撞用的网格：写实款面多的有一份粗的，别的就是它自己的网格 */
export const propTouchShape = (id: string | undefined): PropShape | undefined => (id ? (touches.get(id) ?? shapes.get(id)) : undefined);

/** 写实款、导入的素材的材质和贴图；没读进来、不是这两种都没有 */
export const realAssetFile = (id: string | undefined): RealAssetFile | undefined => (id ? reals.get(id) : undefined);

/** 低模家具的网格读进来了没有 */
export const propAssetsReady = (): boolean => lowpolyReady;

let loading: Promise<void> | null = null;

/** 读 lowpoly.bin（只读一次；读坏了下次再试） */
export function loadPropAssets(base: string): Promise<void> {
  if (propAssetsReady()) return Promise.resolve();
  loading ??= fetchFile(`${base}${PROP_ASSETS_URL}`, t('道具素材'))
    .then(installPropAssets)
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}
