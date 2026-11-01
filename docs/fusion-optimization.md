# 融合优化验证（2026-11-01）

产品改动在 src/sdf/fork.ts、grids.ts、surfaceNets.ts。未更改融合半径、体素精度、补实和缝合规则；保留开始任务时已有的工作区修改。

- 分界的四元数常量预编译，逐点只算 X 分量；逆变形复用三角函数并避免重复求解最终高度。
- 不混合深度的平面分叉按精确 X/Y 缓存逆解，每个适用变形固定 512 项、28 KiB；任意轴旋转走完整求解。
- 256 种变号棱查表，连面只遍历活跃格子；复用均匀块求值缓冲，直接写三角形索引。

## 本机离线性能

Node 单线程、静止模型、体素 0.006；同一进程加载本轮改动前快照与新源码，双方预热后交替执行各 5 次，取完整 fuseParts（含缝合）中位数。未包含蒙皮、界面、文件序列化，不是浏览器多线程等待时间。

|模型|改前 ms|改后 ms|耗时减少|
|---|---:|---:|---:|
|普通白模|207|209|-1%|
|普通二次元素体|258|258|0%|
|双上半身二次元素体|1455|917|37%|
|三上半身二次元素体|3687|3279|11%|
|双头双胯二次元素体|511|491|4%|

三上半身包含绕多个轴的旋转，不能使用平面缓存，未达到原计划的 30% 目标。未测浏览器端速度增益或峰值内存变化。

## 正确性与浏览器验证

- 6 类模型 × preview/fine 共 12 组，对照改前快照：顶点坐标逐值一致，四边面/三角面索引一致，均为一个连通块。
- npm test -- tests/fork.test.ts tests/sdf.test.ts tests/job.test.ts tests/parallel.test.ts tests/torsos.test.ts tests/twin.test.ts tests/graft.test.ts tests/posedField.test.ts tests/bindPose.test.ts tests/fingers.test.ts：10 文件、168 项通过。覆盖封闭性、分块边界、缝合、任务取消、帮手故障与结果一致性。未运行整个项目全部测试。
- npm run build 与 npm run typecheck 通过。
- Playwright：三上半身二次元素体精细预览、连续改变腰宽、自然站立姿势、GLB 下载完成。GLB 声明大小与实际均为 4,504,156 字节，包含一个 mesh；界面报告一个连通块。操作期间无 pageerror；页面有一个 favicon.ico 404。
- 截图：fusion-optimized.png（当前模型与姿势的可视检查，不是新旧同视角比较；新旧几何一致性以数组对照为证）。

## 投影试验结论

最多两次三线性零面投影，限制在原格子内、最大位移四分之一体素，跳过补实过的块。普通白模、二次元素体、双头双胯没有改变面连接且无反转；三上半身模型的缝合面连接发生变化。因此未在产品启用，也不声称本轮改善表面形状。保留 tools/probe-fusion-projection.mjs 供继续定位接缝变化；它只在离线 Vite 加载时注入候选实现。

## 重跑

从项目根目录运行：

```powershell
node tools/bench-fusion.mjs --save "$env:TEMP\oc-fusion-current.bin"
node tools/probe-fusion-projection.mjs "$env:TEMP\oc-fusion-current.bin"
```

bench-fusion.mjs 支持 --baseline <源码快照目录>（fork.ts、grids.ts、surfaceNets.ts）及 --compare <之前 --save 的文件>，对照不一致或位置偏差超过 1e-6 时退出码为 1。测量时关闭其他重负载任务，交替复测后再判断小于 5% 的变化。回退应只撤销本轮差异，grids.ts 原本已有未提交修改，不能整体 checkout/reset。


后续造型优化：见 [二次元素体曲面校正](anime-quality.md)。旧的缝合前投影仍未启用；后续使用缝合后、锁定接缝的校正方式。
