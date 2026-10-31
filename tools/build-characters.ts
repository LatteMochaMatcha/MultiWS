// 把 assets/source/ 里的角色原件加工成工坊运行时读的文件（public/character/<名字>.vrm）：
//   node tools/run.mjs tools/build-characters.ts
// 要哪些角色、原件在哪，照 src/character/roster.ts 的清单。
//
// 只做一件事：工坊只用每种材质的底色贴图，别的图（法线、阴影色、高光、缩略图 …）用不到，
// 换成 1×1 的占位图，每个文件能小三分之一左右。网格、骨骼、表情、VRM 的说明和许可信息都原样留着。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROSTER } from '../src/character/roster';
import { readCharacter } from '../src/character/source';
import { slim } from '../src/io/glbSlim';

const sum = (data: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < data.length; i++) s = (s * 31 + Math.round(data[i] * 1e5)) | 0;
  return s;
};
const buffer = (file: Uint8Array) => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;

export async function main(_args: string[], root: string) {
  let before = 0;
  let after = 0;
  for (const entry of ROSTER) {
    const file = readFileSync(join(root, 'assets/source', entry.source));
    const { out, dropped } = slim(file);
    // 核对：加工前后读出来的东西（网格、骨骼、底色贴图、表情）一模一样
    const a = readCharacter(buffer(file), entry);
    const b = readCharacter(buffer(out), entry);
    const same =
      a.bones.length === b.bones.length &&
      a.chunks.length === b.chunks.length &&
      a.chunks.every((c, i) => sum(c.positions) === sum(b.chunks[i].positions) && sum(c.weights) === sum(b.chunks[i].weights) && c.indices.length === b.chunks[i].indices.length) &&
      a.images.length === b.images.length &&
      a.images.every((image, i) => image.bytes.length === b.images[i].bytes.length && sum(image.bytes.subarray(0, 4096)) === sum(b.images[i].bytes.subarray(0, 4096))) &&
      (a.face?.names.join() ?? '') === (b.face?.names.join() ?? '') &&
      (a.face?.positions.every((p, i) => sum(p) === sum(b.face!.positions[i])) ?? true);
    if (!same) throw new Error(`${entry.id}：加工以后读出来的和原件不一样`);
    const target = join(root, 'public/character', entry.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, out);
    before += file.length;
    after += out.length;
    console.log(`${entry.id.padEnd(9)} ${(file.length / 1e6).toFixed(1).padStart(5)} MB → ${(out.length / 1e6).toFixed(1).padStart(5)} MB  （换掉 ${dropped} 张用不到的图）  ${a.title}`);
  }
  console.log(`合计 ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);
}
