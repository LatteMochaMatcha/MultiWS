// 手指根数、脚趾个数试做：3–8 根手指的手画成一排（手背、手心、斜看），存到 docs/digits-hands.png；
// 2–8 个脚趾的脚（脚背、脚底、斜看）存到 docs/digits-feet.png。
// 用法：node tools/run.mjs tools/try-digits.ts
import { writeFileSync } from 'node:fs';
import { footMesh } from '../src/anime/foot';
import { handShape } from '../src/anime/hand';
import { type V3, frameFor, png, render } from './softRender';

export function main() {
const counts = [3, 4, 5, 6, 7, 8];
const W = 260;
const H = 220;
// 网格里手指朝 +X、手背朝 +Y、拇指朝 +Z：转成「手背朝相机、拇指朝下」再画
const turn = (p: ArrayLike<number>, flip: boolean) => {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i];
    out[i + 1] = flip ? p[i + 2] : -p[i + 2];
    out[i + 2] = flip ? -p[i + 1] : p[i + 1];
  }
  return out;
};
const views: { name: string; flip: boolean; dir: V3 }[] = [
  { name: 'back', flip: false, dir: [0, 0, 1] },
  { name: 'palm', flip: true, dir: [0, 0, 1] },
  { name: 'three', flip: false, dir: [0.35, -0.45, 0.82] },
];
const rows = views.map((view) => {
  const meshes = counts.map((n) => handShape(n).mesh);
  // 同一行用同一个取景，大小才对得上（按最宽的 8 根取）
  const frame = frameFor(turn(meshes[meshes.length - 1].positions, view.flip), [view.dir], W, H, 1.1);
  return meshes.map((m) => render(turn(m.positions, view.flip), m.triangles, view.dir, frame, W, H));
});
const sheet = new Uint8Array(W * counts.length * H * views.length * 3);
rows.forEach((row, r) =>
  row.forEach((img, c) => {
    for (let y = 0; y < H; y++) sheet.set(img.subarray(y * W * 3, (y + 1) * W * 3), ((r * H + y) * W * counts.length + c * W) * 3);
  }),
);
writeFileSync('docs/digits-hands.png', png(W * counts.length, H * views.length, sheet));
console.log('docs/digits-hands.png', counts.join(' '));

  feet();
}

function feet() {
  const counts = [2, 3, 4, 5, 6, 7, 8];
  const W = 220;
  const H = 200;
  // 脚的网格里脚趾朝 +Z、脚背朝 +Y：转成「脚趾朝右」再画（top 看脚背，sole 看脚底）
  const turn = (p: ArrayLike<number>, sole: boolean) => {
    const out = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      out[i] = p[i + 2];
      out[i + 1] = sole ? -p[i] : p[i];
      out[i + 2] = sole ? -p[i + 1] : p[i + 1];
    }
    return out;
  };
  const views: { sole: boolean; dir: V3 }[] = [
    { sole: false, dir: [0, 0, 1] },
    { sole: true, dir: [0, 0, 1] },
    { sole: false, dir: [0.35, -0.55, 0.76] },
  ];
  const rows = views.map((view) => {
    const meshes = counts.map((n) => footMesh(n));
    const frame = frameFor(turn(meshes[meshes.length - 1].positions, view.sole), [view.dir], W, H, 1.1);
    return meshes.map((m) => render(turn(m.positions, view.sole), m.triangles, view.dir, frame, W, H));
  });
  const sheet = new Uint8Array(W * counts.length * H * views.length * 3);
  rows.forEach((row, r) =>
    row.forEach((img, c) => {
      for (let y = 0; y < H; y++) sheet.set(img.subarray(y * W * 3, (y + 1) * W * 3), ((r * H + y) * W * counts.length + c * W) * 3);
    }),
  );
  writeFileSync('docs/digits-feet.png', png(W * counts.length, H * views.length, sheet));
  console.log('docs/digits-feet.png', counts.join(' '));
}
