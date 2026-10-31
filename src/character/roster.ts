/**
 * 「成品角色」样式能选的角色：每个是一个现成的 VRoid 模型（VRM 0.x）。
 * 这里记着每个角色的文件、来历和许可，以及读文件时要知道的两件事（自带的兽耳、染发改哪种材质）。
 * 文件是 tools/build-characters.ts 从 assets/source/ 里的原件加工出来的（只去掉了工坊用不到的贴图），放在 public/character/。
 *
 * 纯数据，不依赖浏览器。
 */
import type { CharacterId } from '../model/spec';
import { CHARACTER_IDS } from '../model/spec';
import type { ReadOptions } from './source';

export interface RosterEntry extends ReadOptions {
  id: CharacterId;
  /** 选择框里显示的名字：一眼看得出是哪个 */
  label: string;
  /** 她原来的名字（文件里写的） */
  name: string;
  /** 一句话说她长什么样 */
  look: string;
  /** public/character/ 下面的文件名 */
  file: string;
  /** 原件在 assets/source/ 下面的路径（加工脚本用） */
  source: string;
  /** 作者 */
  author: string;
  /** 许可，一句话 */
  license: string;
  /** 来源网页 */
  page: string;
  /** 许可要求署名的角色才有：用她做的东西发出去时要带上的那一句 */
  credit?: string;
}

/** pixiv 以 CC0 发布的 VRoid 旧版样例 */
const CC0 = 'CC0（pixiv 放弃著作权，随便用，不用署名）';
const OGA = 'https://opengameart.org/content/vroid-studio-cc0-models';
/** 作者在 VRoid Hub 上设的条件 */
const HUB = 'VRoid Hub 条件：谁都能用、可改、可再分发、可商用、不用署名';

export const ROSTER: readonly RosterEntry[] = [
  {
    id: 'vita',
    label: '银发猫耳',
    name: 'ヴィータ',
    look: '银色短发、蓝色挑染、异色瞳，自带电子猫耳',
    file: 'vita.vrm',
    source: 'avatarsample_f/AvatarSample_F.vrm',
    author: 'VRoid 项目（pixiv）',
    license: CC0,
    page: OGA,
    // 她那副猫耳是做在头发里的，用的是头发的第三种材质；第二种是那几缕蓝色的挑染，染发时留着
    ears: /_HAIR_03$/,
    dye: /_HAIR_01$/,
  },
  {
    id: 'victoria',
    label: '金发侧马尾',
    name: 'ヴィクトリア・ルービン',
    look: '金发、粉色发梢、侧马尾，粉白洋装',
    file: 'victoria.vrm',
    source: 'avatarsample_g/AvatarSample_G.vrm',
    author: 'VRoid 项目（pixiv）',
    license: CC0,
    page: OGA,
    dye: /_HAIR_0[12]$/,
  },
  {
    id: 'shino',
    label: '黑长直',
    name: '千駄ヶ谷篠',
    look: '黑蓝色长直发，学生制服',
    file: 'shino.vrm',
    source: 'sendagaya_shino/Sendagaya Shino.vrm',
    author: 'VRoid 项目（pixiv）',
    license: CC0,
    page: OGA,
    dye: /_HAIR_01$/,
  },
  {
    id: 'shibu',
    label: '蓝短发制服',
    name: '千駄ヶ谷渋',
    look: '深蓝色短发、红色发夹，学生制服',
    file: 'shibu.vrm',
    source: 'avatarsample_d/AvatarSample_D.vrm',
    author: 'VRoid 项目（pixiv）',
    license: CC0,
    page: OGA,
    dye: /_HAIR_01$/,
  },
  {
    id: 'vivi',
    label: '棕发围裙',
    name: 'ビビ',
    look: '棕色短发，绿色围裙裙',
    file: 'vivi.vrm',
    source: 'avatarsample_e/AvatarSample_E.vrm',
    author: 'VRoid 项目（pixiv）',
    license: CC0,
    page: OGA,
    dye: /_HAIR_0\d$/,
  },
  {
    id: 'rabbit',
    label: '兔耳',
    name: 'Preset Only Rabbit - Aquamarine',
    look: '黑发麻花辫、兔耳，短上衣短裤',
    file: 'rabbit.vrm',
    source: 'rabbit_aquamarine/5975234397273575285.vrm',
    author: '七百屋（なおしま）',
    license: HUB,
    page: 'https://hub.vroid.com/characters/1717274721342417994/models/7864107620888472526',
    ears: /Accessory_RabbitEar/,
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'kuro',
    label: '狼耳',
    name: 'Kuro（Preset Nekomimi Girls）',
    look: '黑色短发、狼耳、小麦肤色，白上衣黑短裤',
    file: 'kuro.vrm',
    source: 'nekomimi_kuro/3937691808267523746.vrm',
    author: '七百屋（なおしま）',
    license: `${HUB}；不许用于性表现`,
    page: 'https://hub.vroid.com/characters/6562992088211538595/models/9028223814359507805',
    ears: /Accessory_CatEar/,
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'sailor',
    label: '马尾水手服',
    name: '水色（ポニーテルの女の子）',
    look: '灰紫色马尾，水手服加开衫',
    file: 'sailor.vrm',
    source: 'ponytail_sailor/7482151987160479129.vrm',
    author: '白い白米',
    license: HUB,
    page: 'https://hub.vroid.com/characters/3437260818058077430/models/1673540765472485601',
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'alice',
    label: '橙发校服',
    name: 'Alice Chan',
    look: '橙色长发，灰色开衫校服',
    file: 'alice.vrm',
    source: 'alice_chan/Alice Chan (Uniform ver) v1.0.4/Alice Chan (Uniform ver) 1.0.2.vrm',
    author: 'edisonlee55（yuna0x0）',
    license: 'CC BY-SA 4.0：要署名；改过再发出去也得用同样的许可',
    page: 'https://yuna0x0.itch.io/alice-chan',
    credit: 'Alice Chan © edisonlee55，CC BY-SA 4.0',
    dye: /_Hair_\d+_HAIR(_\d+)?$/,
  },
  {
    id: 'kotori',
    label: '绿发红裙',
    name: 'Kotori',
    look: '黄绿色头发，白上衣红裙',
    file: 'kotori.vrm',
    source: 'kotori/Model/Kotori.vrm',
    author: 'Fox Jump',
    license: 'CC BY（文件里写的）：要署名',
    page: 'https://fox-jump.itch.io/kotori-anime-character',
    credit: 'Kotori © Fox Jump，CC BY',
    dye: /_HAIR_01$/,
  },
];

const BY_ID = new Map(ROSTER.map((entry) => [entry.id, entry]));
if (ROSTER.length !== CHARACTER_IDS.length || CHARACTER_IDS.some((id) => !BY_ID.has(id))) throw new Error('角色清单和 CHARACTER_IDS 对不上');

export const rosterEntry = (id: CharacterId): RosterEntry => BY_ID.get(id)!;
/** 角色文件的地址（相对网站根目录） */
export const characterUrl = (id: CharacterId) => `character/${rosterEntry(id).file}`;
