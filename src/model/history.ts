/**
 * 撤销 / 重做：一串状态快照。状态本身当作不可变的值，这里只管先后顺序。
 */

export interface HistoryOptions<T> {
  /** 最多记多少步，超出后丢掉最早的 */
  limit?: number;
  /** 同一个 key 的连续修改，间隔不超过这么多毫秒就合并成一步（拖滑块、打字） */
  window?: number;
  /** 两个状态是不是一回事；是的话不记 */
  equals?: (a: T, b: T) => boolean;
}

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastTime = -Infinity;
  private readonly limit: number;
  private readonly window: number;
  private readonly equals: (a: T, b: T) => boolean;

  constructor(
    private present: T,
    options: HistoryOptions<T> = {},
  ) {
    this.limit = options.limit ?? 200;
    this.window = options.window ?? 1000;
    this.equals = options.equals ?? Object.is;
  }

  get current(): T {
    return this.present;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * 记下一个新状态。给了 key、而且和上一次是同一个 key、间隔又很短时，
   * 这次修改并进上一步里：撤销一次就回到这一连串修改开始之前。
   */
  push(state: T, key?: string, now = Date.now()): void {
    if (this.equals(state, this.present)) return;
    const merge = key !== undefined && key === this.lastKey && (key === this.held || now - this.lastTime <= this.window);
    if (!merge) {
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.present = state;
    this.future = [];
    this.lastKey = key ?? null;
    this.lastTime = now;
  }

  /** 到此为止：下一次修改不管 key 是什么都另算一步（松开鼠标时用） */
  seal(): void {
    this.lastKey = null;
  }

  /**
   * 一段时间里用这个 key 记的修改，隔多久都并成一步（AI 助手一轮里改了好几下，撤销一次全回去）。
   * 中间夹了别的 key 的修改就另算；release() 以后照常
   */
  hold(key: string): void {
    this.held = key;
    this.seal();
  }

  release(): void {
    this.held = null;
    this.seal();
  }

  private held: string | null = null;

  /** 退回上一步，返回退回去以后的状态；没有可撤销的返回 null */
  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.present);
    this.present = prev;
    this.seal();
    return prev;
  }

  /** 重做刚撤销的那一步；没有可重做的返回 null */
  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    this.seal();
    return next;
  }
}
