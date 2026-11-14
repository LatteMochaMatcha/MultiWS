# 给代理看的项目规矩

OC 白模工坊 v2：多肢体角色白模生成器（Vite + TypeScript + three.js，距离场融合）。用中文交流、写注释；改代码照周围代码的写法（命名、注释密度、写法）。

## 常用命令

- 类型检查：`npx tsc --noEmit`
- 测试：`npx vitest run`（全套约 1–2 分钟）；单个文件 `npx vitest run tests/bust.test.ts`
- 跑 tools 里的 TS 脚本（Vite SSR 加载，能 import src）：`node tools/run.mjs tools/<脚本>.ts <参数>`
- 验收图：`npm run accept -- <输出目录> --only S1`（说明见 docs/accept/README.md）；拼总图 `uv run -q --with pillow python -I tools/accept-sheet.py <输出目录> --title <标题>`
- Python 一律用 `uv run`（系统 python 是商店版 3.11）。
- 界面有中、英、日三语：给用户看的中文用 `t('…')` 包（`src/i18n`），英文、日文译文补进 `src/i18n/en/*.json`、`src/i18n/ja/*.json`，再跑 `npx vitest run tests/i18n.test.ts`；改了解析器或规范描述再跑 `tests/parseI18n.test.ts`。规矩和术语表见 `docs/i18n.md`。

## 环境

- Windows。沙箱里 Git Bash 会挂（`CreateFileMapping ... error 5`），用 PowerShell 命令。
- 路径含中文：命令里路径加引号；Python 读写文件写 `encoding="utf-8"`。
- 临时文件、渲染图放 `.harness-tmp/`（不进仓库）。

## 不要做的

- 不做任何 git 写操作（add、commit、checkout、restore、stash、reset、branch）；看状态用 `git --no-optional-locks status` / `diff`。提交由主线会话做。
- 不改 `assets/source/`（素材原件）、`refs/`（别人的画，只能看，不能复制进仓库）。
- 不下载新素材。
- 只删 `.harness-tmp/` 里自己的临时文件；进程一概不碰（开发服务器是用户在用的）。

## 仓库和本地文件的规矩

- 渲染图、前后对比图放 `.harness-tmp/`，不进仓库。要进 `docs/` 的图必须被某份 md 引用、一张缩到 300 KB 以内；没有文档引用的图不提交（仓库里已经有 170 MB 图，别再加）。
- `release/` 在本地（.gitignore 里），只留最近两版的安装包和加密 zip（现在是 2.7.8、2.8），发新版时把更老的移到回收站；`release/update/`（发自动更新的产物）和三份说明 txt 留着。
- 仓库在 GitHub 上叫 `LatteMochaMatcha/MultiWS`（2026-11-08 从打错的 MutliWS 改的，旧名会跳转）；写地址用新名。
- `CHANGELOG.md` 会打包进工坊，每次打开时弹给用户看（`src/view/changelog.ts`，只认「## 版本（日期）」「### 小标题」「- 一条」「**一行粗体**」这几种写法，`tests/changelog.test.ts` 会查）。还没发的改动写在最上面的「## 下一个版本号（未发布）」里，用给用户看的话写；发版时把「未发布」换成日期。

## 背景文档

- `README.md`：给用户看的精简说明；各项做法的细节看 `docs/` 里的计划和代码注释。
- `docs/` 里的方案文档：正文是写文档那天的叙述，分期、「待做」「等你定」都可能过时；每份开头的「现状（2026-11-09）」一段写的是实际进度，先看它。分支 `rework/torso-bust` 从 11-02 起一直当主线用，推上 GitHub main，版本到 2.7.6（2026-11-08）。索引：

| 文档 | 讲什么 | 状态（2026-11-09） |
|---|---|---|
| `docs/rework-plan.md` | 胸、多上半身、多胯换做法（二次元素体）：七期计划，每期做成什么，之后修的 | 七期 11-02 做完（fde1a56），之后修修补补到 11-08（扭躯干 1076cbb） |
| `docs/accept/README.md` | 验收图怎么出；`docs/accept/` 各目录是哪一期 | 在用 |
| `docs/bust-reference.md` | 11-01 用 DJP 素材换胸型的旧做法 | 已作废（rework 第 3 期删了那套格子） |
| `docs/anime-quality.md` | 二次元素体网格表面校正（`sdf/surfaceQuality.ts`） | 做完，在用 |
| `docs/fusion-optimization.md` | 11-01 融合提速（分叉缓存、Surface Nets 查表） | 做完，在用 |
| `docs/perf-plan.md` | 拖动卡顿优化：量法、分期、每期结果 | 第 0–4 期做完（d058630）；只剩 3c 显卡蒙皮、撤销不再整份比较两条 |
| `docs/genital-plan.md` | 多阴茎（成人部件，默认关） | 五期做完并合入主线（8cccbaa）；疲软形态、关掉只藏不删后来也做了 |
| `docs/per-torso-plan.md` | 每个上半身单独设数量；每个上半身换成别的角色（男女连体） | 做完（d8cc35f、73476c8、d37ed65），成品角色也做了 |
| `docs/vrm-plan.md` | 导出 VRM 0.x 四期；成品角色许可表 | 四期做完（a2a68a0…74ce48f）；VRM 1.0 导出没做 |
| `docs/i18n.md` | 中英日三语：包字符串和翻译的规矩、术语表 | 做完并合入（e4c527d）；加界面文字时照它 |
| `docs/agent-monitor.md` | 开发服务器 `/__agent/` 监控接口、问题单（画红圈） | 在用 |
| `docs/mobile-ui-plan.md` | 手机竖屏界面重做（抽屉、一次一栏） | 做完（ae718cc）；11-10 抽屉改成照内容定高；长按连加、摆姿势竖屏按身高取景没做 |
| `docs/pc-ui-plan.md` | 电脑端界面重做（顶栏 + 栏目条） | 做完并合入（0b5a7e4、fa5df23）；11-10 栏目并成 6 组、配置进「⋯」菜单 |
| `docs/update-plan.md` | 软件内自动更新（R2 + GitHub，签名清单，exe/apk 外壳） | 第 0–5 期做完，2.7.3 起带自动更新；10 分钟检查的新外壳还没随 `-Installers` 发出 |
| `docs/scene-plan.md` | 一个场景里放好几个角色；肢体互动、双人动作 | 做完，随 2.7.5 发布（3cc91d2）；三人以上的双人动作、replay 整个场景没做 |
| `docs/digits-plan.md` | 手指、脚趾数量，手脚互换，queen 连体 | 六期做完（aab6517）；连体侧躺后来又改（efb795d、c942f57）；连体两个上半身各设头数没做 |
| `docs/audit-plan.md` | 11-09 全项目只读审计：冲突、缺失、文档核对、分期建议 | 审计结果，照它收拾中 |
| `docs/ring-plan.md` | 围成一圈（几个人背靠背融合成一个身子，两种模式） | 四期做完，随 2.8 发布：两种模式、两侧手臂、胸交错成串、圈心底下的腿、套姿势和导出；还在的毛病见文末 |
| `docs/agent-plan.md` | 内置 AI 助手和运行框架（用 pi 做底子，用户自己填钥匙） | 第 1 期（改造型、单独的窗口、圈出来、微调部件）随 2.8 发布；第 2 期摆姿势、第 3 期场景和参考图没做；apk 的转发没在设备上跑过 |
