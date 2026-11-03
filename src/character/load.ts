/**
 * 成品角色的文件：放在哪、怎么取回来。
 * 能选的角色记在 roster.ts 里，文件放在 public/character/ 下面，选到哪个才取哪个（每个十来 MB）。
 * 换发型用的几副头发是从 pixiv 的 CC0 样例里取下来的（见 tools/build-hair.mjs），放在 public/character/hair/，也是用到时才取。
 */
import { t } from '../i18n';
import { fetchFile } from '../io/fetchFile';
import { keepFile, keptFile } from '../io/keepFile';
import { type CharacterChoice, type CharacterId, type HairStyle, OWN_CHARACTER } from '../model/spec';
import { hairMaterial } from './assemble';
import { type HairDonor, readHair } from './hair';
import { characterUrl, rosterEntry } from './roster';
import { type CharacterSource, type ReadOptions, readCharacter } from './source';

/** 一开始就有的那个角色（也是默认的）：读它的文件要用的那几项，测试里用 */
export const CHARACTER = { ...rosterEntry('vita'), url: characterUrl('vita') };

/** 换发型用的头发文件的地址（相对网站根目录） */
export const hairUrl = (style: Exclude<HairStyle, 'own'>) => `character/hair/${style}.glb`;

/** 读好的角色最多留几个：一个要占二十来 MB 内存，再多的把最久没用的那个放掉，用到再取 */
const KEEP = 3;
/** 读好的角色，最近用过的排在后面 */
const loaded = new Map<CharacterId, CharacterSource>();
const loading = new Map<CharacterId, Promise<CharacterSource>>();

/** 已经读好的角色；还没读好（或者放掉了）就是 null */
export function characterSource(id: CharacterChoice): CharacterSource | null {
  if (id === OWN_CHARACTER) return own;
  const source = loaded.get(id);
  if (!source) return null;
  // 挪到最后：算作刚用过
  loaded.delete(id);
  loaded.set(id, source);
  return source;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * 头发的平均颜色（线性空间）：把头发的贴图解出来，缩成一小块，按不透明度加权平均，再乘上材质的底色。
 * 解不出来（没有贴图，或者不在浏览器里）就返回 undefined。
 */
async function hairColor(source: CharacterSource): Promise<[number, number, number] | undefined> {
  const material = hairMaterial(source);
  const image = material && source.images[material.image];
  if (!image || typeof createImageBitmap !== 'function') return undefined;
  const size = 32;
  const bitmap = await createImageBitmap(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mime }), {
    resizeWidth: size,
    resizeHeight: size,
    resizeQuality: 'medium',
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = context.getImageData(0, 0, size, size).data;
  const sum = [0, 0, 0];
  let weight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    for (let k = 0; k < 3; k++) sum[k] += toLinear(pixels[i + k] / 255) * alpha;
    weight += alpha;
  }
  if (weight < 1) return undefined;
  return [(sum[0] / weight) * material.color[0], (sum[1] / weight) * material.color[1], (sum[2] / weight) * material.color[2]];
}

/** 浅色贴图的平均亮度调到多少（sRGB，0–1）：留一点余地给高光 */
const LIGHT_LEVEL = 0.82;
/** 浅色贴图最大边长：头发的贴图是一缕缕的明暗，用不着原图那么大，小一点做得快 */
const LIGHT_SIZE = 1024;
/** 已经做过浅色贴图的（不管做没做出来） */
const lit = new WeakSet<CharacterSource>();

/** 这个角色（或这副头发）染发用的浅色贴图做过了没有 */
export const hairLit = (source: CharacterSource): boolean => lit.has(source);

/**
 * 浏览器里用：给一个角色（或一副换上去的头发）做染发用的浅色贴图。要解图、重新压图，一张大图得几百毫秒，
 * 所以不在载入时做，染发、换发型时才做；做好之前照老办法染（深色的头发先染不浅）。
 */
export function lightenHair(source: CharacterSource): Promise<void> {
  return lighten(source)
    .catch(() => undefined)
    .then(() => {
      lit.add(source);
    });
}

/**
 * 给「颜色画在贴图里」的头发各做一张浅色的贴图（见 CharacterSource.hairLight）：每个通道除以它的平均值，
 * 明暗的纹路留着，颜色去掉。染发的材质和贴着头皮的那一层都做。做不出来（不在浏览器里）就不做，染发退回老办法。
 */
async function lighten(source: CharacterSource): Promise<void> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return;
  const wanted = new Set<number>([...source.dyeMaterials, ...source.materials.flatMap((m, i) => (/HairBack/i.test(m.name) ? [i] : []))]);
  const byImage = new Map<number, { image: number; tone: [number, number, number] } | null>();
  for (const index of wanted) {
    const from = source.materials[index].image;
    if (from < 0) continue;
    let light = byImage.get(from);
    if (light === undefined) {
      light = await lightImage(source, from).catch(() => null);
      byImage.set(from, light);
    }
    if (light) (source.hairLight ??= new Map()).set(index, light);
  }
}

