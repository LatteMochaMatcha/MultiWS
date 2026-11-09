# 全项目总览：冲突、缺失与清理计划（2026-11-09）

只读审了一遍主目录 `F:\Downloads\多tool`（分支 `rework/torso-bust`，= `origin/main` 5dff981 = GitHub Release v2.7.6）。审的时候代码没改，git 没动；用户看完说「一到四期都做」，做了什么见下一节。

## 执行记录（2026-11-09 晚）

用户定的：一到四期都做，第五期（立规矩）没做。顺序改成 1a → 4 → 2 → 3 → 1b，让 2.7.7 把第 2、4 期也带上。

- **第 1 期 a**：`PosedMeshes.bounds()` 空包围盒补了测试，修复提交 f6a0595。
- **第 4 期**（152a549）：figure.ts、grids.ts 四句报错包上 `t()`（译文本来就有）；删三条死译文；`tests/i18n.test.ts` 加「译文里没有源码已经不用的键」；VRM 1.0 转 0.x 的许可条款照界面语言；删九个无用导出（POSE_NAME_KEYS 留着，见上）。`main.ts` 的「开发提示」复核后不用改。
- **第 2 期**：README 三语补齐（英日各补五段，三语都补「检查更新」「初始化」、造型 W / E / R；英日「撤销在左下」的旧说法改成顶栏）；AGENTS.md 进度段改掉、加 docs/ 索引表；十四份方案文档各加「现状（2026-11-09）」并把误导句子加注或改掉（第四节逐条）；bust-reference 加作废说明；accept/README 加 overview-1105。
- **第 3 期**：`.gitattributes` 加 `* text=auto eol=lf`，工作区 152 个 CRLF / 混用文件改成 LF（索引本来就是 LF，git 看不出差别）；`git fetch --tags` 补上本地 v2.7.6；本地 `main` 快进到 5dff981；`snapshot/2026-11-01-before-rework` 分支转成同名 tag 后删掉；五个已合并分支删掉；三个 worktree 先拆 node_modules 联接再 `git worktree remove`；`oc-basemesh-v1.html` 移到 `docs/`；`x/` 删；根目录那个 VRM 和 `assets/source/hub_fritz/` 里的 sha256 一样，删了副本。
- **第 1 期 b**：版本号 2.7.7、CHANGELOG；exe / apk 重打（exe 用 `--no-browser --port 5299 --state 临时目录` 试跑，内置清单 2.7.7、47 个文件，首页 200）；自动更新、GitHub Release、加密 zip 见文末「发版记录」。
- **没做**：第 5 期两条规矩（对比图不进仓库 / LFS；`release/` 本地只留最近两版）；第四节末尾七条功能待办；CHANGELOG 没补 2.7.2 以前。
- **子代理核对后纠正本文的**：胸上限不是「三个数」——`spec.ts` 素体滑块 2.3、人台/成品 `BUST_MAX_OTHER` 2.2，accept/README 的 2.3 和代码一致，只有 rework-plan 表格的「→ 3」过时；feature/*、ui/* 分支在审计时还在，现在已删。

## 现状快照

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| `npx vitest run` | 67 个文件、1837 个测试全过（82 s） |
| 版本一致性 | `package.json` 2.7.6 = `origin/main` = GitHub Release v2.7.6（Latest，三个安装包齐）= R2 和 GitHub `update-store` 上的 `latest.json` 2.7.6（签名文件同时间）。一致 |
| 依赖 | `package-lock.json` 和装着的版本一致（three 0.186.1、vite 8.3.2、vitest 5.0.3、typescript 7.0.2） |
| 工作区 | 2 个文件没提交；根目录多一个没进 git 的 14 MB VRM |
| 问题单 | `notes/` 最新一张（11-08 queen conjoined 侧躺）对应的修法已随 efb795d 提交 |

## 一、冲突 / 对不上的地方

### 1. 2.7.6 带着一个已修但没提交的 bug（高）
- `src/view/posedMeshes.ts`、`src/view/viewport.ts` 各几行没提交：连体没有腿时裤子、鞋的网格是 0 个顶点，空包围盒并进来成了 −∞…+∞，阴影相机和镜头算成 NaN，摆姿势时 3D 视图全空、影子没了（11-09 修的）。
- 发出去的 2.7.6 没有这个修复；`tests/posedMeshes.test.ts` 也没有覆盖这条。

### 2. 本地 `main` 落后（低）
- 本地 `main` 停在 3cc91d2（2.7.5），`origin/main` 和 `rework/torso-bust` 在 5dff981（2.7.6）。日常都在 `rework/torso-bust` 上干活、再推到 `origin/main`，本地 `main` 一直没跟上。

### 3. 三语 README 不同步（中）
`README.md`、`README.en.md`、`README.ja.md` 最后一次都是 0e9020c 改的，但内容已经错位：

| 内容 | zh | en | ja |
|---|---|---|---|
| 排布 →「手脚互换」 | 有（123 行） | 无 | 无 |
| 排布 →「连体（queen conjoined）」 | 有（124 行） | 无 | 无 |
| 排布 →「每条手臂、腿单独设」 | 有（125 行） | 无 | 无 |
| 摆姿势 →「脚踩到地上」 | 有（252 行） | 无 | 无（247 行「地面に下ろす」是 251 行「落到地面」的译文，不是这条） |
| 手 → 手指 3–8 根、二次元素体脚趾 2–8 个（2.7.5） | 有（122 行） | 无（133 行只到「并指」） | 无（121 行同） |
| 顶栏「初始化」按钮（2.7.6） | 无 | 无 | 无 |
| 造型时 W / E / R 切换移动、旋转、缩放（2.7.6） | 无 | 无 | 无 |

en、ja 各缺五段（2.7.4、2.7.5 的功能：手指脚趾数、手脚互换、连体、每条单独设、脚踩到地上）；2.7.6 的两项三语都缺。另：`README.md` 现在 453 行，和「README 保持精简（11-03 精简到 300 行）」的规矩渐渐偏离，这次只补缺、不再加长。

### 4. 换行符没定规矩（中）
- 全局 `core.autocrlf=true`，仓库 `.gitattributes` 只有 `*.bin binary`，没有 `text`/`eol` 规则。
- `git ls-files --eol`：163 个文件工作区 LF、145 个文件工作区 CRLF（索引里全是 LF），`.gitignore` 和 `docs/per-torso-plan.md` 一个文件里混用。每次 `git diff` 都报「LF will be replaced by CRLF」。
- 不同会话、不同工具（Codex、脚本）写出的文件换行不一样，是以后合并时冒出整文件 diff 的隐患。

### 5. 文档说法和代码对不上
（见下面「文档核对」一节，由子代理逐份核对。）

## 二、缺失

1. **测试**：空包围盒的修复没有测试；`src/view/` 这一层基本没有测试（DOM/three 相关，可接受，但 `PosedMeshes.bounds()` 是纯几何，能测）。
2. **CHANGELOG** 只从 2.7.3 起，2.7.2 及以前没有条目（GitHub Release v2.7、v2.7.2 都发过）。
3. **README** 缺 2.7.6 的两项（见上表）。
4. **没人用的导出**（10 个，`src/` 里导出了、全项目没有任何引用）：`anime/body.ts` animeCaps、`anime/genital.ts` PENIS_LENGTH、`anime/swap.ts` ANKLE_HEIGHT、`character/face.ts` expressionKeys、`geometry/genital.ts` genitalCount、`io/glbRead.ts` accessorSize、`model/spec.ts` totalHeads 和 SHAPE_KEYS、`parser/index.ts` type Chip、`pose/library.ts` POSE_NAME_KEYS（这一个是故意的：把姿势名登记成键给抽键脚本看，留着）。另有 128 个导出只在本文件里用（多余的 `export`），噪音大、收益小，建议不动。
5. **i18n 漏包**（扫 `src/` 里没包 `t()`/`tk()` 的中文字符串，去掉解析表、描述表、开发工具后剩这些）：
   - `src/main.ts:1670`「开发提示：N 处穿模（…）」进读数区——复核：整个穿模检查在 `import.meta.env.DEV` 里，打包版不跑，问题单里看到是因为那是开发服务器。不用改。
   - `src/sdf/grids.ts:33,42,473` 三句和 `src/geometry/figure.ts:512` 一句 `throw`（docs/i18n.md 记的「四句先不包」，一句没少）。
   - `src/io/vrm.ts:362`「原文件（VRM 1.0）的条件：…」写进导出 VRM 的 meta.reference，日文、英文界面导出的文件里也是中文。
   - `src/update/manifest.ts` 22 句错误信息：`update/ui.ts:122` 的 catch 吞掉不显示，可不管。
   - `node tools/i18n-keys.mjs`：1051 个键译文齐全，但有 7 条译文没人用：`io.json` 三条「格子 {name} …」和 `model.json`「部件 {name} 的父部件 …」正是上面那四句（译文早就补了，源码没包 `t()`，包上就对上了）；`html.json`「把 3D 视图放大到整屏…」「放大」、`main-1.json`「还原」三条在 `index.html`、`src/` 里都已没有对应文字（界面重构时拿掉的「放大到整屏」按钮），是死译文，删掉即可。`tests/i18n.test.ts` 不查「译文没人用」，所以一直没发现。
6. **仓库体积策略**：pack 313 MB。`docs/` 里 213 张图 170 MB 进了 git，其中 97 张（87 MB）没有任何 md 引用（都是当时给用户看的前后对比图）；`public/character/` 16 个 VRM 105 MB。历史里已经在了，删文件不缩历史；要定的是以后的规矩（对比图放 `.harness-tmp/` 或 `notes/`，不进仓库；或大文件走 LFS）。

## 三、残留 / 清理

1. **已合并的分支**（`git branch --merged HEAD` 全部）：`feature/i18n`、`feature/multi-genital`、`feature/scene`、`ui/desktop`、`ui/mobile`；`snapshot/2026-11-01-before-rework` 是返工前的回退点，返工七期做完且已发版多轮，留着意义不大（可转成 tag 再删分支）。
2. **三个 worktree 已合并且干净**：`F:\Downloads\多tool-desk`（ui/desktop）、`多tool-mobile`（ui/mobile）、`多tool-scene`（feature/scene）。每个里面的 `node_modules` 是指向主目录 `node_modules` 的 junction —— **先 `cmd /c rmdir` 拆掉联接，再 `git worktree remove`**，否则会顺着联接删主目录的依赖。
3. **根目录杂物**：`oc-basemesh-v1.html`（v1 的旧单文件，40 KB，进了 git，没有任何引用）；`340860444786907840.vrm`（14 MB，11-07 下的，没进 git 也没忽略，疑似 VRoid Hub 原件——该进 `assets/source/`，或删）；`x/` 空目录。
4. **本地占盘**（都已 ignore）：`release/` 2.0 GB（v2.5 到 2.7.6 每版的 exe/apk/zip 全留着）、`.harness-tmp/` 572 MB、`dist/` 112 MB。
5. **旧目录** `C:\Users\45082\Downloads\多tool` 只剩 `node_modules` 和 `.claude`（10-07 搬家到 F 盘的残留，本会话一开始就开在那里）。

## 四、文档核对（docs/*.md、AGENTS.md、CHANGELOG.md 对照代码和 git 历史）

每条：文档位置 — 文档怎么说 — 实际怎样。只列对不上的，对得上的不列。

### 文档说「没做」，代码其实做了（最容易误导下一个会话）
- `docs/genital-plan.md:216` — 疲软形态「这次先不做」 — 已做：`spec.ts` penisSoft、`geometry/genital.ts` SOFT_SIZE/SOFT_HANG、面板「软硬一键换」（a6222ee），README 215 行也写了。
- `docs/genital-plan.md:74/178/211` — 关掉开关「一律去掉，大小、姿势、微调不留」 — 现在是只藏不删（`model/adult.ts` keepAdult/restoreAdult），README 215 行写的是「再打开时原样回来」。
- `docs/scene-plan.md:72-75/108/131` — 「以后再说：互动、双人姿势」「没做：B 多出来的手臂跟着动」 — 同一文档 120–140 行和代码（PAIR_PRESETS、solvePair、pushOut、followPair/extraArms）都已做，前面的标题没改。
- `docs/per-torso-plan.md:9/38` — 「成品角色还是每个上半身一样多」「没做：成品角色」 — 同文档 44 行 11-04 已做（73476c8）。
- `docs/mobile-ui-plan.md:127` — 「手机横屏还是左右两栏，这次没做」「安卓安装包没重打」 — pc-ui 那期已让横屏用栏目条（0b5a7e4）；apk 从 2.7.3 起重打多次。
- `docs/digits-plan.md:99` — `lineUp` 在 conjoined.ts、conjoin.ts「同名两份」 — c942f57 已抽成 `src/geometry/lieLine.ts` 共用。

### 文档说「做了」，代码里是另一种做法或找不到
- `docs/scene-plan.md:49` — 新角色「照包围盒找空地，间隔 30 cm」 — 实际一律站在右手边（main.ts:4491、index.html:430）。
- `docs/scene-plan.md:44` — 读数加「场景合计」 — 代码里没有。
- `docs/scene-plan.md:69` — 同一成品角色用几次时贴图共用 — `scene/bake.ts` 里查不到，待确认。
- `docs/mobile-ui-plan.md:67` — 加减号按住不放连着加 — 代码里没有。
- `docs/pc-ui-plan.md:91` — 「没验：exe（Electron 外壳）」 — exe 是 .NET 的 `tools/launcher/Launcher.cs`，项目里没有 Electron；和 update-plan 的说法也冲突。

### 文档内部前后矛盾
- `docs/rework-plan.md:18` 表格「滑块上限 2.2 → 3」 vs 同文档 85/92 行锁到 2.3；代码 `spec.ts:141` BUST_MAX_OTHER=2.2，`docs/accept/README.md:11` 写 2.3。三个数。
- `docs/rework-plan.md:260-266` 「还没定的」三项（里侧手臂、胯宽 1.25、2.2 以上用大胸型） — 第 5 期都已定（136–138 行）。
- `docs/rework-plan.md:159/167` 「删掉 seat/SEAT_IN/SEAT_RISE」 — 已删，但 `torsos.ts:120` 11-03 又加了一套新的 `SEAT`（5f2461c），文档没记，容易和「删掉」混。
- `docs/update-plan.md:94/182` 检查间隔「一天一次」「20 小时」 vs 347 行已改 10 分钟（Updater.cs:152、Updater.java:56）。
- `docs/update-plan.md:161/164` 内置清单叫 `builtin.json` vs 实际 `update-manifest.json`（41/139 行、Updater.cs:30）。
- `docs/update-plan.md:175` 「ShellVersion = 1 写在代码里」 vs 实际来自 `tools/update/config.json`（305 行自己说了）。
- `docs/digits-plan.md:136-137` 分期表手指 2–8、脚趾 1–8 vs 33/39 行实际 3–8、2–8。
- `docs/i18n.md:147` 「四句报错先不包」 — figure.ts:512 一句、grids.ts:33/42/473 三句确实还没包；而四句的英日译文早就在 `model.json`、`io.json` 里（就是上面「7 条没人用的译文」里的 4 条），阻碍原因（分支没合）已不存在。

### 整段过时（状态/进度段落停在写文档那天）
- `AGENTS.md:29` — rework-plan「现在在第 3 期之后」 — 七期 11-02 全做完，之后又 70 多个提交。`AGENTS.md:27-30` 背景文档只列两份，docs/ 里另有 12 份方案没有索引。
- `docs/update-plan.md:3` 「还没开工」、12–20 行「现状」（package.json 2.0.0、exe 不联网、十个角色）、125 行「R2 桶里只有测速文件」、262 行「apk 等第 3 期接上」 — 五期全做完，2.7.3–2.7.6 都发了。
- `docs/genital-plan.md:3-4/166/169` — worktree、「main 停在 b05f1db」「推不推等你定」 — worktree 已删、已推。
- `docs/scene-plan.md:110` 「版本号还是 2.7.4 没发布」 — 2.7.5 已带场景发布。
- `docs/digits-plan.md:160-165` 「要用户定的」 — 82 行已定。
- `docs/per-torso-plan.md:48` 「先下了两个男生」 — 现在六个（d37ed65）。
- `docs/vrm-plan.md:52-62` 许可表「查过十个角色」 — 现在 16 个，六个男生的许可没入表。
- `docs/i18n.md:3/128` — worktree 已删、「十个成品角色」已 16 个；39–128 行术语表没有 11-05 之后的新词（场景、连体、手指/脚趾、检查更新、初始化、软硬）。
- `docs/agent-monitor.md:45-56` 「快照里有什么」没有 `scene`（agentBridge.ts 已带）；98 行没说 replay 只摆当前角色。
- `docs/pc-ui-plan.md:79` 「合回主目录前先等」 — 已合（fa5df23）；顶栏后来加的「初始化」没提。
- `docs/bust-reference.md` 整篇讲的 bustReference/bustLarge 格子第 3 期已删（build-chest.ts:979-986），文件头没有「已作废」。
- `docs/accept/README.md` 表格缺 `overview-1105`。
- 11-09 的空包围盒修复（posedMeshes.ts、viewport.ts）哪份文档、CHANGELOG 都没记。

### README 三语都没有的功能说明
- 「检查更新 / 自动更新」（2.7.3 起的功能，只在 CHANGELOG 里）；「初始化」按钮；造型 W/E/R（见第一节第 3 条）。

### 版本标签
- GitHub 上 v2.7.6 标签在（指向 5dff981），本地没拉下来（本地只到 v2.7.5）：`git fetch --tags` 即可。

### 文档明确写了待做、代码确实还没有（真正的待办，供排期）
1. `perf-plan.md:65` 3c 显卡蒙皮；`:30` 撤销不再用 JSON.stringify 整份比较（main.ts:372）。
2. `update-plan.md:347` 新外壳（10 分钟检查）还没随 `-Installers` 发出（config.json shell 仍 1）；`:332` exe 换安装包时黑窗口闪一下。
3. `digits-plan.md:102` 连体两个上半身各设头数、手臂数；`:121` 白模脚带脚趾选项（等用户定）。
4. `scene-plan.md:108` 问题单 replay 整个场景；`:131` 三人以上的双人动作；`:144` 三对手臂的勾肩搭背/拥抱仍穿插。
5. `vrm-plan.md:17` VRM 1.0 导出；带旋转的 1.0 文件读入。
6. `mobile-ui-plan.md:127` 摆姿势竖屏按身高取景。
7. `per-torso-plan.md:58` 换上去的脸的表情、视线。

## 五、分期计划（建议顺序）

| 期 | 做什么 | 要用户定的 |
|---|---|---|
| 1 修复发版 | 给 `PosedMeshes.bounds()` 空包围盒补测试 → 提交两文件 → 版本 2.7.7、CHANGELOG → `npm run release` 发自动更新 + GitHub Release + 加密 zip | 要不要现在发 2.7.7（还是等再攒几项） |
| 2 文档对齐 | en、ja README 补齐五段，三语补「检查更新」「初始化」、W/E/R；AGENTS.md 进度段 + 文档索引；第四节列的每处过时/矛盾段落逐条改（主要是 update-plan、genital-plan、scene-plan、rework-plan、digits-plan、per-torso-plan、i18n.md 术语表、vrm-plan 六个男生许可、bust-reference 加作废说明、accept/README 加 overview-1105）；CHANGELOG 补 2.7.2 以前（可选） | CHANGELOG 要不要补旧版；过时的方案文档是逐段改，还是每份文件头加一段「现状（11-09）」、正文留作历史 |
| 3 仓库卫生 | `.gitattributes` 加 `* text=auto eol=lf`，`git add --renormalize .` 一次提交（只换行、内容不变）；`git fetch --tags` 补本地 v2.7.6；fast-forward 本地 `main`；删 5 个已合并分支；拆联接后删 3 个 worktree；`oc-basemesh-v1.html` 移到 `docs/` 或删；`x/` 删 | snapshot 分支转 tag 还是留；`.vrm` 原件怎么处理 |
| 4 代码卫生 | 包上 figure.ts、grids.ts 四句（译文已有）、删 3 条死译文、`tests/i18n.test.ts` 加一条「译文没人用」；main.ts 开发提示、vrm.ts meta 两处；删 10 个无用导出 | 「开发提示」是包 `t()` 还是只在开发时显示 |
| 5 规矩 | 对比图不进仓库（或 LFS）；`release/` 本地只留最近两版；写进 AGENTS.md | 两条规矩要不要立 |

每期都能单独做、单独提交；第 1 期最急，第 3 期的 renormalize 会碰到几乎所有文件，要在别的会话没有未提交改动时做。第四节末尾「真正的待办」七条不在这五期里，是功能，另排。

## 发版记录（2026-11-09 晚，2.7.7）

- 提交：f6a0595（修复）、152a549（第 4 期）、fdef7b9（换行、v1 网页）、1494f05（文档）、f7a7327（版本号 2.7.7）；本地 `main` 快进到同处，推上 GitHub main。全套测试 1839 个通过。
- 安装包：`npm run pack`、`npm run apk` 打在 `release/`（OC白模工坊.exe / .apk / -v2.zip）；exe 用 `--no-browser --port 5299 --state 临时目录` 试跑，内置清单 2.7.7、47 个文件，首页 200。apk 没在模拟器上试（和 2.7.5、2.7.6 一样）。
- 自动更新：`tools/release.ps1 -SkipBuild`（外壳没改，不带 `-Installers`），R2 和 GitHub `update-store` 两边 `latest.json` 都是 2.7.7、同一份（sha256 比过）。
- GitHub Release v2.7.7（Latest，标签指 f7a7327，三个英文名文件，GitHub 记的 sha256 和本地一样）。
- 加密 zip：`多x白模工坊2.7.7 密码：exe.zip`、`多x白模工坊 V2.7.7 密码：apk.zip`（AES-256，pyzipper 做的，解开核对过）。
- 顺带发现：GitHub 仓库已改名 `LatteMochaMatcha/MultiWS`（旧名 MutliWS 自动跳转）。本地 `origin` 改成了新地址；`tools/update/config.json` 的 `githubRepo` 和更新源地址、README 里的仓库链接还是旧名，靠跳转在用——改它要重打外壳，另排。
