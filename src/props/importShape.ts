/**
 * 读 OBJ、STL（见 docs/import-plan.md 第 2、3 期）。纯函数，不碰浏览器。
 * 读出来的和 readImportGlb 是同一种东西（importMesh.ts 的 ImportSource），后面定大小朝向、转成素材文件是同一条路。
 *
 * OBJ 旁边的 .mtl 和贴图一起选上了就带上（底色、底色贴图、法线贴图）；没选上、STL 本来就没有的只有形状：
 * 导进来是一个颜色的，和基本体一样能挑颜色（plain）。
 */
import { t } from '../i18n';
import type { Vec3 } from '../model/spec';
import { IMPORT_MAX_TRIANGLES, type ImportFiles, type ImportSource, MIME_OK, missingTextureNote, readImportGlb, readImportGltf, sniffImage } from './importMesh';
import type { RealMaterial, RealTexture } from './realFile';

/** 一读就出结果的那几种（FBX 要另载一个库，见 importFbx.ts） */
export type ImportKind = 'glb' | 'gltf' | 'obj' | 'stl' | 'fbx';

/** 选文件的框认哪些（后缀和类型都写上：有的手机只看类型）。模型文件、装着它们的 zip，和它们要用到的 .bin、.mtl、贴图 */
export const IMPORT_ACCEPT =
  '.glb,.gltf,.obj,.stl,.fbx,.zip,.bin,.mtl,.png,.jpg,.jpeg,.webp,model/gltf-binary,model/gltf+json,model/obj,model/stl,application/zip,image/png,image/jpeg,image/webp';

/** 照文件名认是哪一种模型；不认的返回 null */
export function importKind(name: string): ImportKind | null {
  const m = /\.(glb|gltf|obj|stl|fbx)$/i.exec(name);
  return m ? (m[1].toLowerCase() as ImportKind) : null;
}

/** 读 GLB、.gltf、OBJ、STL。files 是模型文件外面的文件（.bin、.mtl、贴图）；只选了一个文件时不给 */
export function readImportFile(kind: Exclude<ImportKind, 'fbx'>, buffer: ArrayBuffer, files: ImportFiles | null = null): ImportSource {
  if (kind === 'obj') return readImportObj(buffer, files);
  if (kind === 'stl') return readImportStl(buffer);
  if (kind === 'gltf') return readImportGltf(buffer, files);
  return readImportGlb(buffer, files);
}

/** 没带法线的：两个面的朝向差在这个角度以内才算同一片光滑的面（再大就是棱） */
const CREASE = Math.cos((50 * Math.PI) / 180);

/**
 * 每个面的每个角的法线：取共用这个点、朝向和这个面差不到 CREASE 的那些面的平均（按面积加权）。
 * 这样箱子的棱还是棱，圆的东西还是圆的。points 是点（每三个数一个），faces 是每个面三个点的下标
 */