async function lightImage(source: CharacterSource, index: number): Promise<{ image: number; tone: [number, number, number] } | null> {
  const image = source.images[index];
  const bitmap = await createImageBitmap(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mime }));
  const canvas = document.createElement('canvas');
  const shrink = Math.min(1, LIGHT_SIZE / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * shrink));
  canvas.height = Math.max(1, Math.round(bitmap.height * shrink));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const sum = [0, 0, 0];
  let weight = 0;
  for (let i = 0; i < px.length; i += 4) {
    const alpha = px[i + 3] / 255;
    for (let k = 0; k < 3; k++) sum[k] += px[i + k] * alpha;
    weight += alpha;
  }
  if (weight < 1) return null;
  const average = sum.map((v) => v / weight / 255);
  // 本来就是浅色的贴图（颜色在材质的底色里）不用做
  if (Math.min(...average) > 0.8) return null;
  const gain = average.map((v) => LIGHT_LEVEL / Math.max(v, 0.02));
  const tone = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    const alpha = px[i + 3] / 255;
    for (let k = 0; k < 3; k++) {
      const v = Math.min(255, px[i + k] * gain[k]);
      px[i + k] = v;
      tone[k] += toLinear(v / 255) * alpha;
    }
  }
  context.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  source.images.push({ name: `${image.name}_light`, mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()) });
  return { image: source.images.length - 1, tone: [tone[0] / weight, tone[1] / weight, tone[2] / weight] };
}

/** 浏览器里用：把一个角色的文件取回来读好。每个只取一次 */
export function loadCharacter(id: CharacterId, base = '/'): Promise<CharacterSource> {
  let pending = loading.get(id);
  if (!pending) {
    pending = fetchFile(`${base}${characterUrl(id)}`, t('角色文件'))
      .then(async (buffer) => {
        const source = readCharacter(buffer, rosterEntry(id));
        // 量不出头发的颜色不要紧：尾巴和兽耳退回去用材质的底色
        source.hairColor = await hairColor(source).catch(() => undefined);
        loaded.set(id, source);
        for (const old of [...loaded.keys()].slice(0, Math.max(0, loaded.size - KEEP))) {
          loaded.delete(old);
          loading.delete(old);
        }
        return source;
      })
      .catch((err) => {
        loading.delete(id);
        throw err;
      });
    loading.set(id, pending);
  }
  return pending;
}

/* ---- 自己的 VRM ---- */

/**
 * 读用户自己的 VRM 用的那几项：自带的兽耳认不出来（各人做法不一样），染发改主头发（VRoid 的起名）。
 * strict：不是 VRM、缺骨骼时说清楚是哪里不对
 */
export const OWN_READ: ReadOptions = { dye: /_HAIR_01$|_Hair_\d+_HAIR(_\d+)?$/, strict: true };
/** 存在浏览器里用的名字 */
const OWN_KEY = 'own-character';
let own: CharacterSource | null = null;
/** 自己的 VRM 的文件名 */
let ownName = '';
export const ownFileName = () => ownName;

/**
 * 读用户自己给的 VRM（浏览器里用）：读好以后记下来，并且存在这台设备的浏览器里，下次打开还在。
 * 读不了就抛出错误（错误信息说哪里不对），之前载入的那个不动
 */
export async function loadOwnCharacter(name: string, bytes: ArrayBuffer, keep = true): Promise<CharacterSource> {
  const source = readCharacter(bytes, OWN_READ);
  source.hairColor = await hairColor(source).catch(() => undefined);
  own = source;
  ownName = name;
  if (keep) await keepFile(OWN_KEY, { name, bytes });
  return source;
}

let restoring: Promise<CharacterSource | null> | null = null;
/** 把上次存在浏览器里的那个 VRM 读回来（只试一次）；没存过、读不了都是 null */
export function restoreOwnCharacter(): Promise<CharacterSource | null> {
  restoring ??= keptFile(OWN_KEY).then((file) => (file ? loadOwnCharacter(file.name, file.bytes, false).catch(() => null) : null));
  return restoring;
}

const hairs = new Map<HairStyle, HairDonor>();
const hairLoading = new Map<HairStyle, Promise<HairDonor>>();

/** 已经读好的那副头发；还没读好（或者选的是原装）就是 null */
export const hairDonor = (style: HairStyle): HairDonor | null => hairs.get(style) ?? null;

/** 浏览器里用：把一副头发取回来读好。每副只取一次 */
export function loadHair(style: Exclude<HairStyle, 'own'>, base = '/'): Promise<HairDonor> {
  let pending = hairLoading.get(style);
  if (!pending) {
    pending = fetchFile(`${base}${hairUrl(style)}`, t('头发文件'))
      .then(async (buffer) => {
        const donor = readHair(buffer);
        donor.source.hairColor = await hairColor(donor.source).catch(() => undefined);
        hairs.set(style, donor);
        return donor;
      })
      .catch((err) => {
        hairLoading.delete(style);
        throw err;
      });
    hairLoading.set(style, pending);
  }
  return pending;
}
