/**
 * 场景里的道具在屏幕上的样子（见 model/props.ts、docs/props-plan.md）。
 *
 * 道具存的是场景里的位置；屏幕上当前角色永远站在原点，所以这一整组照「当前角色站在哪」反着摆（setOrigin），
 * 组里面每件道具就照它在场景里的位置、旋转放。
 */
import * as THREE from 'three';
import { shapeOf } from '../geometry/propMesh';
import type { SceneProp } from '../model/props';
import type { Place } from '../model/scene';
import { propAssetShape, realAssetFile } from '../props/library';
import type { RealAssetFile, RealTexture } from '../props/realFile';
import { srgbTexture } from './oldEngine';

const RAD = Math.PI / 180;
/** 选中的那一件罩的颜色（和选中部件时一样） */
const PICKED = 0x19a8b6;

interface Entry {
  mesh: THREE.Mesh;
  /** 一个颜色的材质：基本体、低模家具、刷成灰色的写实款用 */
  material: THREE.MeshStandardMaterial;
  /** 网格是照哪种、多大算的：变了才重算 */
  shape: string;
}

export class PropsModel {
  readonly root = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  /** 写实款带贴图的材质：照素材的编号记着，同一件摆几份也只做一套 */
  private readonly skins = new Map<string, THREE.Material[]>();
  /** 选中的那一件罩上一层半透明的颜色，隔着身体、隔着别的道具也看得见 */
  private readonly glow = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: PICKED, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false }),
  );

  constructor() {
    this.root.name = 'SceneProps';
    this.glow.name = 'PropGlow';
    this.glow.renderOrder = 5;
    this.glow.rotation.order = 'YXZ';
    this.glow.visible = false;
    this.root.add(this.glow);
  }

  /** 贴图是文件里原样的 JPG / PNG 字节：交给浏览器解码，解好了贴图自己会更新。color：是不是颜色（底色贴图是，法线、粗糙度不是） */
  private texture(image: RealTexture, color: boolean): THREE.Texture {
    const made = new THREE.Texture();
    // 贴图坐标照 glTF 的约定以左上角为原点，不用上下翻
    made.flipY = false;
    if (color) srgbTexture(made);
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
    return made;
  }

  /** 一件写实款带贴图的那套材质（每批面一个） */
  private skin(id: string, file: RealAssetFile): THREE.Material[] {
    let made = this.skins.get(id);
    if (!made) {
      const textures = new Map<number, THREE.Texture>();
      const texture = (index: number | undefined, color: boolean) => {
        if (index === undefined) return null;
        let found = textures.get(index);
        if (!found) textures.set(index, (found = this.texture(file.textures[index], color)));
        return found;
      };
      made = file.materials.map((m) => {
        const arm = texture(m.arm, false);
        const material = new THREE.MeshStandardMaterial({
          name: `PropSkin_${id}_${m.name}`,
          map: texture(m.map, true),
          normalMap: texture(m.normal, false),
          roughnessMap: arm,
          aoMap: m.ao ? arm : null,
          roughness: m.roughness,
          // 视图里没有环境可反射，金属照实算会是一片黑：当成不反光的来画（导出的文件里也只带底色贴图）
          metalness: 0,
          side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        });
        material.color.setRGB(m.color[0], m.color[1], m.color[2], THREE.LinearSRGBColorSpace);
        // 法线贴图的绿色朝上、贴图坐标左上角是原点：照 three.js 读 glTF 时的做法把竖的那一向反过来
        material.normalScale.set(1, -1);
        return material;
      });
      this.skins.set(id, made);
    }
    return made;
  }

  /** 当前角色在场景里站在哪：整组反着摆，道具就落在相对它的位置上 */
  setOrigin(here: Place) {
    const m = new THREE.Matrix4().makeRotationY(here.yaw * RAD).setPosition(here.x, here.y ?? 0, here.z).invert();
    m.decompose(this.root.position, this.root.quaternion, this.root.scale);
    this.root.updateMatrixWorld(true);
  }

  /** 照清单摆：新的加上、没了的放掉、改了尺寸的重算网格。selected：选中的那一件泛一层颜色 */
  sync(props: readonly SceneProp[], selected: string | null) {
    const alive = new Set(props.map((p) => p.id));
    for (const [id, e] of this.entries) {
      if (alive.has(id)) continue;
      this.root.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.material.dispose();
      this.entries.delete(id);
    }
    for (const prop of props) {
      let e = this.entries.get(prop.id);
      if (!e) {
        const material = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, name: `Prop_${prop.id}` });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        mesh.name = `Prop_${prop.id}`;
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.rotation.order = 'YXZ';
        this.root.add(mesh);
        e = { mesh, material, shape: '' };
        this.entries.set(prop.id, e);
      }
      // 素材的文件读进来以前是个方块顶着：读进来以后要重算
      const shape = `${prop.kind}:${prop.asset ?? ''}:${prop.size.join(',')}:${prop.kind === 'asset' && Boolean(propAssetShape(prop.asset))}`;
      if (shape !== e.shape) {
        const s = shapeOf(prop);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(s.positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(s.normals, 3));
        geometry.setIndex(new THREE.BufferAttribute(s.indices, 1));
        if (s.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(s.uvs, 2));
        // 分批只在带贴图时有用：一个颜色的材质不是数组，整块一起画
        for (const g of s.groups ?? []) geometry.addGroup(g.start, g.count, g.material);
        e.mesh.geometry.dispose();
        e.mesh.geometry = geometry;
        e.shape = shape;
      }
      e.mesh.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
      e.mesh.rotation.set(prop.rot[0] * RAD, prop.rot[1] * RAD, prop.rot[2] * RAD);
      e.material.color.set(prop.color);
      // 写实款读进来了、没刷灰：用它自己带贴图的材质
      const file = prop.kind === 'asset' && !prop.gray ? realAssetFile(prop.asset) : undefined;
      e.mesh.material = file && prop.asset ? this.skin(prop.asset, file) : e.material;
    }
    // 高亮和选中的那一件共用一份网格（不归它管，放掉网格是道具自己的事）
    const picked = selected ? this.entries.get(selected) : undefined;
    this.glow.visible = Boolean(picked);
    if (picked) {
      this.glow.geometry = picked.mesh.geometry;
      this.glow.position.copy(picked.mesh.position);
      this.glow.rotation.copy(picked.mesh.rotation);
    }
    this.root.updateMatrixWorld(true);
  }

  /** 点中了哪件道具，离镜头多远 */
  hit(ray: THREE.Raycaster): { id: string; distance: number } | null {
    let best: { id: string; distance: number } | null = null;
    for (const [id, e] of this.entries) {
      const hit = ray.intersectObject(e.mesh, false)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { id, distance: hit.distance };
    }
    return best;
  }

  /** 全部道具占的盒子（屏幕上的坐标，也就是当前角色的坐标）；一件都没有是空的 */
  box(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const e of this.entries.values()) box.union(this.boxOfMesh(e.mesh));
    return box;
  }

  /** 某一件占的盒子（屏幕上的坐标） */
  boxOf(id: string): THREE.Box3 {
    const e = this.entries.get(id);
    return e ? this.boxOfMesh(e.mesh) : new THREE.Box3();
  }

  private boxOfMesh(mesh: THREE.Mesh): THREE.Box3 {
    if (!mesh.geometry.getAttribute('position')) return new THREE.Box3();
    mesh.geometry.computeBoundingBox();
    mesh.updateWorldMatrix(true, false);
    return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  }
}
