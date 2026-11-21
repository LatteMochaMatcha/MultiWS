/**
 * 把 three 读出来的一棵物体（FBXLoader 给的那种）拼成 ImportSource（见 docs/import-plan.md 第 3 期）。
 * 和 readImportGlb 做的是同一件事：照每个物体的摆放把所有网格拼成一整块，材质、贴图一起取出来。
 * 纯函数：贴图的内容跟调用的人要（浏览器里才拿得到）。
 */
import { type BufferAttribute, type BufferGeometry, type Color, type InterleavedBufferAttribute, type Material, Matrix3, type Mesh, type Object3D, type Texture, Vector3 } from 'three';
import { t } from '../i18n';
import type { Vec3 } from '../model/spec';
import { IMPORT_MAX_TRIANGLES, type ImportSource, MIME_OK, missingTextureNote, smoothNormals, sniffImage } from './importMesh';
import type { RealMaterial, RealTexture } from './realFile';

type Attribute = BufferAttribute | InterleavedBufferAttribute;

/** 材质里工坊看的那几项（Phong、Lambert、Standard 都有其中一些） */
interface Looks {
  name?: string;
  color?: Color;
  map?: Texture | null;
  normalMap?: Texture | null;
  alphaMap?: Texture | null;
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  side?: number;
  vertexColors?: boolean;
}

/**
 * root 是读出来的那棵物体；bytesOf 给一张贴图的文件内容（拿不到返回 null）。
 * 读的时候丢掉、改掉的东西记进 notes
 */