export function cornerNormals(points: ArrayLike<number>, faces: ArrayLike<number>): Float32Array {
  const count = Math.floor(faces.length / 3);
  const area = new Float32Array(count * 3);
  const unit = new Float32Array(count * 3);
  const uses = new Uint32Array(points.length / 3 + 1);
  for (let f = 0; f < count; f++) {
    const [a, b, c] = [faces[f * 3] * 3, faces[f * 3 + 1] * 3, faces[f * 3 + 2] * 3];
    const ux = points[b] - points[a];
    const uy = points[b + 1] - points[a + 1];
    const uz = points[b + 2] - points[a + 2];
    const vx = points[c] - points[a];
    const vy = points[c + 1] - points[a + 1];
    const vz = points[c + 2] - points[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(n[0], n[1], n[2]);
    for (let k = 0; k < 3; k++) {
      area[f * 3 + k] = n[k];
      unit[f * 3 + k] = l > 1e-20 ? n[k] / l : 0;
      uses[faces[f * 3 + k] + 1]++;
    }
  }
  // 每个点被哪些面用到：uses 先变成各点那一段从哪开始
  for (let i = 1; i < uses.length; i++) uses[i] += uses[i - 1];
  const fill = uses.slice(0, uses.length - 1);
  const around = new Uint32Array(count * 3);
  for (let f = 0; f < count; f++) for (let k = 0; k < 3; k++) around[fill[faces[f * 3 + k]]++] = f;
  const out = new Float32Array(count * 9);
  for (let f = 0; f < count; f++) {
    for (let k = 0; k < 3; k++) {
      const point = faces[f * 3 + k];
      let [x, y, z] = [0, 0, 0];
      for (let at = uses[point]; at < uses[point + 1]; at++) {
        const g = around[at];
        if (unit[f * 3] * unit[g * 3] + unit[f * 3 + 1] * unit[g * 3 + 1] + unit[f * 3 + 2] * unit[g * 3 + 2] < CREASE) continue;
        x += area[g * 3];
        y += area[g * 3 + 1];
        z += area[g * 3 + 2];
      }
      const l = Math.hypot(x, y, z);
      const to = f * 9 + k * 3;
      out[to] = l > 1e-20 ? x / l : 0;
      out[to + 1] = l > 1e-20 ? y / l : 1;
      out[to + 2] = l > 1e-20 ? z / l : 0;
    }
  }
  return out;
}

/** 只有形状的那一个材质：颜色和道具栏里低模家具的小图一样的灰，预览、小图里看得清形状 */
const PLAIN: RealMaterial = { name: 'plain', color: [0.584, 0.631, 0.651], roughness: 0.85, metalness: 0 };

interface Look {
  /** 每个面用第几个材质 */
  faceMaterial: Int32Array;
  materials: RealMaterial[];
  textures: RealTexture[];
}

/** 每个角一个点地装成 ImportSource（一样的点后面 buildImport 会合起来）。faces 是每个面三个点的下标；look 不给就是只有形状 */
function shapeSource(points: ArrayLike<number>, faces: ArrayLike<number>, normals: Float32Array, uvs: Float32Array | null, notes: string[], look: Look | null = null): ImportSource {
  const corners = faces.length;
  if (!corners) throw new Error(t('这个文件里没有能用的网格'));
  if (corners / 3 > IMPORT_MAX_TRIANGLES) throw new Error(t('这个文件有 {n} 万个面，太大了：在 Blender 里减面以后再导', { n: Math.round(corners / 30000) }));
  const positions = new Float32Array(corners * 3);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < corners; i++) {
    for (let k = 0; k < 3; k++) {
      const p = points[faces[i] * 3 + k];
      if (!Number.isFinite(p)) throw new Error(t('这个文件里的网格是坏的，读不了'));
      positions[i * 3 + k] = p;
      if (p < min[k]) min[k] = p;
      if (p > max[k]) max[k] = p;
    }
  }
  return {
    positions,
    normals,
    uvs: uvs ?? new Float32Array(corners * 2),
    indices: Uint32Array.from({ length: corners }, (_, i) => i),
    faceMaterial: look?.faceMaterial ?? new Int32Array(corners / 3),
    materials: look?.materials ?? [{ ...PLAIN }],
    textures: look?.textures ?? [],
    min,
    max,
    notes,
    ...(look ? {} : { plain: true }),
  };
}

/** .mtl 里的一个材质（只要工坊用得上的那几项） */
interface Mtl {
  /** 底色（文件里写的，sRGB） */
  kd?: [number, number, number];
  /** 底色贴图、法线贴图的文件名 */
  map?: string;
  normal?: string;
  roughness?: number;
  metalness?: number;
  /** 贴图带着平铺、偏移 */
  tiled?: boolean;
  /** 半透明 */
  clear?: boolean;
}

/** 贴图那一行里选项后面各跟着几个数（最多几个） */
const MAP_OPTION: Record<string, number> = { '-blendu': 1, '-blendv': 1, '-cc': 1, '-clamp': 1, '-boost': 1, '-bm': 1, '-imfchan': 1, '-texres': 1, '-type': 1, '-mm': 2, '-o': 3, '-s': 3, '-t': 3 };

