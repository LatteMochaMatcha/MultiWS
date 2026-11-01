/** 二次元素体的表面校正。缝合圈及其邻面保持原位，不改变面连接。 */
import { type CompiledField, evalPrims } from './field';
import { type FusedMesh, planBlocks } from './surfaceNets';

export function refineSurface(mesh: FusedMesh, field: CompiledField): FusedMesh {
  const started = performance.now();
  const h = mesh.info.voxel;
  const plan = planBlocks(field, h);
  const { positions: p, normals, triangles, quads } = mesh;
  const count = p.length / 3;
  const locked = new Uint8Array(count);
  // 手脚、自带权重的顶点、缝合和封口三角面，一圈相邻的身体四边面都不动。
  if (mesh.bound) locked.fill(1, mesh.bound.start);
  for (const v of mesh.tris ?? []) locked[v] = 1;
  const seam = locked.slice();
  for (let q = 0; q < quads.length; q += 4) {
    if (seam[quads[q]] || seam[quads[q+1]] || seam[quads[q+2]] || seam[quads[q+3]]) {
      for (let k = 0; k < 4; k++) locked[quads[q+k]] = 1;
    }
  }
  const original = p.slice();
  const previousNormals = normals.slice();
  const epsilon = h * 0.15;
  for (let v = 0; v < count; v++) {
    if (locked[v]) continue;
    const o = v * 3;
    const x = original[o], y = original[o+1], z = original[o+2];
    const i = Math.floor((x-plan.ox)/(8*h)), j = Math.floor((y-plan.oy)/(8*h)), k = Math.floor((z-plan.oz)/(8*h));
    const list = plan.lists[i + plan.bx * (j + plan.by * k)];
    if (!list) continue;
    const sample = (a: number, b: number, c: number) => evalPrims(field, list, list.length, a, b, c);
    const d = sample(x,y,z);
    // 补实形成的表面偏离原场较多；不把它吸回原先的细缝，也不碰零梯度和尖折。
    if (!Number.isFinite(d) || Math.abs(d) > h * 0.2) continue;
    const gx = (sample(x+epsilon,y,z)-sample(x-epsilon,y,z))/(2*epsilon);
    const gy = (sample(x,y+epsilon,z)-sample(x,y-epsilon,z))/(2*epsilon);
    const gz = (sample(x,y,z+epsilon)-sample(x,y,z-epsilon))/(2*epsilon);
    const g2 = gx*gx+gy*gy+gz*gz;
    if (g2 < 0.04 || !Number.isFinite(g2)) continue;
    const length = Math.sqrt(g2);
    if ((gx*normals[o]+gy*normals[o+1]+gz*normals[o+2])/length < 0.8) continue;
    const dx = -d*gx/g2, dy = -d*gy/g2, dz = -d*gz/g2;
    if (Math.hypot(dx,dy,dz) > h * 0.2) continue;
    const nx = x+dx, ny = y+dy, nz = z+dz;
    const sameCell = (a: number,b: number,origin: number) => Math.floor((a-origin)/h) === Math.floor((b-origin)/h);
    if (!sameCell(x,nx,plan.ox) || !sameCell(y,ny,plan.oy) || !sameCell(z,nz,plan.oz)) continue;
    if (Math.abs(sample(nx,ny,nz)) > Math.abs(d)) continue;
    p[o] = nx; p[o+1] = ny; p[o+2] = nz;

  }
  // 局部回退也会影响相邻面，重复核查；如果不能在四轮内稳定，整张退回。
  const cross = (points: Float32Array,a: number,b: number,c: number) => {
    const ux=points[b]-points[a], uy=points[b+1]-points[a+1], uz=points[b+2]-points[a+2];
    const vx=points[c]-points[a], vy=points[c+1]-points[a+1], vz=points[c+2]-points[a+2];
    return [uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
  };
  for (let pass = 0; pass < 5; pass++) {
    const reject = new Set<number>();
    for (let t = 0; t < triangles.length; t += 3) {
      const a=triangles[t]*3,b=triangles[t+1]*3,c=triangles[t+2]*3;
      if (p[a]===original[a] && p[a+1]===original[a+1] && p[a+2]===original[a+2] && p[b]===original[b] && p[b+1]===original[b+1] && p[b+2]===original[b+2] && p[c]===original[c] && p[c+1]===original[c+1] && p[c+2]===original[c+2]) continue;
      const old=cross(original,a,b,c), now=cross(p,a,b,c);
      if (old[0]*now[0]+old[1]*now[1]+old[2]*now[2] < 0.2*(old[0]**2+old[1]**2+old[2]**2)) {
        reject.add(a); reject.add(b); reject.add(c);
      }
    }
    if (!reject.size) break;
    if (pass === 4) { p.set(original); normals.set(previousNormals); break; }
    for (const o of reject) for (let k=0;k<3;k++) { p[o+k]=original[o+k]; normals[o+k]=previousNormals[o+k]; }
  }
  // 采样场的梯度跨格子不连续；用校正后的面积加权面法线，避免肩胸出现明暗斑。
  const freshNormals = new Float32Array(normals.length);
  for (let q = 0; q < quads.length; q += 4) {
    const a=quads[q], b=quads[q+1], c=quads[q+2], d=quads[q+3];
    const ux=p[c*3]-p[a*3], uy=p[c*3+1]-p[a*3+1], uz=p[c*3+2]-p[a*3+2];
    const vx=p[d*3]-p[b*3], vy=p[d*3+1]-p[b*3+1], vz=p[d*3+2]-p[b*3+2];
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    for (const v of [a,b,c,d]) {
      freshNormals[v*3]+=nx; freshNormals[v*3+1]+=ny; freshNormals[v*3+2]+=nz;
    }
  }
  for (let v=0; v<count; v++) {
    if (locked[v]) continue;
    const o=v*3, length=Math.hypot(freshNormals[o],freshNormals[o+1],freshNormals[o+2]);
    if (length>1e-12) for(let k=0;k<3;k++) normals[o+k]=freshNormals[o+k]/length;
  }
  mesh.info.ms += performance.now()-started;
  return mesh;
}
