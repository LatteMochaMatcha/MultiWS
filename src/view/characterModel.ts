/**
 * 成品角色在场景里的模型：带贴图的网格，一个材质一块。
 * 顶点已经是摆好的样子（见 character/assemble.ts），这里只管显示，不做蒙皮。
 */
import * as THREE from 'three';
import type { CharacterBuild } from '../character/assemble';
import { mergeByMaterial } from '../character/export';
import type { Chunk, SourceImage, SourceMaterial } from '../character/source';
import { CHARACTER_BLEND, type SkinSource } from './posedMeshes';

export interface CharacterStats {
  box: THREE.Box3;
  triangles: number;
}

/**
 * 包围盒直接扫顶点数组算（three 自带的那个一个顶点一个顶点地取，拖动时每一帧都要，慢好几倍）；
 * 包围球照包围盒取（比正好的大一点，视锥裁剪、点选用，不碍事），画的时候就不用再逐个顶点算一遍
 */
function bound(geometry: THREE.BufferGeometry, positions: Float32Array) {
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const box = (geometry.boundingBox ??= new THREE.Box3());
  box.min.set(x0, y0, z0);
  box.max.set(x1, y1, z1);
  geometry.boundingSphere = box.getBoundingSphere(geometry.boundingSphere ?? new THREE.Sphere());
}

export class CharacterModel {
  readonly root = new THREE.Group();
  /** 贴图跟着图片走，解过一次就留着：换发型时角色自己的那些贴图不用重新解。换了角色，旧角色的贴图就放掉（见 update） */
  private textures = new Map<SourceImage, THREE.Texture>();
  private materials = new Map<SourceMaterial, THREE.Material>();
  /** 屏幕上这几块网格和各自的蒙皮权重（摆姿势时用） */
  private sources: SkinSource[] = [];
  /** 屏幕上这几块网格是照哪几块数据做的（和 sources 一一对应；表情要查里面哪些顶点是脸上的） */
  private merged: Chunk[] = [];
  /** 屏幕上的是哪一副角色（同一副只是挪了部件时，原地换顶点，不重建网格：见 update） */
  private shown: CharacterBuild | null = null;

  constructor() {
    this.root.name = 'Character';
    this.root.visible = false;
  }

