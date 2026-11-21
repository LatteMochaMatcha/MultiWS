/**
 * AI 助手能碰到的工坊：只有这几样，全由 main.ts 实现（测试里换成假的）。
 * 工具只经过这里改设定，不碰 DOM、不直接改 main.ts 里的变量。
 */
import type { BodySpec } from '../model/spec';

export interface WorkshopApi {
  /** 现在这个角色的设定 */
  spec(): BodySpec;
  /**
   * 换一份新设定：照样整理（成人部件开关关着时去掉那几项）、记撤销、存档、刷新面板和模型，描述框改写成规范描述。
   * key 相同的连续改动并成一步撤销（见 hold）。返回实际用上的设定
   */
  apply(next: BodySpec, key: string): BodySpec;
  /** 「显示成人部件」开没开 */
  adultOn(): boolean;
  /**
   * 撤销分组：hold 以后用这个 key 记的改动，隔多久都并成一步；release 结束。
   * 一轮对话里 agent 改了好几下，撤销一次全回去
   */
  hold(key: string): void;
  release(): void;
  /** 现在这一步撤销记录的记号：一轮结束时记下，「撤回这一轮」时核对还是不是它（中间人自己又改过就不能撤了） */
  mark(): unknown;
  undo(): void;

  /* ---- 圈问题（marks.ts）和单独微调部件（tools.ts）用的 ---- */
  /** 3D 视图那一块：圈问题时在上面盖一层画布 */
  stage(): HTMLElement | null;
  /** 3D 视图里这一点（按画布宽高的比例，0–1）是哪个部件；没点中是 null */
  pickAt(x: number, y: number): string | null;
  /** 3D 视图现在的样子（PNG，背景透明，不带地上的圈和操纵杆） */
  snapshot(): Promise<Blob>;
  /** 镜头从哪边看角色：front / back / left（角色自己的左边）/ right / top / bottom / angled */
  viewSide(): string;
  /** 能单独微调的部件名（和「微调」那一栏一样） */
  parts(): string[];

  /** 场景里的道具（sceneTools.ts 用）。没有这一块时助手没有道具的工具 */
  scene?: SceneApi;
}

/** 一件道具：尺寸是宽、高、深（米）；pos 是底面正中在场景里的位置（左右、离地多高、前后）；rot 是前后倾、朝向、左右倾（度） */
export interface PropInfo {
  id: string;
  /** 给人看的名字 */
  name: string;
  /** 基本体的种类（pole、box……），或者家具的编号 */
  kind: string;
  size: [number, number, number];
  pos: [number, number, number];
  rot: [number, number, number];
  color: string;
}

/** 要改的那几项。size 里的 NaN 是「这一项不改」；lift：新放的道具没给位置时离地多高 */
export interface PropChange {
  pos?: [number, number, number];
  rot?: [number, number, number];
  size?: [number, number, number];
  color?: string;
  name?: string;
  lift?: number;
}

export interface SceneApi {
  props(): PropInfo[];
  /** 能放的种类：基本体和现成的家具（real：写实款，第一次用要下载；mine：用户自己导入的） */
  kinds(): { kind: string; name: string; size: [number, number, number]; real?: true; mine?: true }[];
  /** 当前角色站在哪（左右、前后，米）、朝哪（度）、离地多高（米） */
  figure(): { name: string; x: number; z: number; yaw: number; y: number };
  /** 放一件；没给位置的放在当前角色旁边的空地上。放不了抛出原因 */
  add(kind: string, change: PropChange): Promise<PropInfo>;
  /** 改一件（位置、角度、尺寸、颜色、名字）；没有这件抛错 */
  change(id: string, change: PropChange): PropInfo;
  remove(id: string): void;
  /** 当前角色能对这件道具做的一键动作；block 是现在做不了的原因 */
  actions(id: string): { key: string; label: string; block: string | null }[];
  /** 做一个一键动作，返回做成了的那句话；做不了抛出原因 */
  act(id: string, action: string): string;
  /** 当前角色能抓东西的手、能踩东西的脚（part 是工具里用的名字） */
  limbs(): { part: string; label: string }[];
  /**
   * 当前角色现在连着道具的地方。mode：holds 是这只手（脚）留在道具上、道具不动；carries 是道具跟着这一处（手、脚、胸口）走；
   * rides 是整个人跟着道具（坐着、躺着、吊着，part 是 body）
   */
  attached(): { part: string; label: string; prop: string; mode: 'holds' | 'carries' | 'rides'; way?: 'over' | 'under' }[];
  /** 一只手抓住（脚踩住）一件道具：够得着就伸过去抓；carry 是抓住以后道具跟着它走。返回那句话；做不了抛出原因 */
  grab(part: string, id: string, carry: boolean): string;
  /** 松开一个连接（手、脚、胸口，或者 body） */
  release(part: string): string;
  /** 一个连接换方向：on 是道具跟着这一处走，不然道具留在原地、这一处留在它上面 */
  setCarry(part: string, on: boolean): string;
  /** 握着杆的一只手换握法：over 是正手（拇指朝里、朝上），under 是反手。attached() 里握着杆的手带着 way */
  gripWay(part: string, way: 'over' | 'under'): string;
}
