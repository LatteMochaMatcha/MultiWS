# 监控测试接口（给 agent 用）

开发服务器（`npm run serve` / `npm run dev`）上多了一组 `/__agent/` 接口：agent 用 `curl` 或 `npm run agent -- 命令` 就能读到**页面里正在跑的模型**和**开发服务器自己的状态**，也能在页面里跑一段代码、截 3D 视图，不用开浏览器工具，浏览器面板藏着也行。

只在开发服务器上有。`npm run build`、`npm run pack` 打出来的网页、exe、apk 里都没有它（插件只在 `serve` 时生效，页面那一头也只在开发时注入）。

## 怎么用

```bash
npm run agent -- model                         # 页面里现在的模型
npm run agent -- eval "oc.spec().counts"       # 在页面里跑一段 JS
npm run agent -- shot front.png --view front   # 截 3D 视图
npm run agent -- logs --errors                 # 出错的日志
npm run agent                                  # 全部命令
```

`npm run agent -- …` 和 `node tools/agent.mjs …` 一样。它会自己在本机 5173–5179 上找开着的工坊开发服务器（`servers` 命令列出全部）；要指定就用 `--url http://localhost:5174` 或环境变量 `OC_AGENT_URL`。

不用脚本也行，接口都是普通的 HTTP：

```bash
curl http://localhost:5173/__agent/                  # 接口一览
curl http://localhost:5173/__agent/model
curl -X POST --data "oc.spec().counts" http://localhost:5173/__agent/eval
curl -o shot.png "http://localhost:5173/__agent/screenshot?view=side"
```

## 接口

| 接口 | 做什么 |
| --- | --- |
| `GET /__agent/` | 接口一览 |
| `GET /__agent/server` | 开发服务器：进程号、Node / Vite 版本、地址、运行多久、内存、连着几个页面、日志里几条出错和警告、最近改过的文件 |
| `GET /__agent/pages` | 连着服务器的页面：id、地址、在不在前台、有没有焦点、多少秒没人动过（`lastInputSec`）、模型的摘要 |
| `GET /__agent/model` | 页面里现在的模型（实时问页面）。页面没回话（在后台被压慢、正忙着算）就给它最后一次报上来的快照，带 `stale: true` 和原因。`?cached=1` 直接要快照 |
| `GET /__agent/spec` | 只要设定（`BodySpec`） |
| `GET /__agent/settle` | 等模型算完（签名连着 `quiet` 毫秒不变、读数不是「正在生成」、不是拖动时的粗网格）再给快照。`?quiet=600&timeout=30000` |
| `GET /__agent/screenshot` | 3D 视图的 PNG（透明背景，不带地上的参照圈和操纵杆）。`?view=front\|side\|back\|three\|right\|top\|bottom`、`&width=&height=`；画完把镜头、画布大小还原，用户看着的画面不变。页面藏着（画布是 0 宽）时临时按 900×1200 画 |
| `GET /__agent/history` | 最近的模型变化：哪个页面、什么时候、哪几项变成了什么（描述、身体样式、读数、警告、三角面数、网格分成几块……）。`?limit=` |
| `GET /__agent/logs` | 服务器的输出（热更新、编译出错）和页面的控制台（`console.*`、没接住的异常）。`?level=error\|warn\|info`、`&source=server\|page`、`&since=序号`（只看新的）、`&limit=` |
| `POST /__agent/eval` | 请求体是一段 JS，在页面里跑，回结果（见下面） |

通用参数：`?page=` 选页面（id 的开头几位就行）；`?timeout=` 等页面回话多久（毫秒，缺省 15 秒）。

## 快照里有什么

`/model` 回的是：

- `mode`：`shape`（造型）还是 `pose`（摆姿势）
- `description`：描述框里的字；`readout`：左上角的读数一格一格；`warnings`：读数后面橙色的那几条（网格断开、开发时的穿模提示）；`status`：底下状态栏的字
- `mesh`：屏幕上的融合网格（白模、素体在「融合」模式下）——三角面、顶点、分成几块（`components`，正常是 1）、体素大小、是不是拖动时的粗网格（`draft`）/ 摆姿势时的细网格（`fine`）、长宽高
- `figure`：摆位结果——缩放、身高和头身比、各类部件几个、全部部件名
- `character`：成品角色——骨骼、网格、材质、脸各几个，这个样式顾不上的设定
- `pose`：摆姿势时骨骼、圆点各几个；`selected`：选中的部件；`camera`：镜头；`buildMs`：上次重建在主线程上花了多久
- `spec`：完整的设定
- `pageInfo`：这是哪个页面（id、地址、在不在前台、大小、浏览器）

## eval 里能用什么

代码能写成一个表达式就当表达式（`oc.spec().counts`）；不行就当函数体，自己写 `return`（`const n = oc.figure().parts.length; return n`）。可以 `await`。能直接用的：

- `oc`：就是 `window.__oc`，`src/main.ts` 末尾开发时挂上去的那一套：`spec()`、`set({…})`、`figure()`、`character()`、`fusedStats()`、`rebuild()`、`mode()` / `setMode()`、`select()`、`pose.drag()` / `pose.gesture()`、`viewport`……
- `settle({ quiet, timeout })`：等模型算完，回快照
- `snapshot()`：现在的快照
- `toPlain(值)`：把值变成能 JSON 的样子（回结果时会自动做一次：three 的向量写成数组，类型数组只写类型、长度和前几个数，绕回自己的引用截断）

例子：

```bash
npm run agent -- eval "oc.set({ counts: { ...oc.spec().counts, heads: 3, tails: 2 } }); return await settle()"
npm run agent -- eval "oc.set({ bodyStyle: 'anime' }); const s = await settle(); return s.snapshot.mesh"
npm run agent -- eval -f 我的检查.js
```

`settle()` 在标签页藏着时会先替它 `oc.rebuild()` 一次：藏着的标签页里 `requestAnimationFrame` 不跑，改了设定不会自己重建。

## 别动用户正在用的页面

几个页面连着时，缺省选**在前台、有焦点、最近有人动过**的那个——通常就是用户自己正在用的。读（`model`、`logs`、`screenshot`）不改任何东西；**`eval` 里改设定、换模式会直接改到那个页面上**，用户看得见，设定也会存进那个浏览器。

要改东西测试，先自己开一个标签页，在 `pages` 里认出它（`lastInputSec` 是 `null` 或很大、`visible` 是你的那个），用 `--page <id>` 指定它。页面的 id 存在那个标签页的 sessionStorage 里，刷新以后不变。

## 安全

- 只接受本机来的请求（`127.0.0.1` / `::1`），`Host` 必须是 `localhost` 这类本机地址。
- 带着别的网站的 `Origin`、或者 `Sec-Fetch-Site: cross-site` 的请求一律拒绝：别的网页不能借用户的浏览器来调 `eval`。
- 开发服务器本来就只听本机。不要用 `--host` 把它开到局域网上再指望这些接口能用（会被拒绝）。

## 代码在哪

| 路径 | 内容 |
| --- | --- |
| `tools/agent-monitor/plugin.mjs` | Vite 插件，服务器那一头：HTTP 接口、日志和改过的文件、转请求给页面 |
| `src/dev/agentBridge.ts` | 页面那一头：插件开发时塞进 `index.html`；借 Vite 的 HMR 连接报快照、转日志、替接口跑代码和截图 |
| `src/dev/plain.ts` | 把页面里的值变成能 JSON 的样子 |
| `tools/agent.mjs` | 命令行（`npm run agent`） |
| `tests/agentMonitor.test.ts` | 起一个真的开发服务器、用 WebSocket 假扮页面来测 |
