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
}
