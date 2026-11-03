import { describe, expect, it } from 'vitest';
import { type RefPlacement, findContent, keyOut, paperOf, planeLayout } from '../src/view/references';

/** w×h 的一张图，底色 bg；paint 里的每个格子 [x, y, rgba] 涂上颜色 */
function image(w: number, h: number, bg: [number, number, number, number], paint: [number, number, number[]][] = []) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
  for (const [x, y, c] of paint) data.set(c, (y * w + x) * 4);
  return { data, width: w, height: h };
}

/** 从 (x0, y0) 到 (x1, y1)（含）涂成一块 */
function block(x0: number, y0: number, x1: number, y1: number, c: number[]) {
  const out: [number, number, number[]][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y, c]);
  return out;
}

describe('参考图：找画着东西的那一块', () => {
  it('白底上的一个人：框住那个人', () => {
    const img = image(100, 200, [255, 255, 255, 255], block(30, 20, 59, 179, [40, 40, 40, 255]));
    expect(findContent(img)).toEqual({ left: 0.3, top: 0.1, right: 0.6, bottom: 0.9 });
  });

  it('透明底的 PNG：看不透明的地方，不管颜色', () => {
    const img = image(100, 100, [255, 255, 255, 0], block(10, 40, 89, 99, [255, 255, 255, 255]));
    expect(findContent(img)).toEqual({ left: 0.1, top: 0.4, right: 0.9, bottom: 1 });
  });

  it('零星的脏点不算', () => {
    const img = image(100, 100, [250, 248, 240, 255], [...block(40, 40, 59, 59, [0, 0, 0, 255]), [3, 95, [0, 0, 0, 255]]]);
    expect(findContent(img)).toEqual({ left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 });
  });

  it('和底色差一点点（压缩的噪点、纸的纹理）不算', () => {
    const img = image(50, 50, [200, 200, 200, 255], [...block(5, 5, 44, 44, [210, 205, 195, 255]), ...block(20, 10, 29, 39, [0, 0, 0, 255])]);
    expect(findContent(img)).toEqual({ left: 0.4, top: 0.2, right: 0.6, bottom: 0.8 });
  });

  it('整张都是底色：当整张图', () => {
    expect(findContent(image(40, 40, [0, 0, 0, 255]))).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('角上的字、脚下的签名离人远：不算进人里', () => {
    const img = image(100, 200, [255, 255, 255, 255], [
      ...block(5, 3, 30, 10, [0, 0, 0, 255]), // 左上角的名字
      ...block(30, 20, 59, 179, [40, 40, 40, 255]),
      ...block(70, 188, 95, 195, [0, 0, 0, 255]), // 右下角的签名
    ]);
    expect(findContent(img)).toEqual({ left: 0.3, top: 0.1, right: 0.6, bottom: 0.9 });
  });

  it('线稿上断开一两个像素、分开画的头和身子：还是一个人', () => {
    const img = image(100, 200, [255, 255, 255, 255], [
      ...block(40, 20, 49, 39, [0, 0, 0, 255]), // 头
      ...block(30, 42, 59, 179, [0, 0, 0, 255]), // 身子，和头隔两个像素
      ...block(62, 60, 66, 80, [0, 0, 0, 255]), // 贴着身子的一块饰品，隔三个像素（在 2% 以内）
    ]);
    expect(findContent(img)).toEqual({ left: 0.3, top: 0.1, right: 0.67, bottom: 0.9 });
  });

  it('三视图：挑最高的那一个人', () => {
    const img = image(300, 200, [255, 255, 255, 255], [
      ...block(20, 30, 69, 179, [0, 0, 0, 255]),
      ...block(120, 20, 169, 179, [0, 0, 0, 255]),
      ...block(220, 30, 269, 179, [0, 0, 0, 255]),
    ]);
    expect(findContent(img)).toEqual({ left: 0.4, top: 0.1, right: 170 / 300, bottom: 0.9 });
  });

  it('花的底（照片、画了背景）：分不出哪里是人，当整张图', () => {
    const paint: [number, number, number[]][] = [];
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) paint.push([x, y, [(x * 53 + y * 97) % 256, (x * 31) % 256, (y * 71) % 256, 255]]);
    const img = image(40, 40, [0, 0, 0, 255], paint);
    expect(paperOf(img)).toBeNull();
    expect(findContent(img)).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });
});

describe('参考图：抠掉纸', () => {
  it('纸色变透明，画上去的不动，线条边上半透明', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 230, 230, 230, 255, 250, 250, 248, 255]);
    keyOut(data, [255, 255, 255]);
    // 纸：全透明；黑线：不动；差 75（230 灰）：比 60 多，不动；差 17（纸的纹理）：全透明
    expect([data[3], data[7], data[11], data[15]]).toEqual([0, 255, 255, 0]);
    const edge = new Uint8ClampedArray([240, 240, 240, 255]);
    keyOut(edge, [255, 255, 255]);
    // 差 45：在 24 和 60 中间，半透明
    expect(edge[3]).toBeGreaterThan(0);
    expect(edge[3]).toBeLessThan(255);
  });
});

describe('参考图：摆在哪', () => {
  const place = (p: Partial<RefPlacement>): RefPlacement => ({ height: 1.6, up: 0, shift: 0, opacity: 1, flip: false, ...p });

  it('整张图都是人：人多高图就多高，脚底踩在地上', () => {
    const at = planeLayout(0.5, { left: 0, top: 0, right: 1, bottom: 1 }, place({}));
    expect(at.height).toBeCloseTo(1.6);
    expect(at.width).toBeCloseTo(0.8);
    expect(at.up).toBeCloseTo(0.8);
    expect(at.across).toBeCloseTo(0);
  });

  it('四周有空白：画里的人正好是设的高度，脚底在地上，中线在正中', () => {
    const box = { left: 0.2, top: 0.1, right: 0.4, bottom: 0.9 };
    const at = planeLayout(1, box, place({}));
    // 人占图高的八成：整张图 2 m 高、2 m 宽
    expect(at.height).toBeCloseTo(2);
    // 人的脚底（图上 0.9 那一行）落在地上，头顶（0.1）在 1.6 m
    expect(at.up + (0.5 - box.bottom) * at.height).toBeCloseTo(0);
    expect(at.up + (0.5 - box.top) * at.height).toBeCloseTo(1.6);
    // 人的中线（图上 0.3 那一列）落在 0
    expect(at.across + (0.3 - 0.5) * at.width).toBeCloseTo(0);
  });

  it('上下、左右挪：整张图跟着挪', () => {
    const box = { left: 0.2, top: 0.1, right: 0.4, bottom: 0.9 };
    const a = planeLayout(1, box, place({}));
    const b = planeLayout(1, box, place({ up: 0.05, shift: -0.3 }));
    expect(b.up - a.up).toBeCloseTo(0.05);
    expect(b.across - a.across).toBeCloseTo(-0.3);
  });

  it('左右翻转：宽度为负，画里的人的中线还在正中', () => {
    const box = { left: 0.2, top: 0.1, right: 0.4, bottom: 0.9 };
    const at = planeLayout(1, box, place({ flip: true }));
    expect(at.width).toBeCloseTo(-2);
    // 翻转以后图上 u 那一列落在 across - (u - 0.5) * |width|
    expect(at.across - (0.3 - 0.5) * Math.abs(at.width)).toBeCloseTo(0);
  });
});
