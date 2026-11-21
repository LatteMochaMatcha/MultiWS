// 自己导入素材（docs/import-plan.md 第 3 期）：.gltf 和它外面的文件、OBJ 的 .mtl、zip 包、一组文件怎么配、FBX
import { BoxGeometry, BufferAttribute, BufferGeometry, Group, Mesh, MeshPhongMaterial, MeshStandardMaterial, Texture } from 'three';
import { zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { describe, expect, it } from 'vitest';
import { IMPORT_BATCH, type ImportEntry, bundleFiles, bundleModels, importStarts, importWanted, isZip, unzipEntries } from '../src/props/importBundle';
import { readImportFbx } from '../src/props/importFbx';
import { type ImportFiles, buildImport, readImportGlb, readImportGltf } from '../src/props/importMesh';
import { sourceFromObject } from '../src/props/importObject';
import { importKind, readImportFile, readImportObj, readMtl } from '../src/props/importShape';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
const TGA = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 24, 0]);
const bytes = (s: string) => new TextEncoder().encode(s);
const buffer = (s: string) => bytes(s).buffer as ArrayBuffer;
const filesOf =
  (map: Record<string, Uint8Array>): ImportFiles =>
  (uri) =>
    map[uri] ?? null;

/** 一个三角形的 .gltf：点在外面的 tri.bin 里，带一张外面的贴图 */
const TRI = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
const gltf = (extra: object = {}) =>
  JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: 'wood', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: 'textures/wood%20grain.png' }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36, uri: 'tri.bin' }],
    ...extra,
  });

