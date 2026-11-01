# 给代理看的项目规矩

OC 白模工坊 v2：多肢体角色白模生成器（Vite + TypeScript + three.js，距离场融合）。用中文交流、写注释；改代码照周围代码的写法（命名、注释密度、写法）。

## 常用命令

- 类型检查：`npx tsc --noEmit`
- 测试：`npx vitest run`（全套约 1–2 分钟）；单个文件 `npx vitest run tests/bust.test.ts`
- 跑 tools 里的 TS 脚本（Vite SSR 加载，能 import src）：`node tools/run.mjs tools/<脚本>.ts <参数>`
- 验收图：`npm run accept -- <输出目录> --only S1`（说明见 docs/accept/README.md）；拼总图 `uv run -q --with pillow python -I tools/accept-sheet.py <输出目录> --title <标题>`
- Python 一律用 `uv run`（系统 python 是商店版 3.11）。

## 环境

- Windows。沙箱里 Git Bash 会挂（`CreateFileMapping ... error 5`），用 PowerShell 命令。
- 路径含中文：命令里路径加引号；Python 读写文件写 `encoding="utf-8"`。
- 临时文件、渲染图放 `.harness-tmp/`（不进仓库）。

## 不要做的

- 不做任何 git 写操作（add、commit、checkout、restore、stash、reset、branch）；看状态用 `git --no-optional-locks status` / `diff`。提交由主线会话做。
- 不改 `assets/source/`（素材原件）、`refs/`（别人的画，只能看，不能复制进仓库）。
- 不下载新素材。
- 只删 `.harness-tmp/` 里自己的临时文件；进程一概不碰（开发服务器是用户在用的）。

## 背景文档

- `docs/rework-plan.md`：胸、多上半身、多胯换做法的计划和每期做了什么（现在在第 3 期之后）。
- `README.md`：功能说明（胸、多上半身那几段还是旧的，第 7 期重写）。