/** 贴图那一行：去掉前面的选项，剩下的是文件名（可以带空格） */
function mapFile(parts: string[]): { file: string; tiled: boolean } {
  let at = 0;
  let tiled = false;
  while (at < parts.length && parts[at] in MAP_OPTION) {
    const option = parts[at];
    if (option === '-o' || option === '-s') tiled = true;
    let take = MAP_OPTION[option];
    at++;
    // -o、-s、-t 后面是 1–3 个数，不一定写满
    while (take > 0 && at < parts.length - 1 && (MAP_OPTION[option] === 1 || MAP_OPTION[option] === 2 || /^[-+]?[\d.]/.test(parts[at]))) {
      at++;
      take--;
    }
  }
  return { file: parts.slice(at).join(' '), tiled };
}

/** 读一份 .mtl：材质的名字 → 它的几项 */
export function readMtl(text: string): Map<string, Mtl> {
  const out = new Map<string, Mtl>();
  let now: Mtl | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const head = parts[0].toLowerCase();
    if (head === 'newmtl') {
      now = {};
      out.set(line.slice(6).trim(), now);
      continue;
    }
    if (!now) continue;
    const n = (i: number) => Number(parts[i]);
    if (head === 'kd' && Number.isFinite(n(1))) now.kd = [n(1), Number.isFinite(n(2)) ? n(2) : n(1), Number.isFinite(n(3)) ? n(3) : n(1)];
    else if (head === 'map_kd') {
      const { file, tiled } = mapFile(parts.slice(1));
      if (file) now.map = file;
      if (tiled) now.tiled = true;
    } else if (head === 'norm' || head === 'map_kn') {
      const { file } = mapFile(parts.slice(1));
      if (file) now.normal = file;
    } else if (head === 'pr' && Number.isFinite(n(1))) now.roughness = n(1);
    else if (head === 'pm' && Number.isFinite(n(1))) now.metalness = n(1);
    // Blender 写的高光指数：Ns = (1 - 粗糙度)² × 1000
    else if (head === 'ns' && Number.isFinite(n(1)) && now.roughness === undefined) now.roughness = 1 - Math.sqrt(Math.max(0, Math.min(1000, n(1))) / 1000);
    else if ((head === 'd' && n(1) < 0.999) || (head === 'tr' && n(1) > 0.001)) now.clear = true;
  }
  return out;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unit = (v: number) => Math.max(0, Math.min(1, v));