describe('读 .gltf 和它外面的文件', () => {
  it('.bin 和贴图都给了：网格、贴图都在', () => {
    const source = readImportGltf(buffer(gltf()), filesOf({ 'tri.bin': TRI, 'textures/wood%20grain.png': PNG }));
    expect([...source.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(source.textures).toEqual([{ mime: 'image/png', bytes: PNG }]);
    expect(source.materials[0].map).toBe(0);
    expect(source.notes).toEqual([]);
    expect(source.plain).toBeUndefined();
  });

  it('缺 .bin 读不了，说缺的是哪个；缺贴图照样读，说一声', () => {
    expect(() => readImportGltf(buffer(gltf()), null)).toThrow(/tri\.bin/);
    expect(() => readImportGltf(buffer(gltf()), filesOf({}))).toThrow(/tri\.bin/);
    const source = readImportGltf(buffer(gltf()), filesOf({ 'tri.bin': TRI }));
    expect(source.textures).toEqual([]);
    expect(source.materials[0].map).toBeUndefined();
    expect(source.notes.join()).toMatch(/贴图文件没找到/);
    // 贴图是工坊不认的格式
    expect(readImportGltf(buffer(gltf()), filesOf({ 'tri.bin': TRI, 'textures/wood%20grain.png': TGA })).notes.join()).toMatch(/不认的格式/);
  });

  it('网格直接写在文件里的（data:）不用别的文件', () => {
    const b64 = Buffer.from(TRI).toString('base64');
    const source = readImportGltf(buffer(gltf({ buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${b64}` }], images: [], textures: [], materials: [] })), null);
    expect([...source.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('网格分在两个 .bin 里：接起来读', () => {
    const index = new Uint8Array(new Uint16Array([0, 2, 1, 0]).buffer);
    const source = readImportGltf(
      buffer(
        gltf({
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
          ],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 36 },
            { buffer: 1, byteOffset: 0, byteLength: 6 },
          ],
          buffers: [
            { byteLength: 36, uri: 'tri.bin' },
            { byteLength: 8, uri: 'index.bin' },
          ],
        }),
      ),
      filesOf({ 'tri.bin': TRI, 'index.bin': index }),
    );
    expect([...source.indices]).toEqual([0, 2, 1]);
    expect([...source.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('坏的 .gltf、不是 glTF 的 JSON 读不了；照种类分给各自的读法', () => {
    expect(() => readImportGltf(buffer('{ not json'), null)).toThrow(/坏的/);
    expect(() => readImportGltf(buffer('{"hello": 1}'), null)).toThrow(/坏的/);
    expect(readImportFile('gltf', buffer(gltf()), filesOf({ 'tri.bin': TRI })).faceMaterial.length).toBe(1);
    expect(importKind('scene.GLTF')).toBe('gltf');
    expect(importKind('model.fbx')).toBe('fbx');
    expect(readImportGlb).toBeTypeOf('function');
  });
});

describe('OBJ 带上 .mtl 和贴图', () => {
  const OBJ = [
    'mtllib my chair.mtl',
    'v 0 0 0',
    'v 1 0 0',
    'v 1 1 0',
    'v 0 1 0',
    'v 0 0 1',
    'vt 0 0',
    'vt 1 0',
    'vt 1 1',
    'usemtl wood',
    'f 1/1 2/2 3/3',
    'usemtl red paint',
    'f 1 3 4',
    'usemtl nowhere',
    'f 1 4 5',
    'usemtl wood',
    'f 1 2 5',
  ].join('\n');
  const MTL = [
    '# made by hand',
    'newmtl wood',
    'Ns 250',
    'Kd 0.2 0.2 0.2',
    'd 1',
    'map_Kd -s 2 2 -o 0.5 textures\\oak wood.jpg',
    'norm oak_n.png',
    'newmtl red paint',
    'Kd 1 0 0',
    'Pr 0.3',
    'Pm 1',
    'Tr 0.5',
  ].join('\r\n');

  it('读 .mtl：底色、贴图（带选项、带空格的文件名）、粗糙度、透明', () => {
    const found = readMtl(MTL);
    expect([...found.keys()]).toEqual(['wood', 'red paint']);
    expect(found.get('wood')).toEqual({ roughness: 0.5, kd: [0.2, 0.2, 0.2], map: 'textures\\oak wood.jpg', tiled: true, normal: 'oak_n.png' });
    expect(found.get('red paint')).toEqual({ kd: [1, 0, 0], roughness: 0.3, metalness: 1, clear: true });
    expect(readMtl('Kd 1 1 1\nnewmtl a\nmap_Kd -clamp on -bm 0.5 a.png\nKd 0.5').get('a')).toEqual({ map: 'a.png', kd: [0.5, 0.5, 0.5] });
  });

  it('.mtl 和贴图一起给了：每个面用自己的材质，贴图带上', () => {
    const source = readImportObj(buffer(OBJ), filesOf({ 'my chair.mtl': bytes(MTL), 'textures\\oak wood.jpg': JPG, 'oak_n.png': PNG }));
    expect(source.plain).toBeUndefined();
    expect(source.materials.map((m) => m.name)).toEqual(['wood', 'red paint', 'plain']);
    // .mtl 里没有的那个材质用的是灰的那一个
    expect([...source.faceMaterial]).toEqual([0, 1, 2, 0]);
    expect(source.textures.map((x) => x.mime)).toEqual(['image/jpeg', 'image/png']);
    // 有底色贴图：底色当成白的
    expect(source.materials[0]).toMatchObject({ map: 0, normal: 1, color: [1, 1, 1], roughness: 0.5, metalness: 0 });
    // 没贴图的：.mtl 里写的颜色（换成线性的）
    expect(source.materials[1]).toMatchObject({ color: [1, 0, 0], roughness: 0.3, metalness: 1 });
    expect(source.materials[1].map).toBeUndefined();
    expect(source.notes.join()).toMatch(/平铺/);
    expect(source.notes.join()).toMatch(/透明/);
    // 转成素材文件：三个材质三组面
    const file = buildImport(source, { id: 'my-0000000000000001', scale: 1 });
    expect(file.groups.map((g) => [g.material, g.count])).toEqual([
      [0, 6],
      [1, 3],
      [2, 3],
    ]);
    expect(file.textures.length).toBe(2);
  });

  it('贴图没给、是不认的格式：照样读，说一声', () => {
    const none = readImportObj(buffer(OBJ), filesOf({ 'my chair.mtl': bytes(MTL) }));
    expect(none.plain).toBeUndefined();
    expect(none.textures).toEqual([]);
    expect(none.notes.join()).toMatch(/贴图文件没找到/);
    // 没贴图了：用 .mtl 里写的底色
    expect(none.materials[0].color[0]).toBeCloseTo(0.0331, 3);
    const odd = readImportObj(buffer(OBJ), filesOf({ 'my chair.mtl': bytes(MTL), 'textures\\oak wood.jpg': TGA, 'oak_n.png': PNG }));
    expect(odd.notes.join()).toMatch(/不认的格式/);
    expect(odd.materials[0].normal).toBe(0);
  });

  it('.mtl 没给：只有形状，说怎么带上', () => {
    const alone = readImportObj(buffer(OBJ), null);
    expect(alone.plain).toBe(true);
    expect(alone.materials.length).toBe(1);
    expect(alone.notes.join()).toMatch(/一起选上/);
    const among = readImportObj(buffer(OBJ), filesOf({ 'other.mtl': bytes(MTL) }));
    expect(among.plain).toBe(true);
    expect(among.notes.join()).toMatch(/\.mtl）没找到/);
    // .mtl 给了，但里面没有这个 OBJ 用的材质：也是只有形状
    expect(readImportObj(buffer(OBJ), filesOf({ 'my chair.mtl': bytes('newmtl unrelated\nKd 1 1 1') })).plain).toBe(true);
    // 本来就没写材质的：不啰嗦
    expect(readImportObj(buffer('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'), null).notes).toEqual([]);
  });
});

describe('一组文件', () => {
  const entry = (path: string, content: Uint8Array = new Uint8Array([1])): ImportEntry => ({ path, bytes: content });

  it('哪些文件用得上、哪些能当起点', () => {
    for (const name of ['a.glb', 'a.GLTF', 'a.obj', 'a.stl', 'a.fbx', 'a.zip', 'a.bin', 'a.mtl', 'a.png', 'a.JPG', 'a.jpeg', 'a.webp']) expect(importWanted(name)).toBe(true);
    for (const name of ['a.txt', 'a.blend', 'a.tga', 'readme', 'a.glb.bak']) expect(importWanted(name)).toBe(false);
    expect(['a.glb', 'a.zip', 'a.fbx', 'a.png', 'a.mtl'].map(importStarts)).toEqual([true, true, true, false, false]);
    expect(isZip('pack.ZIP')).toBe(true);
    expect(IMPORT_BATCH).toBe(8);
  });

  it('找模型：GLB 排最前，别的照路径排；旁边的文件不算', () => {
    const list = [entry('b/chair.obj'), entry('b/chair.mtl'), entry('a/scene.gltf'), entry('a/scene.bin'), entry('z.glb'), entry('tex.png'), entry('a/m.fbx'), entry('a/p.stl')];
    expect(bundleModels(list).map((e) => e.path)).toEqual(['z.glb', 'a/scene.gltf', 'a/m.fbx', 'b/chair.obj', 'a/p.stl']);
    expect(bundleModels([entry('a.png')])).toEqual([]);
  });

  it('给模型配旁边的文件：照相对路径、往上一层、编过码的、只有文件名、作者电脑上的整条路径', () => {
    const wood = new Uint8Array([7]);
    const near = new Uint8Array([8]);
    const far = new Uint8Array([9]);
    const main = entry('pack/models/chair/scene.gltf');
    const list = [
      main,
      entry('pack/models/chair/scene.bin', near),
      entry('pack/models/chair/textures/Wood Grain.PNG', wood),
      entry('pack/textures/shared.jpg', far),
      entry('pack/models/table/scene.bin', far),
      entry('pack/models/chair/extra/label.png', near),
      entry('other/label.png', far),
    ];
    const files = bundleFiles(list, main);
    expect(files('scene.bin')).toBe(near);
    expect(files('./textures/wood%20grain.png')).toBe(wood);
    expect(files('textures\\Wood Grain.png?v=2')).toBe(wood);
    expect(files('../../textures/shared.jpg')).toBe(far);
    // 路径对不上：照文件名找，同名的挑挨得最近的
    expect(files('C:\\Users\\someone\\Desktop\\label.png')).toBe(near);
    expect(files('nope/Wood Grain.png')).toBe(wood);
    expect(files('missing.png')).toBeNull();
    expect(files('')).toBeNull();
    // 模型自己不算它旁边的文件
    expect(bundleFiles([main], main)('scene.gltf')).toBeNull();
  });

  it('解 zip：只要用得上的，路径接在包名后面；坏的包说解不开', async () => {
    const zip = zipSync({
      'chair/scene.gltf': bytes('{}'),
      'chair/scene.bin': TRI,
      'chair/textures/wood.png': PNG,
      'chair/readme.txt': bytes('hi'),
      'chair/inner.zip': bytes('zz'),
      '__MACOSX/chair/._scene.gltf': bytes('x'),
      'chair/.hidden.png': PNG,
    });
    const entries = await unzipEntries(zip, 'downloads\\my pack');
    expect(entries.map((e) => e.path).sort()).toEqual(['downloads/my pack/chair/scene.bin', 'downloads/my pack/chair/scene.gltf', 'downloads/my pack/chair/textures/wood.png']);
    expect([...entries.find((e) => e.path.endsWith('.bin'))!.bytes]).toEqual([...TRI]);
    expect((await unzipEntries(zip)).map((e) => e.path).sort()[0]).toBe('chair/scene.bin');
    await expect(unzipEntries(bytes('这不是 zip'))).rejects.toThrow(/解不开/);
  });

  it('zip 里的 .gltf 连着它的 .bin 和贴图一起读出来', async () => {
    const zip = zipSync({ 'pack/tri.gltf': bytes(gltf()), 'pack/tri.bin': TRI, 'pack/textures/wood grain.png': PNG });
    const entries = await unzipEntries(zip, 'pack');
    const [main] = bundleModels(entries);
    const source = readImportGltf(main.bytes.slice().buffer as ArrayBuffer, bundleFiles(entries, main));
    expect(source.faceMaterial.length).toBe(1);
    expect(source.textures.length).toBe(1);
    expect(source.notes).toEqual([]);
  });
});

describe('three 读出来的物体拼成一整块', () => {
  it('照每个物体的摆放拼；一个物体几个材质的分开；贴图坐标上下翻', () => {
    const root = new Group();
    const wood = new MeshPhongMaterial({ name: 'wood', color: 0xffffff });
    const map = new Texture();
    wood.map = map;
    const paint = new MeshStandardMaterial({ name: 'paint', color: 0xff0000, roughness: 0.3, metalness: 1 });
    const box = new Mesh(new BoxGeometry(2, 2, 2), [wood, paint, wood, wood, wood, wood]);
    box.position.set(10, 1, 0);
    box.scale.set(1, 2, 1);
    root.add(box);
    const notes = new Set<string>();
    const source = sourceFromObject(root, (texture) => (texture === map ? PNG : null), notes);
    expect(source.faceMaterial.length).toBe(12);
    expect(source.min).toEqual([9, -1, -1]);
    expect(source.max).toEqual([11, 3, 1]);
    expect(source.materials.map((m) => m.name)).toEqual(['wood', 'paint']);
    expect(source.materials[0]).toMatchObject({ map: 0, color: [1, 1, 1] });
    expect(source.materials[1]).toMatchObject({ color: [1, 0, 0], roughness: 0.3, metalness: 1 });
    // 第二组面（-X 那一面）用的是第二个材质
    expect([...source.faceMaterial]).toEqual([0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(source.textures).toEqual([{ mime: 'image/png', bytes: PNG }]);
    // three 的贴图坐标左下角是原点：第一个点 (0, 1) 变成 (0, 0)
    expect([source.uvs[0], source.uvs[1]]).toEqual([0, 0]);
    // 法线还是单位长（物体拉长过）
    for (let i = 0; i < source.normals.length; i += 3) expect(Math.hypot(source.normals[i], source.normals[i + 1], source.normals[i + 2])).toBeCloseTo(1, 5);
    expect([...notes]).toEqual([]);
    expect(buildImport(source, { id: 'my-0000000000000002', scale: 1 }).size).toEqual([2, 4, 2]);
  });

  it('镜像过的物体面的绕向反过来；没带法线的现算；拿不到的贴图说一声', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    const material = new MeshPhongMaterial({ transparent: true, opacity: 0.5 });
    material.map = new Texture();
    const mesh = new Mesh(geometry, material);
    mesh.scale.set(-1, 1, 1);
    const root = new Group().add(mesh);
    const notes = new Set<string>();
    const source = sourceFromObject(root, () => null, notes);
    expect([...source.indices]).toEqual([0, 2, 1]);
    // 镜像以后面朝 -Z……绕向反过来以后算出来的法线还是朝 +Z（朝外）
    expect([source.normals[0], source.normals[1], source.normals[2]]).toEqual([0, 0, 1]);
    expect(source.materials[0].map).toBeUndefined();
    expect([...notes].join()).toMatch(/贴图文件没找到/);
    expect([...notes].join()).toMatch(/透明/);
    expect(() => sourceFromObject(new Group(), () => null, new Set())).toThrow(/没有能用的网格/);
  });
});

/** 手写的一个文字版 FBX：一个 100 单位（厘米）的方块，抬高 50，Z 朝上不转 */
const FBX = [
  '; FBX 7.4.0 project file',
  'FBXHeaderExtension:  {',
  '\tFBXHeaderVersion: 1003',
  '\tFBXVersion: 7400',
  '}',
  'GlobalSettings:  {',
  '\tVersion: 1000',
  '\tProperties70:  {',
  '\t\tP: "UpAxis", "int", "Integer", "",1',
  '\t\tP: "UnitScaleFactor", "double", "Number", "",1',
  '\t}',
  '}',
  'Objects:  {',
  '\tGeometry: 1000, "Geometry::Cube", "Mesh" {',
  '\t\tVertices: *24 {',
  '\t\t\ta: -50,-50,-50,50,-50,-50,-50,50,-50,50,50,-50,-50,-50,50,50,-50,50,-50,50,50,50,50,50',
  '\t\t}',
  '\t\tPolygonVertexIndex: *24 {',
  '\t\t\ta: 0,2,3,-2,4,5,7,-7,0,1,5,-5,2,6,7,-4,0,4,6,-3,1,3,7,-6',
  '\t\t}',
  '\t\tGeometryVersion: 124',
  '\t}',
  '\tModel: 2000, "Model::Cube", "Mesh" {',
  '\t\tVersion: 232',
  '\t\tProperties70:  {',
  '\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,50,0',
  '\t\t}',
  '\t}',
  '\tMaterial: 3000, "Material::Paint", "" {',
  '\t\tVersion: 102',
  '\t\tShadingModel: "phong"',
  '\t\tProperties70:  {',
  '\t\t\tP: "DiffuseColor", "Color", "", "A",1,0,0',
  '\t\t}',
  '\t}',
  '}',
  'Connections:  {',
  '\tC: "OO",2000,0',
  '\tC: "OO",1000,2000',
  '\tC: "OO",3000,2000',
  '}',
  '',
].join('\n');

describe('读 FBX', () => {
  it('文字版的方块：网格、摆放、材质的颜色、文件写的单位', async () => {
    const source = await readImportFbx(buffer(FBX), null);
    expect(source.faceMaterial.length).toBe(12);
    expect(source.min).toEqual([-50, 0, -50]);
    expect(source.max).toEqual([50, 100, 50]);
    // 一个单位是 1 厘米
    expect(source.unit).toBeCloseTo(0.01, 6);
    expect(source.materials.length).toBe(1);
    expect(source.materials[0].name).toBe('Paint');
    expect(source.materials[0].color[0]).toBeCloseTo(1, 3);
    expect(source.materials[0].color[1]).toBeCloseTo(0, 3);
    expect(source.textures).toEqual([]);
    const file = buildImport(source, { id: 'my-0000000000000003', scale: source.unit! });
    expect(file.size).toEqual([1, 1, 1]);
  });

  it('不是 FBX 的、太老的版本读不了', async () => {
    await expect(readImportFbx(buffer('hello'), null)).rejects.toThrow(/FBX/);
    await expect(readImportFbx(buffer(FBX.replace('FBXVersion: 7400', 'FBXVersion: 6100')), null)).rejects.toThrow(/很老/);
  });
});

describe('拖进窗口的东西', () => {
  /** 假的「拖进来的一项」：文件，或者装着别的项的文件夹 */
  const fileEntry = (name: string) => ({ isFile: true, isDirectory: false, name, file: (ok: (f: File) => void) => ok(new File(['x'], name)) });
  const folderEntry = (name: string, children: object[]) => ({
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      // 浏览器一次只给一批：这里故意两个两个地给
      let at = 0;
      return { readEntries: (ok: (list: object[]) => void) => ok(children.slice(at, (at += 2))) };
    },
  });
  const transfer = (entries: (object | null)[], files: File[] = []) => ({ items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })), files }) as unknown as DataTransfer;

  it('文件夹里的文件带着路径取出来', async () => {
    const { droppedFiles } = await import('../src/view/dropFiles');
    const picked = await droppedFiles(
      transfer([folderEntry('chair', [fileEntry('scene.gltf'), fileEntry('scene.bin'), folderEntry('textures', [fileEntry('wood.png'), fileEntry('metal.jpg'), fileEntry('note.txt')])]), fileEntry('loose.glb')]),
    );
    expect(picked.map((p) => p.path)).toEqual(['chair/scene.gltf', 'chair/scene.bin', 'chair/textures/wood.png', 'chair/textures/metal.jpg', 'chair/textures/note.txt', 'loose.glb']);
    expect(picked[2].file.name).toBe('wood.png');
  });

  it('浏览器不给「文件夹」那一套时只有文件', async () => {
    const { droppedFiles } = await import('../src/view/dropFiles');
    const picked = await droppedFiles(transfer([null], [new File(['x'], 'a.glb')]));
    expect(picked.map((p) => p.path)).toEqual(['a.glb']);
  });
});