  /** 图片是文件里原样的 PNG 字节：交给浏览器解码，解好了贴图自己会更新 */
  private texture(image: SourceImage): THREE.Texture {
    let texture = this.textures.get(image);
    if (!texture) {
      const made = new THREE.Texture();
      // glTF 的贴图坐标以左上角为原点，不用上下翻
      made.flipY = false;
      made.colorSpace = THREE.SRGBColorSpace;
      made.wrapS = made.wrapT = THREE.RepeatWrapping;
      made.anisotropy = 4;
      const url = URL.createObjectURL(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mime }));
      const element = new Image();
      element.onload = () => {
        made.image = element;
        made.needsUpdate = true;
        URL.revokeObjectURL(url);
      };
      element.onerror = () => URL.revokeObjectURL(url);
      element.src = url;
      this.textures.set(image, made);
      texture = made;
    }
    return texture;
  }

  private material(m: SourceMaterial, images: SourceImage[]): THREE.Material {
    let made = this.materials.get(m);
    if (!made) {
      const side = m.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      if (m.image < 0) {
        // 没有贴图的是后加的单色部件（尾巴、翅膀、角、兽耳）：照常受灯光影响，不然看不出立体感
        const lit = new THREE.MeshStandardMaterial({ name: m.name, side, roughness: 0.8, metalness: 0 });
        lit.color.setRGB(m.color[0], m.color[1], m.color[2], THREE.LinearSRGBColorSpace);
        made = lit;
      } else {
        // 二次元角色的贴图本身就画好了明暗：不受场景灯光影响
        const flat = new THREE.MeshBasicMaterial({
          name: m.name,
          map: this.texture(images[m.image]),
          side,
          transparent: m.alpha === 'BLEND',
          // 半透明的那几层（眉毛、睫毛、高光、头发）不写深度，免得互相挡出硬边
          depthWrite: m.alpha !== 'BLEND',
          alphaTest: m.alpha === 'MASK' ? m.cutoff : 0,
          opacity: m.color[3],
        });
        flat.color.setRGB(m.color[0], m.color[1], m.color[2], THREE.LinearSRGBColorSpace);
        made = flat;
      }
      this.materials.set(m, made);
    }
    return made;
  }

  update(build: CharacterBuild): CharacterStats {
    // 拖操纵杆微调：还是那副拼好的角色，只有顶点挪了。每一帧都重建网格（拼、建、整个交给显卡）要好几毫秒
    if (this.sameBuild(build)) return this.refresh(build);
    this.shown = build;
    for (const child of [...this.root.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.root.remove(child);
    }
    let triangles = 0;
    const box = new THREE.Box3();
    const used = new Set<SourceMaterial>();
    this.sources = [];
    this.merged = mergeByMaterial(build);
    for (const chunk of this.merged) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(chunk.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
      bound(geometry, chunk.positions);
      box.union(geometry.boundingBox!);
      const source = build.materials[chunk.material];
      used.add(source);
      const mesh = new THREE.Mesh(geometry, this.material(source, build.images));
      mesh.name = chunk.name;
      mesh.castShadow = source.alpha !== 'BLEND';
      // 半透明的几层按固定的先后画：头发在前，脸上的眉毛、睫毛、高光在后
      if (source.alpha === 'BLEND') mesh.renderOrder = /HAIR/i.test(source.name) ? 1 : 2;
      this.root.add(mesh);
      this.sources.push({ geometry, joints: chunk.joints, weights: chunk.weights, unit: 1, blend: CHARACTER_BLEND });
      triangles += chunk.indices.length / 3;
    }
    // 这一回没用上的材质收掉（染发时每换一个颜色就多一份材质，不收会越攒越多）
    for (const [source, made] of this.materials) {
      if (used.has(source)) continue;
      made.dispose();
      this.materials.delete(source);
    }
    // 不属于现在这个角色（和她头上这副头发）的贴图也放掉：一个角色十几张大图，换几个角色不放的话显存就满了
    const kept = new Set(build.images);
    for (const [image, texture] of this.textures) {
      if (kept.has(image)) continue;
      texture.dispose();
      this.textures.delete(image);
    }
    return { box, triangles };
  }

  /** build 和屏幕上那副是同一副拼好的角色，只是顶点位置、法线不一样（微调挪了部件，见 character/tweak.ts） */
  private sameBuild(build: CharacterBuild): boolean {
    const shown = this.shown;
    if (!shown || shown.materials !== build.materials || shown.images !== build.images || shown.meshes.length !== build.meshes.length) return false;
    return build.meshes.every((chunk, i) => {
      const was = shown.meshes[i];
      return was.indices === chunk.indices && was.uvs === chunk.uvs && was.material === chunk.material && was.positions.length === chunk.positions.length;
    });
  }

  /** 原地换上新的顶点和法线：按材质并好的那几块，照 mergeByMaterial 的先后把各块抄过去 */
  private refresh(build: CharacterBuild): CharacterStats {
    const box = new THREE.Box3();
    let triangles = 0;
    this.merged.forEach((merged, i) => {
      let v = 0;
      for (const chunk of build.meshes) {
        if (chunk.material !== merged.material) continue;
        merged.positions.set(chunk.positions, v * 3);
        merged.normals.set(chunk.normals, v * 3);
        v += chunk.positions.length / 3;
      }
      const { geometry } = this.sources[i];
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('normal').needsUpdate = true;
      bound(geometry, merged.positions);
      box.union(geometry.boundingBox!);
      triangles += merged.indices.length / 3;
    });
    this.shown = build;
    return { box, triangles };
  }

  /** 屏幕上这几块网格和各自的蒙皮权重 */
  skinSources(): SkinSource[] {
    return this.sources;
  }

  /** 和 skinSources 一一对应的网格数据 */
  chunks(): Chunk[] {
    return this.merged;
  }
}