/** 读 OBJ：点、面、法线、贴图坐标；多边形的面照扇形拆成三角。files 里有它的 .mtl 就带上材质和贴图，没有就只有形状 */
export function readImportObj(buffer: ArrayBuffer, files: ImportFiles | null = null): ImportSource {
  const text = new TextDecoder().decode(buffer);
  const v: number[] = [];
  const vt: number[] = [];
  const vn: number[] = [];
  // 每个角：点、贴图坐标、法线各是第几个（没有的是 -1）
  const cv: number[] = [];
  const ct: number[] = [];
  const cn: number[] = [];
  // 每个面用的材质：names 里的下标（没写 usemtl 的是 -1）
  const faceName: number[] = [];
  const names: string[] = [];
  const libs: string[] = [];
  let using = -1;
  const notes = new Set<string>();
  const at = (ref: string | undefined, count: number): number => {
    if (!ref) return -1;
    const n = Number.parseInt(ref, 10);
    if (!Number.isFinite(n) || n === 0) return -1;
    const index = n > 0 ? n - 1 : count + n;
    return index >= 0 && index < count ? index : -1;
  };
  let from = 0;
  while (from < text.length) {
    let to = text.indexOf('\n', from);
    if (to < 0) to = text.length;
    const line = text.slice(from, to).trim();
    from = to + 1;
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    const head = parts[0];
    if (head === 'v') v.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    else if (head === 'vt') vt.push(Number(parts[1]), Number(parts[2] ?? 0));
    else if (head === 'vn') vn.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    else if (head === 'f') {
      const corner = parts.slice(1).map((ref) => {
        const [a, b, c] = ref.split('/');
        return [at(a, v.length / 3), at(b, vt.length / 2), at(c, vn.length / 3)];
      });
      if (corner.length < 3 || corner.some((c) => c[0] < 0)) continue;
      for (let i = 1; i + 1 < corner.length; i++) {
        for (const c of [corner[0], corner[i], corner[i + 1]]) {
          cv.push(c[0]);
          ct.push(c[1]);
          cn.push(c[2]);
        }
        faceName.push(using);
      }
    } else if (head === 'mtllib') libs.push(line.slice(6).trim());
    else if (head === 'usemtl') {
      const name = line.slice(6).trim();
      using = names.indexOf(name);
      if (using < 0) using = names.push(name) - 1;
    } else if (head === 'l' || head === 'p') notes.add(t('文件里的线、点没要，只要了面'));
  }
  if (!cv.length) throw new Error(t('这个文件里没有能用的网格'));

  /* ---- 材质：.mtl 一起选上了才有 ---- */
  let look: Look | null = null;
  const found = new Map<string, Mtl>();
  for (const lib of libs) {
    const bytes = files?.(lib);
    if (bytes) for (const [name, m] of readMtl(new TextDecoder().decode(bytes))) found.set(name, m);
  }
  if (found.size && names.some((name) => found.has(name))) {
    const textures: RealTexture[] = [];
    const textureAt = new Map<string, number | undefined>();
    const texture = (file: string | undefined): number | undefined => {
      if (!file) return undefined;
      if (textureAt.has(file)) return textureAt.get(file);
      const bytes = files?.(file) ?? null;
      const mime = bytes ? sniffImage(bytes) : '';
      let index: number | undefined;
      if (bytes && MIME_OK.has(mime)) index = textures.push({ mime, bytes }) - 1;
      else notes.add(bytes ? t('有的贴图是工坊不认的格式，没带上') : missingTextureNote());
      textureAt.set(file, index);
      return index;
    };
    const materials: RealMaterial[] = [];
    const materialAt = names.map((name) => {
      const m = found.get(name);
      if (!m) return -1;
      const map = texture(m.map);
      const normal = texture(m.normal);
      if (m.tiled) notes.add(t('贴图的平铺、偏移没带上，花纹可能对不上'));
      if (m.clear) notes.add(t('透明、镂空的材质画成不透明的'));
      // 有底色贴图时底色当成白的：.mtl 里那个数多半是给没贴图时看的
      const kd = map === undefined ? (m.kd ?? [0.8, 0.8, 0.8]) : [1, 1, 1];
      return (
        materials.push({
          name: name.slice(0, 60),
          ...(map === undefined ? {} : { map }),
          ...(normal === undefined ? {} : { normal }),
          color: [toLinear(unit(kd[0])), toLinear(unit(kd[1])), toLinear(unit(kd[2]))],
          roughness: unit(m.roughness ?? 0.8),
          metalness: unit(m.metalness ?? 0),
        }) - 1
      );
    });
    // 没写材质、.mtl 里找不到的那些面：一个灰的
    let spare = -1;
    const faceMaterial = Int32Array.from(faceName, (name) => {
      const index = name < 0 ? -1 : materialAt[name];
      if (index >= 0) return index;
      if (spare < 0) spare = materials.push({ ...PLAIN }) - 1;
      return spare;
    });
    look = { faceMaterial, materials, textures };
  } else if (libs.length || names.length) {
    notes.add(
      files
        ? t('OBJ 的材质文件（.mtl）没找到，只导了形状：放下来是一个颜色，能挑。要带上材质就把 .mtl 和贴图跟 .obj 一起选上')
        : t('OBJ 的材质和贴图没带上，只导了形状：放下来是一个颜色，能挑。要带上就把 .mtl 和贴图跟 .obj 一起选上，或者把整个文件夹拖进来'),
    );
  }

  const corners = cv.length;
  const computed = cn.some((n) => n < 0) ? cornerNormals(v, cv) : null;
  const normals = new Float32Array(corners * 3);
  const uvs = new Float32Array(corners * 2);
  for (let i = 0; i < corners; i++) {
    if (cn[i] >= 0) {
      const [x, y, z] = [vn[cn[i] * 3], vn[cn[i] * 3 + 1], vn[cn[i] * 3 + 2]];
      const l = Math.hypot(x, y, z);
      normals[i * 3] = l > 1e-12 ? x / l : 0;
      normals[i * 3 + 1] = l > 1e-12 ? y / l : 1;
      normals[i * 3 + 2] = l > 1e-12 ? z / l : 0;
    } else if (computed) normals.set(computed.subarray(i * 3, i * 3 + 3), i * 3);
    if (ct[i] >= 0) {
      // OBJ 的贴图坐标左下角是原点，工坊照 glTF 的约定左上角是原点
      uvs[i * 2] = vt[ct[i] * 2];
      uvs[i * 2 + 1] = 1 - vt[ct[i] * 2 + 1];
    }
  }
  return shapeSource(v, cv, normals, uvs, [...notes], look);
}

