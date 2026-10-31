import { describe, expect, it } from 'vitest';
import { History } from '../src/model/history';

describe('撤销 / 重做', () => {
  it('一开始没有可撤销、可重做的', () => {
    const h = new History('a');
    expect(h.current).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
    expect(h.current).toBe('a');
  });

  it('撤销一步步退回去，重做一步步走回来', () => {
    const h = new History('a');
    h.push('b');
    h.push('c');
    expect(h.current).toBe('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.redo()).toBeNull();
    expect(h.current).toBe('c');
  });

  it('撤销以后做了新的修改，原来可以重做的那些就没有了', () => {
    const h = new History('a');
    h.push('b');
    h.push('c');
    h.undo();
    h.push('d');
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('b');
    expect(h.redo()).toBe('d');
  });

  it('同一个 key 的连续修改合并成一步', () => {
    const h = new History(0);
    h.push(1, 'slider', 1000);
    h.push(2, 'slider', 1100);
    h.push(3, 'slider', 1900);
    expect(h.current).toBe(3);
    expect(h.undo()).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe(3);
  });

  it('隔得太久、换了 key、没有 key，都另算一步', () => {
    const h = new History(0, { window: 500 });
    h.push(1, 'a', 1000);
    h.push(2, 'a', 1600);
    h.push(3, 'b', 1700);
    h.push(4, undefined, 1710);
    h.push(5, undefined, 1720);
    expect([h.undo(), h.undo(), h.undo(), h.undo(), h.undo(), h.undo()]).toEqual([4, 3, 2, 1, 0, null]);
  });

  it('seal 之后，同一个 key 也另算一步', () => {
    const h = new History(0);
    h.push(1, 'drag', 1000);
    h.push(2, 'drag', 1010);
    h.seal();
    h.push(3, 'drag', 1020);
    h.push(4, 'drag', 1030);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(0);
  });

  it('撤销、重做之后的修改不会并进之前的那一步', () => {
    const h = new History(0);
    h.push(1, 'k', 1000);
    h.undo();
    h.redo();
    h.push(2, 'k', 1010);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
  });

  it('和现在一样的状态不记', () => {
    const h = new History({ n: 1 }, { equals: (a, b) => a.n === b.n });
    h.push({ n: 1 });
    expect(h.canUndo).toBe(false);
    h.push({ n: 2 });
    h.push({ n: 2 }, 'x');
    expect(h.undo()).toEqual({ n: 1 });
    expect(h.canUndo).toBe(false);
  });

  it('超出步数上限时丢掉最早的', () => {
    const h = new History(0, { limit: 3 });
    for (let i = 1; i <= 10; i++) h.push(i);
    expect([h.undo(), h.undo(), h.undo(), h.undo()]).toEqual([9, 8, 7, null]);
  });
});
