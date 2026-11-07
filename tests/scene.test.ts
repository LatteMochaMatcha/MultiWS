import { describe, expect, it } from 'vitest';
import { defaultSpec, normalizeSpec, serializeSpec } from '../src/model/spec';
import {
  type Scene,
  absolutePlace,
  addFigure,
  besideAll,
  clampPlace,
  currentOf,
  moveFigure,
  nextId,
  normalizeScene,
  relativePlace,
  removeFigure,
  restoreFigure,
  serializeScene,
  setCurrent,
  singleScene,
  updateFigure,
  wrapYaw,
} from '../src/model/scene';

const specData = (spec: ReturnType<typeof defaultSpec>, text: string) => JSON.parse(serializeSpec(spec, text));
const readSpec = (raw: unknown) => ({ spec: normalizeSpec(raw), text: typeof (raw as { text?: unknown })?.text === 'string' ? (raw as { text: string }).text : '' });

function three(): Scene {
  let s = singleScene(defaultSpec(), '一个头');
  s = addFigure(s, { name: '乙', spec: { ...defaultSpec(), bodyStyle: 'anime' }, text: '二', place: { x: 1, z: 0, yaw: 0 } });
  s = addFigure(s, { name: '', spec: defaultSpec(), text: '三', place: { x: 2, z: 0, yaw: 90 } });
  return s;
}

describe('场景：增删、切换', () => {
  it('一个角色的场景就是原来的样子，站在原点', () => {
    const s = singleScene(defaultSpec(), 'x');
    expect(s.figures).toHaveLength(1);
    expect(currentOf(s).place).toEqual({ x: 0, z: 0, yaw: 0 });
    expect(currentOf(s).text).toBe('x');
  });

  it('加的角色排在最后、成为当前的，编号不重复', () => {
    const s = three();
    expect(s.figures.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(s.current).toBe('f3');
    expect(nextId(s)).toBe('f4');
  });

  it('删当前的换成后面那个，删最后一个换成前面那个；只剩一个删不了', () => {
    let s = setCurrent(three(), 'f2');
    s = removeFigure(s, 'f2');
    expect(s.figures.map((f) => f.id)).toEqual(['f1', 'f3']);
    expect(s.current).toBe('f3');
    s = removeFigure(s, 'f3');
    expect(s.current).toBe('f1');
    expect(removeFigure(s, 'f1')).toBe(s);
  });

  it('删了以后编号不复用；恢复刚删的放回原位', () => {
    const before = three();
    const gone = before.figures[1];
    let s = removeFigure(before, 'f2');
    expect(nextId(s)).toBe('f4');
    s = restoreFigure(s, gone, 1);
    expect(s.figures.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(s.current).toBe('f2');
  });

  it('改名去掉多余的空白、限长；挪顺序', () => {
    let s = updateFigure(three(), 'f1', { name: '  甲   一  ' });
    expect(s.figures[0].name).toBe('甲 一');
    s = updateFigure(s, 'f1', { name: 'x'.repeat(100) });
    expect(s.figures[0].name).toHaveLength(40);
    s = moveFigure(s, 'f1', 1);
    expect(s.figures.map((f) => f.id)).toEqual(['f2', 'f1', 'f3']);
    expect(moveFigure(s, 'f2', -1)).toBe(s);
  });

  it('不认得的 id：切换、修改都不变', () => {
    const s = three();
    expect(setCurrent(s, 'f9')).toBe(s);
    expect(updateFigure(s, 'f9', { name: 'a' })).toBe(s);
  });
});

describe('场景：摆放', () => {
  it('朝向绕回 -180°–180°', () => {
    expect(wrapYaw(190)).toBe(-170);
    expect(wrapYaw(-180)).toBe(180);
    expect(wrapYaw(720)).toBeCloseTo(0);
  });

  it('位置收进 ±20 米，坏数据当 0', () => {
    expect(clampPlace({ x: 99, z: Number.NaN, yaw: 370 })).toEqual({ x: 20, z: 0, yaw: 10 });
    expect(clampPlace(null)).toEqual({ x: 0, z: 0, yaw: 0 });
  });

  it('相对位置：自己看自己在原点；转 90° 以后右边的人跑到前后', () => {
    const a = { x: 1, z: 2, yaw: 0 };
    expect(relativePlace(a, a)).toEqual({ x: 0, z: 0, yaw: 0 });
    expect(relativePlace(a, { x: 3, z: 2, yaw: 30 })).toEqual({ x: 2, z: 0, yaw: 30 });
    // 我朝左转了 90°（脸朝 +X）：在我右边 +X 2 米的人，在我自己的坐标里就在我正前方（+Z）
    const r = relativePlace({ x: 0, z: 0, yaw: 90 }, { x: 2, z: 0, yaw: 90 });
    expect(r.x).toBeCloseTo(0);
    expect(r.z).toBeCloseTo(2);
    expect(r.yaw).toBe(0);
  });

  it('absolutePlace 是 relativePlace 反过来', () => {
    const from = { x: 1.5, z: -2, yaw: 37 };
    const to = { x: -0.3, z: 4, yaw: -120 };
    const back = absolutePlace(from, relativePlace(from, to));
    expect(back.x).toBeCloseTo(to.x);
    expect(back.z).toBeCloseTo(to.z);
    expect(back.yaw).toBeCloseTo(to.yaw);
  });

  it('新角色站在最右边那个的右手边，空出 30 厘米', () => {
    expect(besideAll([], 0.3)).toEqual({ x: 0, z: 0, yaw: 0 });
    const p = besideAll(
      [
        { x: 0, z: 0, radius: 0.4 },
        { x: 1, z: 0.5, radius: 0.3 },
      ],
      0.25,
    );
    expect(p).toEqual({ x: 1.85, z: 0.5, yaw: 0 });
  });
});

describe('场景：存档', () => {
  it('存了再读回来一样', () => {
    const s = updateFigure(three(), 'f2', { place: { x: -1.25, z: 0.5, yaw: -45 } });
    const back = normalizeScene(JSON.parse(serializeScene(s, specData)), readSpec)!;
    expect(back.current).toBe(s.current);
    expect(back.figures.map((f) => [f.id, f.name, f.text, f.place])).toEqual(s.figures.map((f) => [f.id, f.name, f.text, f.place]));
    expect(back.figures[1].spec.bodyStyle).toBe('anime');
    expect(JSON.stringify(back.figures.map((f) => f.spec))).toBe(JSON.stringify(s.figures.map((f) => f.spec)));
  });

  it('认不出来的返回 null；重复的编号重新编；当前的不在就是第一个', () => {
    expect(normalizeScene({ counts: {} }, readSpec)).toBeNull();
    expect(normalizeScene({ app: 'oc-basemesh-scene', figures: [] }, readSpec)).toBeNull();
    const s = normalizeScene(
      {
        app: 'oc-basemesh-scene',
        current: 'f7',
        figures: [
          { id: 'f1', spec: {} },
          { id: 'f1', spec: null, place: { x: 'a' } },
          { id: 'bad', name: 3 },
        ],
      },
      readSpec,
    )!;
    expect(s.figures.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    expect(s.current).toBe('f1');
    expect(s.figures[1].place).toEqual({ x: 0, z: 0, yaw: 0 });
    expect(s.figures[2].name).toBe('');
  });
});