/**
 * 一样的点合成一个（STL 里每个面各带三个点，不合起来算不出哪里是光滑的）。
 * corners 是每个角的坐标（每三个数一个角）；返回合好的点和每个角是第几个点。
 * 照坐标的二进制原样比（几百万个角也不卡，不用拼字符串）
 */
export function weldPoints(corners: Float32Array): { points: Float32Array; ids: Uint32Array } {
  const count = Math.floor(corners.length / 3);
  const bits = new Uint32Array(corners.buffer, corners.byteOffset, count * 3);
  let slots = 16;
  while (slots < count * 2) slots *= 2;
  const table = new Int32Array(slots).fill(-1);
  const ids = new Uint32Array(count);
  const points = new Float32Array(count * 3);
  let made = 0;
  for (let i = 0; i < count; i++) {
    // -0 和 0 算一样的
    const [a, b, c] = [bits[i * 3] === 0x80000000 ? 0 : bits[i * 3], bits[i * 3 + 1] === 0x80000000 ? 0 : bits[i * 3 + 1], bits[i * 3 + 2] === 0x80000000 ? 0 : bits[i * 3 + 2]];
    let at = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & (slots - 1);
    for (;;) {
      const had = table[at];
      if (had < 0) {
        table[at] = made;
        points[made * 3] = corners[i * 3];
        points[made * 3 + 1] = corners[i * 3 + 1];
        points[made * 3 + 2] = corners[i * 3 + 2];
        ids[i] = made++;
        break;
      }
      if (points[had * 3] === corners[i * 3] && points[had * 3 + 1] === corners[i * 3 + 1] && points[had * 3 + 2] === corners[i * 3 + 2]) {
        ids[i] = had;
        break;
      }
      at = (at + 1) & (slots - 1);
    }
  }
  return { points: points.slice(0, made * 3), ids };
}

/** 读 STL（二进制的、文字的都认）：一样的点先合起来，法线照面的朝向现算（文件里那份常常是空的） */
export function readImportStl(buffer: ArrayBuffer): ImportSource {
  const view = new DataView(buffer);
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 256)));
  let corners: Float32Array;
  if (buffer.byteLength >= 84 && 84 + count * 50 === buffer.byteLength) {
    if (count > IMPORT_MAX_TRIANGLES) throw new Error(t('这个文件有 {n} 万个面，太大了：在 Blender 里减面以后再导', { n: Math.round(count / 10000) }));
    corners = new Float32Array(count * 9);
    for (let f = 0; f < count; f++) {
      const from = 84 + f * 50 + 12;
      for (let i = 0; i < 9; i++) corners[f * 9 + i] = view.getFloat32(from + i * 4, true);
    }
  } else if (/^\s*solid\b/.test(head)) {
    const text = new TextDecoder().decode(buffer);
    const numbers: number[] = [];
    const vertex = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    for (let m = vertex.exec(text); m; m = vertex.exec(text)) numbers.push(Number(m[1]), Number(m[2]), Number(m[3]));
    numbers.length -= numbers.length % 9;
    corners = Float32Array.from(numbers);
  } else throw new Error(t('这个 STL 文件是坏的（长度和里面写的面数对不上），读不了'));
  if (!corners.length) throw new Error(t('这个文件里没有能用的网格'));

  const { points, ids } = weldPoints(corners);
  // 三个角有两个是同一个点的面（一条线）不要
  const faces: number[] = [];
  for (let i = 0; i < ids.length; i += 3) {
    if (ids[i] !== ids[i + 1] && ids[i + 1] !== ids[i + 2] && ids[i] !== ids[i + 2]) faces.push(ids[i], ids[i + 1], ids[i + 2]);
  }
  return shapeSource(points, faces, cornerNormals(points, faces), null, []);
}