export function sourceFromObject(root: Object3D, bytesOf: (texture: Texture) => Uint8Array | null, notes: Set<string>): ImportSource {
  root.updateWorldMatrix(true, true);
  const meshes: Mesh[] = [];
  let vertexTotal = 0;
  let faceTotal = 0;
  root.traverse((object) => {
    const mesh = object as Mesh;
    const position = mesh.geometry?.getAttribute?.('position');
    if (!mesh.isMesh) {
      if ((object as { isLine?: boolean }).isLine || (object as { isPoints?: boolean }).isPoints) notes.add(t('文件里的线、点没要，只要了面'));
      return;
    }
    if (!position?.count) return;
    meshes.push(mesh);
    vertexTotal += position.count;
    faceTotal += Math.floor((mesh.geometry.index?.count ?? position.count) / 3);
    if ((mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh) notes.add(t('这个文件带骨骼：照它现在的姿势当成不动的东西，动画没要'));
  });
  if (!faceTotal) throw new Error(t('这个文件里没有能用的网格'));
  if (faceTotal > IMPORT_MAX_TRIANGLES) throw new Error(t('这个文件有 {n} 万个面，太大了：在 Blender 里减面以后再导', { n: Math.round(faceTotal / 10000) }));

  /* ---- 贴图、材质：用到哪个取哪个 ---- */
  const textures: RealTexture[] = [];
  const textureAt = new Map<Texture, number | undefined>();
  const texture = (source: Texture | null | undefined): number | undefined => {
    if (!source) return undefined;
    if (textureAt.has(source)) return textureAt.get(source);
    const bytes = bytesOf(source);
    const mime = bytes ? sniffImage(bytes) : '';
    let at: number | undefined;
    if (bytes && MIME_OK.has(mime)) at = textures.push({ mime, bytes }) - 1;
    else notes.add(bytes ? t('有的贴图是工坊不认的格式，没带上') : missingTextureNote());
    if (at !== undefined && (source.repeat.x !== 1 || source.repeat.y !== 1 || source.offset.x !== 0 || source.offset.y !== 0)) notes.add(t('贴图的平铺、偏移没带上，花纹可能对不上'));
    textureAt.set(source, at);
    return at;
  };
  const materials: RealMaterial[] = [];
  const materialAt = new Map<Material | undefined, number>();
  const material = (source: Material | undefined): number => {
    let at = materialAt.get(source);
    if (at !== undefined) return at;
    const m = (source ?? {}) as Looks;
    const map = texture(m.map);
    const normal = texture(m.normalMap);
    if (m.transparent || (m.opacity ?? 1) < 0.999 || m.alphaMap) notes.add(t('透明、镂空的材质画成不透明的'));
    if (m.vertexColors) notes.add(t('刷在点上的颜色没带上'));
    // 有底色贴图时底色当成白的：文件里那个数多半是给没贴图时看的
    const color: [number, number, number] = map === undefined && m.color ? [m.color.r, m.color.g, m.color.b] : map === undefined ? [0.8, 0.8, 0.8] : [1, 1, 1];
    at = materials.length;
    materialAt.set(source, at);
    materials.push({
      name: String(m.name || `m${at}`).slice(0, 60),
      ...(map === undefined ? {} : { map }),
      ...(normal === undefined ? {} : { normal }),
      color,
      roughness: typeof m.roughness === 'number' ? Math.max(0, Math.min(1, m.roughness)) : 0.8,
      metalness: typeof m.metalness === 'number' ? Math.max(0, Math.min(1, m.metalness)) : 0,
      ...(m.side === 2 ? { doubleSided: true } : {}),
    });
    return at;
  };

  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const uvs = new Float32Array(vertexTotal * 2);
  const indices = new Uint32Array(faceTotal * 3);
  const faceMaterial = new Int32Array(faceTotal);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const p = new Vector3();
  const turn = new Matrix3();
  let vertexAt = 0;
  let faceAt = 0;
  for (const mesh of meshes) {
    const geometry: BufferGeometry = mesh.geometry;
    const position = geometry.getAttribute('position') as Attribute;
    const normal = geometry.getAttribute('normal') as Attribute | undefined;
    const uv = geometry.getAttribute('uv') as Attribute | undefined;
    const count = position.count;
    const base = vertexAt;
    const mirrored = mesh.matrixWorld.determinant() < 0;
    turn.getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const at = (base + i) * 3;
      const xyz: Vec3 = [p.x, p.y, p.z];
      for (let k = 0; k < 3; k++) {
        if (!Number.isFinite(xyz[k])) throw new Error(t('这个文件里的网格是坏的，读不了'));
        positions[at + k] = xyz[k];
        if (xyz[k] < min[k]) min[k] = xyz[k];
        if (xyz[k] > max[k]) max[k] = xyz[k];
      }
      if (uv) {
        // three 里贴图坐标左下角是原点，工坊照 glTF 的约定左上角是原点
        uvs[(base + i) * 2] = uv.getX(i);
        uvs[(base + i) * 2 + 1] = 1 - uv.getY(i);
      }
    }
    // 面：照材质分的组；镜像过的物体面的绕向反过来
    const corners = geometry.index?.count ?? count;
    const corner = (i: number) => (geometry.index ? geometry.index.getX(i) : i);
    const list = Array.isArray(mesh.material) ? mesh.material : null;
    const groups = list && geometry.groups.length ? geometry.groups : [{ start: 0, count: corners, materialIndex: 0 }];
    const firstFace = faceAt;
    const taken = new Uint8Array(Math.floor(corners / 3));
    for (const group of groups) {
      const at = material(list ? list[group.materialIndex ?? 0] : (mesh.material as Material));
      const end = Math.min(corners, group.start + group.count);
      for (let i = group.start - (group.start % 3); i + 2 < end; i += 3) {
        if (taken[i / 3]) continue;
        taken[i / 3] = 1;
        const [a, b, c] = [corner(i), corner(i + 1), corner(i + 2)];
        indices[faceAt * 3] = base + a;
        indices[faceAt * 3 + 1] = base + (mirrored ? c : b);
        indices[faceAt * 3 + 2] = base + (mirrored ? b : c);
        faceMaterial[faceAt++] = at;
      }
    }
    if (normal) {
      for (let i = 0; i < count; i++) {
        p.fromBufferAttribute(normal, i).applyMatrix3(turn);
        const l = p.length();
        const at = (base + i) * 3;
        normals[at] = l > 1e-12 ? p.x / l : 0;
        normals[at + 1] = l > 1e-12 ? p.y / l : 1;
        normals[at + 2] = l > 1e-12 ? p.z / l : 0;
      }
    } else {
      // 没带法线的现算（这一块自己的面）
      const own = Uint32Array.from(indices.subarray(firstFace * 3, faceAt * 3), (i) => i - base);
      normals.set(smoothNormals(positions.subarray(base * 3, (base + count) * 3), own), base * 3);
    }
    vertexAt += count;
  }
  return { positions, normals, uvs, indices: indices.subarray(0, faceAt * 3), faceMaterial: faceMaterial.subarray(0, faceAt), materials, textures, min, max, notes: [...notes] };
}
