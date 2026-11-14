# 内置 agent 和运行框架（harness）方案

2026-11-13 定的事：
- **给所有下载的人用**：exe、apk、网页版里都有，默认关，在设置里打开。
- **用户自己填钥匙**：作者不出钱，也不架服务。
- **harness 指运行框架**：agent 的循环、工具清单、改动先给人看、一键撤回、出错就停。这次不做评测台和对外 MCP。
- **第一批能力**：改造型、摆姿势、多角色场景、看参考图。
- **用 pi 做底子，接口里内置 pi 的服务商和模型预设**（同一天追加）。

## 用 pi 的哪几块

pi（pi-mono，MIT 许可）原来叫 `@mariozechner/pi-*`，已改名 `@earendil-works/pi-*`。旧名字停在 0.73.1（2026-05），不认识 Claude 5 系列，不能用。用新名字的 1.5.x：

| 包 | 用来做什么 |
|---|---|
| `@earendil-works/pi-ai` | 各家服务商的调用和**模型预设**：服务商列表、每家的模型、能不能看图、上下文多长、价格。按需注册服务商，每家的接口代码分成单独的块，用到时才加载 |
| `@earendil-works/pi-agent-core` | **运行框架的循环**：`Agent` 类，带工具执行、事件、`beforeToolCall`/`afterToolCall` 钩子、中途插话（steer）、中断、`transformContext` 裁剪上下文 |
| `@earendil-works/pi-schema` | 写工具参数的结构（pi-ai 自带的依赖） |

**不用** `pi-web-ui`：它带着 xlsx、pdfjs 这些用不上的大包，界面也不合工坊的三语和手机版面，面板我们自己写。也不内置 pi 编程助手那个命令行程序，只用它的库。

2026-11-13 在临时目录试过：
- 新版预设里有 43 家服务商，其中 Claude 有 `claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5`、`claude-fable-5-2`。
- 国内的有：DeepSeek、Kimi（`moonshotai-cn`）、智谱（`zai-coding-cn`，编程套餐的地址）、MiniMax（`minimax-cn`）、小米 MiMo、千问（`qwen-token-plan-cn`，Token 套餐的地址）、蚂蚁 Ling。
- 只注册 Claude、DeepSeek、Kimi 三家，按工坊的打包目标（`es2020`、`chrome80`）打包，构建通过，全部加起来约 720 KB，而且都是按需加载的块，不影响首屏。只有一条无害警告：`node:fs` 被换成空模块，那段代码只在 Node 里读环境变量用。
- 还没验证：在 WebView 83 上实际跑。之前那个会话下的 Chromium 83 已经删了，要重新下载（得你同意）。

## 做什么、不做什么

**做**：右侧（手机上是抽屉）多一个「AI 助手」面板。用户用大白话说要什么，agent 调用工坊自己的工具去改，每一轮改完列出改了哪些，可以整轮撤回。

**不做**：
- 不给 agent 文件、网络、跑代码之类的工具。它只能用下面列出来的工坊工具。
- 不让 agent 自己保存、导出、覆盖文件。这些按钮还是用户自己点。
- 不做评测台、不做对外 MCP（以后要做另开计划）。
- 不让 agent 修穿模、改网格算法。那是代码层的事。
- 「显示成人部件」关着的时候，agent 看不到、也改不了成人部件。
- 不支持要 OAuth 登录或要云账号配置的服务商（Copilot、Codex 订阅、Bedrock、Vertex、Azure、Cloudflare），这些在浏览器里用不了，或者要填的东西太多。

## 设置面板：内置 pi 的预设

```
服务商   [DeepSeek            ▼]   ← 来自 pi 预设，分「国内」「国外」两组，最后一项「自定义（兼容 OpenAI）」
模型     [deepseek-v4-pro     ▼]   ← 来自 pi 预设里这一家的模型，标出「能看图」；也能手填型号
钥匙     [••••••••••••abcd     ]   ← 只存本机
思考深度 [中 ▼]                     ← 映射到 pi 的 thinking level，模型不支持时变灰
         [测试连接]                ← 发一句很短的话，显示通没通、用了多少字（token）、估算花了多少钱
```

- **国内组**：DeepSeek、Kimi、智谱、MiniMax、小米 MiMo、千问 Token 套餐、蚂蚁 Ling。
- **国外组**：Anthropic（Claude）、OpenAI、Google、OpenRouter、xAI。
- **自定义（兼容 OpenAI）**：填地址和型号。百炼按量付费、火山方舟（豆包）、硅基流动、本机 Ollama 都走这一项。面板里给几条常用地址当示例，用 pi 的 `compat` 设置填好（例如千问用 `thinkingFormat: 'qwen'`）。
- 选了一家，默认选这家预设里最前面那个能用工具的主力模型；Claude 默认 `claude-opus-5-5`。
- **预设怎么更新**：pi 的模型表跟着 pi 的版本走。每次发版前把 pi 升到最新的 1.x，新模型就进来了；预设里没有的新模型，用户也能手填型号。

## 整体结构

```
 面板（src/ai/panel.ts）+ 设置（src/ai/settings.ts）
   │ 用户的话、参考图
   ▼
 pi-agent-core 的 Agent（src/ai/agent.ts 负责组装）
   │  钩子：beforeToolCall → 删东西前弹确认
   │        agent_start / agent_end 事件 → 一轮的撤销分组
   │        transformContext → 只留最近几轮 + 当前状态
   ▼
 工具（src/ai/tools/*.ts，参数用 pi-schema 写）
   ▼
 工坊接口（src/ai/workshop.ts 定义、main.ts 实现，见文末「第 1 期做了什么」）
   ▼
 main.ts 里现有的 fromParams / 撤销 / 摆姿势 / 场景函数

 pi-ai 的 Models（src/ai/models.ts：只注册上面那几家 + 自定义）
   │ 每个模型的 baseUrl 改写成同源的转发地址
   ▼
 转发（src/ai/transport.ts）
   ├─ exe：启动器本机网站加 /__ai/fwd/<服务商地址>/…
   ├─ apk：外壳在 shouldInterceptRequest 里接住 /__ai/fwd/ 的请求，用 Java 发出去
   ├─ 开发服务器：Vite 插件转发
   └─ 纯网页：不改写，直接连（只有放行跨域的服务能用）
```

## 关键决定

1. **工坊接口单独抽出来，正式版也有。** 现在 `main.ts` 末尾的 `__oc` 只在开发时挂上（`set`、`pose.drag`、`pose.gesture`、`scene.add/go/move` 这些）。把它们整理成 `src/app/api.ts` 里带类型的 `WorkshopApi`；开发时的 `__oc` 改成引用同一份，`tools/agent.mjs` 照旧能用。
2. **跨域靠外壳转发，接到 pi 上只改 baseUrl。** pi 的每个模型都带 `baseUrl` 和 `headers`。我们把选中的模型复制一份，`baseUrl` 改成 `./__ai/fwd/api.deepseek.com/…` 这种同源地址，`headers` 里加上本次启动的口令。pi 和它里面的官方 SDK 都不用改。
   - exe：`Launcher.cs` 的本机网站加 `/__ai/fwd/` 路由。
   - apk：`MainActivity.java` 在已有的 `shouldInterceptRequest` 里接住这类请求，用 `HttpURLConnection` 发出去，流式结果原样交回。
   - 防滥用：照 `/__shell/` 的规矩要带 `X-Shell` 头（做的时候改成这样，没另做口令，见文末）；必须是 https（本机 Ollama 的 `localhost` 除外）；不转发 cookie。
   - 纯网页版没有外壳，就直接连。Claude 能连，别的看对方放不放行跨域；连不上就提示「请用 exe 或 apk」。
3. **运行框架用 pi-agent-core，不自己写循环。** 用它的事件和钩子：
   - **整轮撤回**：`agent_start` 时记下撤销起点，`agent_end` 时把这一轮所有改动合成一步（`History` 加分组功能）。面板显示「这一轮改了：腿 2→4、排布 → 前后串联、姿势 → 叉腰」，旁边有「撤回这一轮」。
   - **删东西前确认**：`beforeToolCall` 遇到 `scene_remove` 这类工具时弹确认框，用户点了取消就挡下这次调用，并把「用户取消了」作为结果告诉模型。
   - **停下**：面板上的「停」按钮调 `abort()`；跑到第 12 步就停（`shouldStopAfterTurn`），免得一直烧钱。
   - **插话**：模型还在干活时用户又说了话，用 `steer()` 塞进去。
4. **工具结果要回报实际效果。** 数量超出上限被截了、这种样式不支持这个排布，都要在结果里写清楚，模型才知道自己没改成，不会骗用户说改好了。用来校验的就是现成的 `normalizeSpec`、`clampCounts`。
5. **钥匙只存本机。** 存在 localStorage，按服务商分开存，不写进存档、场景文件、问题单、导出文件、更新日志；面板上只显示后四位。设置里写明「钥匙只发给你选的服务商」。
6. **拒绝和报错要好好说。** pi 把各家的停止原因统一了。遇到报错、被拒绝（Claude 对成人内容可能拒绝）、钥匙不对、额度用完、超时，都翻成一句人话显示在面板上，不卡住、不重试刷钱。

## 工具清单

| 分组 | 工具 | 说明 |
|---|---|---|
| 通用 | `get_state` | 当前设定的文字说明（复用 `describeSpec`）、身体样式、模式、场景里有哪些角色、当前姿势 |
| 通用 | `look` | 从正面、侧面（可选背面）各截一张小图给模型看（复用视口截图）；模型不能看图时不注册这个工具 |
| 造型 | `parse_description` | 先用现成的规则解析器试一下，便宜又准；解析器认不出的再由模型自己拼改动 |
| 造型 | `set_body` | 改 BodySpec 的一部分：部件数量、排布、每个上半身单独设、体型滑块、头发、身体样式。返回改后的说明和被截掉的项 |
| 摆姿势 | `list_poses` / `apply_pose` | 套现成姿势，可以只套一部分（复用「姿势只套部分」） |
| 摆姿势 | `move_handle` | 把手、脚、胯这些圆点挪到某处（复用 `poseHandles` 拖动那一套），可选「脚踩到地上」 |
| 摆姿势 | `set_gesture` / `set_expression` | 换手势、表情（连体可以指定是哪个头） |
| 场景 | `scene_list` / `scene_add` / `scene_switch` / `scene_move` | 加角色（复制当前或用默认）、切换、摆位置和朝向 |
| 场景 | `scene_remove` | 删角色，**执行前要用户确认** |
| 场景 | `scene_pair_action` | 套双人动作 |
| 参考图 | （不是工具） | 用户在面板里附图，图跟着用户的话一起发给模型；选的模型在 pi 预设里不能看图时，附图按钮变灰并说明原因 |

系统提示里有一段「工坊说明」，从 `COUNT_DEFS`、排布、样式这些定义自动生成，不手写，跟代码同步。

## 分期（每期单独能发）

**第 1 期 · 运行框架 + 改造型**
- 先在 Chromium 83 上跑上面那个试打包（要重新下载，你同意后再下）。跑不了的话，补 `src/polyfill.ts`；补不了的话，旧内核上 AI 助手按钮变灰。
- 加依赖 `@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`。pi 里的 Mistral 那块要可选依赖 `@opentelemetry/api`：我们不注册 Mistral，在 Vite 里把它指到空模块，不装。
- `src/app/api.ts`、`src/ai/`（Models 注册和预设、Agent 组装、转发、面板、设置）、`History` 分组。
- exe 启动器的 `/__ai/fwd/`、apk 外壳的转发、Vite 开发插件转发。
- 工具：`get_state`、`parse_description`、`set_body`。
- 做完以后：用户选服务商、填钥匙，就能用大白话改造型、接着改、整轮撤回。

**第 2 期 · 摆姿势 + 自己看图检查**
- 工具：`list_poses`、`apply_pose`、`move_handle`、`set_gesture`、`set_expression`、`look`。

**第 3 期 · 多角色场景**
- 场景的六个工具，删除前确认。

**第 4 期 · 参考图**
- 面板附图（电脑拖放和粘贴，手机选相册或拍照），压到长边 1024 再发。
- 提示词里写明：照图数部件、定排布，拿不准就问用户。

**第 5 期 · 收尾**
- 中英日三语（`t()` 加 `en/ja` 译文；服务商名字用 pi 给的英文名，国内几家补中文名）、手机版面、WebView 83 验证、README 加一节用法、重新打 exe 和 apk、发版。

## 改动的文件

超过 8 个，记一下：`src/main.ts`（接口抽出去、挂面板）、新 `src/app/api.ts`、新 `src/ai/` 目录（约 10 个文件）、`src/model/history.ts`、`tools/launcher/Launcher.cs`、`tools/android/src/.../MainActivity.java`、`tools/agent-monitor/plugin.mjs`（或新开一个 Vite 插件）、`vite.config.ts`（空模块别名）、`package.json`（加两个 pi 包）、`src/i18n/en|ja/*.json`、`README.md` 三语。

## 怎么验

- **不花钱的测试（vitest）**：pi-ai 自带「假服务商」（`fauxProvider`、`fauxToolCall`），可以按剧本吐工具调用。用它验证工具、整轮撤回、删除前确认、出错停下、第 12 步停下、被截掉的项有没有回报。
- **转发**：exe 用 `--port` 和临时 `--state` 试跑（不碰你本机的状态），确认没带口令的请求被拒、http 地址被拒、不是当前服务商的地址被拒。apk 用模拟器测（先看前台是不是我的应用）。
- **真连模型**：需要你在本机设环境变量（例如 `ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`），由 node 测试脚本去读（pi 在 Node 里会自动读这些变量）；或者你自己把钥匙填进设置。我不往输入框里填钥匙。每家至少过一遍「改造型 + 接着改」。
- **手动验收**：每期给一组固定说法（例如「三头六臂、九条尾巴的狐狸娘」「左手叉腰右手举起来」「再加一个人站她左边，两人背靠背」），截图前后对比放 `docs/`。
- **旧 WebView**：Chromium 83 打开打包后的页面，AI 面板能开、能发请求、不白屏。

## 最脆弱的前提

**这个方案假设 pi 1.5.x 在 WebView 83 上能跑。** 打包能过，说明语法没问题；但 pi 或它里面的官方 SDK 可能用到 83 没有的新函数（`structuredClone`、`AbortSignal.timeout`、`Array.prototype.at` 之类）。第 1 期第一件事就是验证：缺的补进 `src/polyfill.ts`；补不上就在旧内核上把 AI 助手藏起来，不影响工坊别的功能。

另外几点：
- **pi 改版快**（半年里改了名、大版本从 0.x 到 1.x）。锁定小版本（`~1.5.2`），升级时跑一遍假服务商测试和「测试连接」。只用它公开的接口：`createModels`、各服务商的工厂函数、`Agent`、`fauxProvider`。
- **国内服务商的工具调用质量不一。** 第 1 期先拿 DeepSeek 实测，`set_body` 要是常拼错，就把工具参数拆细一点（每项单独一个参数，不用嵌套对象）。
- 千问、智谱在 pi 预设里只有「套餐」地址，按量付费的要走「自定义」，面板里给好示例地址。

## 回退

agent 只经过工坊接口改设定，每轮都能撤回，不碰用户的文件。整个功能默认关；万一出问题，发一个把设置开关藏起来的小版本就能停用。外壳里的转发只在 AI 助手打开、带口令时才工作。

## 和现有规矩的关系

- AGENTS.md「不下载新素材」：加的是两个 npm 依赖（pi 的两个包），不是素材；重新下载 Chromium 83 是测试工具。这两件都要你点头。
- 工作区里还有别的会话没提交的改动（`main.ts`、`spec.ts`、围成一圈 `ring.ts`）。第 1 期要大改 `main.ts`，等那边提交以后，在单独的 worktree 里做。

## 第 1 期做了什么（2026-11-13，worktree `F:\Downloads\多tool-agent`，分支 `feature/agent`，还没提交）

照上面的方案做完，有几处和方案不一样，以这里为准：

- **防滥用不用口令，用 `X-Shell` 头**：和 exe 外壳现有的 `/__shell/` 一个规矩。别的网站在浏览器里发不出带自定义头的跨站请求（预检过不去），exe 的本机网站又只认 localhost。所以没有另做口令。转发不限于「设置里选的那一家」：只有工坊自己的页面发得出来，钥匙也是用户自己的，限制没有意义。只许 https；http 只许本机（Ollama）。
- **工坊接口没抽成 `src/app/api.ts`**：第 1 期只要改设定这一样，就在 `src/ai/workshop.ts` 定义 `WorkshopApi`（spec、apply、adultOn、hold/release、mark、undo），由 `main.ts` 实现；开发时挂在 `__oc.ai` 上。摆姿势、场景那几样等第 2、3 期要用时再加，免得现在大改 `main.ts`（别的会话也在改它）。
- **不用给 `@opentelemetry/api` 起别名**：新版 pi 不带 Mistral 的那条依赖，打包直接过。
- **加了 `@earendil-works/pi-schema`**：工具参数用它写，直接依赖要写进 package.json。
- **自定义服务商没钥匙时发一个占位钥匙**：pi 不肯在没钥匙时发请求，本机 Ollama 不看这个钥匙。

文件：

| 文件 | 做什么 |
|---|---|
| `src/ai/settings.ts` | 开关、设置、钥匙（按服务商分开存在 localStorage）；不引用 pi，开页面就读 |
| `src/ai/providers.ts` | 设置里列的服务商（pi 的预设：国内 7 家、国外 5 家，加「自定义（兼容 OpenAI）」）和各家默认模型 |
| `src/ai/transport.ts` | 有没有转发（`/__ai/ping`、apk 的 `window.OcAi`）、改写 baseUrl、apk 上把 `/__ai/fwd/` 的 fetch 交给外壳 |
| `src/ai/body.ts` | 改动套到设定上（过 normalizeSpec、成人部件开关）、没照办的记下来、改之前改之后比一比 |
| `src/ai/tools.ts` | 三个工具：`get_state`、`parse_description`（replace / merge）、`set_body` |
| `src/ai/prompt.ts` | 系统提示：数量、滑块范围从 spec.ts 的定义现拼 |
| `src/ai/session.ts` | 运行框架：pi 的 Agent，一轮并成一步撤销、最多 12 步、报错翻成人话 |
| `src/ai/panel.ts` | 「AI 助手」那一栏：对话、整轮撤回、设置、测试连接；第一次打开才载入（连带 pi） |
| `src/polyfill.ts` | 补了 pi 在 Chrome 80–83 上缺的：FinalizationRegistry、WeakRef、AbortSignal 的 reason/throwIfAborted/timeout/any、structuredClone、crypto.randomUUID、ReadableStream 的 for await |
| `src/model/history.ts` | `hold(key)` / `release()`：hold 期间同一个 key 隔多久都并成一步 |
| `tools/ai-forward/plugin.mjs` | 开发服务器上的 `/__ai/`（只认本机来的请求） |
| `tools/launcher/AiForward.cs` | exe 外壳的 `/__ai/`，`tools/pack.ps1` 把它一起编进去 |
| `tools/android/.../AiBridge.java` | apk 外壳的 `window.OcAi`，MainActivity 里注册 |
| `src/i18n/en|ja/ai.json` | 85 句英文、日文 |
| `tests/ai.test.ts` | 12 个测试，用 pi 的假服务商 |

验过的：

- `npx tsc --noEmit`、全部 69 个测试文件（1854 个测试）都过。
- 开发服务器（单独开在 5181 端口）+ 假的 OpenAI 服务器：面板 → pi → 转发 → 假模型的工具调用 → 腿 2→4、尾巴 0→2 → 「撤回这一轮」退回去；人自己又改过以后按钮变灰；pi 预设载入（DeepSeek 默认 deepseek-v4-pro、Claude 默认 claude-opus-5-5、Kimi 默认 kimi-k3.1-pro）；测试连接；没钥匙时的提示。控制台、服务器都没有报错。
- Chromium 83（vivo 那台 WebView 的版本）上打开正式打包的页面，跑完整一轮再撤回：通过。
- exe 打到临时目录，用 `--port 5299 --state <临时目录> --no-browser` 试跑：`/__ai/ping`；不带 `X-Shell` 回 403；http 外网地址回 400；流式一段段转发；Origin、X-Shell 没带出去；真连 api.deepseek.com，回的是它自己的 401（钥匙是假的）。在 exe 打开的页面里用 Chromium 83 跑完整一轮：通过。
- apk 打到临时目录（包名带 `.test`）：javac、d8、签名都过。

还没验的：

- **真模型**：要用户的钥匙，还没用 DeepSeek、Claude 真跑过。
- **apk 在手机、模拟器上跑**：模拟器没开，`window.OcAi` 的转发只编译过、没在设备上跑过。

### 第 1 期补充：自动取模型列表和元数据（2026-11-13 下午，他用真钥匙试过以后要的）

- 他用 DeepSeek 的真钥匙试过一轮（deepseek-flash，思考「深」，「改成标准人形」），工具调用、改动列表、费用都对，约 0.0012 美元。
- **模型列表自动从服务商取**（`src/ai/catalog.ts`）：照用户的钥匙问这家自己的 /models（走同一条转发）。填钥匙时马上问一次，顺带核对钥匙对不对；存着的列表超过一天才再问；有「刷新列表」按钮；换钥匙就不认旧列表（只记钥匙的后 6 位做比对）。pi 内置的那几家，pi 自己的 `refresh()` 什么都不做，所以这一块是我们自己写的。
- **元数据**：各家 /models 的写法都认一遍。OpenRouter 字段最全（上下文、最多输出、看图、思考、价格、能不能用工具）；Anthropic 有 max_input_tokens、max_tokens、capabilities；Google 有 inputTokenLimit、outputTokenLimit、thinking；DeepSeek 这类只给 id。服务商说了的盖在 pi 预设上，没说的照 pi 预设；pi 也没有的新模型用保守的数（上下文 128K、输出 8K）。不能用工具的、不是聊天的（向量、语音、画图、审核……）不列出来。
- **用上元数据**：模型下面一行说明（上下文、最多输出、能不能看图、会不会思考、每百万 token 的价格）；模型不会思考时「思考深度」变灰；对话快装不下上下文的 6 成时，从最早的一轮开始整轮省掉（`trimContext`，工具调用和结果不拆开），并提示一句。
- **别的易用性**：填过钥匙的服务商后面打 ✓；模型超过 20 个时多一个搜索框（OpenRouter 有 409 个）；每家各自记住选过的模型；回答下面写是哪个模型答的；「自定义」也会去问 /models，列出来让人选（本机 Ollama 也行）。
- 改了一处默认值：OpenRouter 的 Claude 型号写法是 `anthropic/claude-opus-5.5`（带点）。
- 验过：新加 12 个测试（各家列表的写法、合并、省对话、每家记模型），全部 70 个测试文件、1866 个测试都过，正式打包通过；他浏览器里用真钥匙取到了 DeepSeek 的 2 个模型，OpenRouter 不用钥匙取到 409 个，数据来自 API 本身。

### 第 1 期补充：单独的 AI 窗口、对话保存、缓存等（2026-11-13 下午，他要的「一个 agent 应该有的」）

- **单独的窗口**（`src/ai/dock.ts`，原来面板里那一栏 `panel.ts` 删了）：
  - 顶栏「导出」左边多一个「AI 助手」按钮（「⋯」菜单里打开 AI 助手以后才出现）。
  - 电脑上，窗口浮在 3D 视图左边；手机上铺满整屏，按钮在右上角第二行。
  - 窗口不能放在 `.stage` 里面：那里的 `container-type` 会把 `position:fixed` 框在 3D 视图里，手机上铺不满还被抽屉压着。所以放在 `.app` 下面，电脑上和 3D 视图占同一个网格格子。
- **窗口里三个页面**：对话、全部对话、设置（`settingsView.ts`，从旧面板搬出来的）。顶上一行显示：模型、上下文用了多少（估的）/ 模型上限、这段对话花了多少、缓存命中几成。
- **一轮的画法**（`turns.ts`）：每一轮依次是你说的话、思考过程（折着）、回答（`markdown.ts`，只用 createElement 拼，不写 innerHTML）、工具调用（折着，能看参数和结果）、这一轮改了什么、用量（输入、缓存、输出、价格）、按钮（复制、重新生成、撤回这一轮）。界面全从 pi 的消息算出来；干活时只重画最后一轮，人点开的折叠块流式时不会又收起来。
- **对话保存**（`store.ts`）：存在 IndexedDB，打不开就只存在内存里，最多 100 段。存的是 pi 的整段消息加标题、花费、每轮的备注、哪几句是开轮的。关了再开还在，能接着聊，pi 会把原来的消息交回给模型。对话列表里能切换、改名、导出成 Markdown、删除（要点两下）。标题取第一句话的前 24 个字。没发出去的草稿也记着。
- **提示缓存**：同一段对话一直用同一个会话号 `oc-<对话 id>`，关了再开也不变。pi 默认的 short 保留期会照它给 Claude 加缓存标记、给 OpenAI 发缓存键、给 OpenRouter 发会话头；DeepSeek 这类是服务器自动缓存。缓存命中多少从用量里读，显示在每一轮下面和顶上那一行。
- **干活时插话**：模型干活时还能接着说，用的是 pi 的 `steer`，下一步模型就看得到，算在同一轮里。干活时有「停」。
- **重新生成**：只给最后一轮。先撤回这一轮的改动（撤得回的话），把这一轮从对话里截掉，再把那句话发一次。
- 「显示成人部件」开关或界面语言变了，就自动另起一段对话（工具参数和系统提示都不一样了），旧的留在列表里。
- 没钥匙、没地址这种还没发出去的错，只显示在最后、不进对话，并直接跳到设置页。
- 测试：新加 9 个（存对话、打开以后接着聊、重新生成、插话真的插进去、开关变了另起、同一项改几次只显示头尾、插话怎么分轮），全部 70 个测试文件、1873 个测试都过。浏览器里用假模型验了：电脑和手机的版面、发话、存、刷新以后接着聊（发出去的请求带着原来的整段对话）、改名、删除要点两下、设置页。Chromium 83 上正式打包：窗口、一轮、撤回、IndexedDB 都正常。
- 他之前在旧面板里那几句对话没存（旧版本不存对话）。

### 第 1 期补充：窗口能拖能缩放、圈出来、单独微调部件（2026-11-13 下午）

- **拖动、缩放**（`dock.ts`，只在电脑上）：
  - 拖标题栏挪窗口，拖四条边、四个角改大小（最小 300×300）；
  - 挪过以后改成 `position:fixed` 浮着（`.floating`），位置、大小记在 localStorage 的 `oc-ai-dock-place`；
  - 双击标题栏回到默认的位置；窗口变小时自动收进可见范围；
  - 拖标题时松手不会当成点了标题（那样会打开对话列表）；
  - 手机上照样铺满整屏，没有拖的把手。
- **圈出来**（`marks.ts`，参照开发版的问题单 `src/dev/annotate.ts`）：
  - 画的过程：输入区左下角的「圈出来」→ 窗口先让开 → 3D 视图上盖一层画布画红圈，可以圈好几处；Ctrl+Z 撤一笔，Esc 不圈了；镜头要先转好再画。
  - 认部件：每个圈沿笔迹等距取点（最多 60 个；快速一划浏览器只报头尾几个点，所以不能只用报上来的点）；圈是闭合的，再在圈里撒 7×7 个点。每个点用工坊自己的 `pickPart` 打射线，按点中次数排出部件，最多 4 个。
  - 截图：当时的 3D 视图（`viewport.snapshot()`，兼容模式下也截得到），叠上红圈，压成长边 1024 的 JPEG。
  - 发出去：说明里写清部件名（`Arm_01_L (手臂 1 左, 100%)`）、镜头从哪边看（正面看时角色自己的左边在画面右边）；图只发给能看图的模型。说明以 `⟦marks⟧` 开头，界面靠它把这段从用户的话里拿出来，单独显示成「圈了：……」和小图（点一下放大）。一次最多附 3 张；干活时插话只带文字。
  - 「重新生成」会把圈出来的部件和图原样再发一次。
  - 刚盖上画布的 0.25 秒里不收点按，免得点「圈出来」那一下多画一个点；抓指针失败（旧内核）也照样能画。
- **单独微调部件**（`tools.ts`）：
  - `list_parts`：列出能微调的部件和它现在的微调。
  - `tweak_part`：改一个部件的位置、角度、大小，或者还原。默认左右镜像，`mirror:false` 只改这一边；部件名不认识就报错，并把能用的名字列给模型。
  - 改的是和「微调」那一栏同一份数据（`overrides` / `characterOverrides`，用 `setOverride` / `clearOverride`），一样能整轮撤回。
  - 改动列表里写清是哪个部件（「微调 手臂 1 左」）。
  - 系统提示里说明：圈出来的就是「这里」；改单个部件用 `tweak_part`；只圈了一边就不镜像。
- **工坊接口**多了 5 样：`stage`、`pickAt`、`snapshot`、`viewSide`、`parts`，由 `main.ts` 实现。
- 输入框跟着字数长高（最多 6 行）。
- 测试：新加 10 个（圈里取点、空白处、直线沿线取点、发给模型的说明、能看图和不能看图各发什么、重新生成连圈选一起重发、`tweak_part` 镜像和撤回、只改一边、还原、不认识的部件），全部 70 个测试文件、1882 个测试都过。
- 浏览器里验了：拖标题、拖右下角缩放、记住位置；真的用鼠标在模型上画两笔，认出「手臂 1 左、尾巴 2」（正面看画面右边那条手臂，确实是角色的左手）；发出去的说明和图都对，小图点开能看到红圈。Chromium 83 上正式打包：画圈、认部件、截图、发送都通。

### 对齐和拖动提示（2026-11-13 下午，他截图指出顶栏「AI 助手」和「导出」没对齐）

- 原因：两个按钮竖着居中是对的，但高度不一样（「AI 助手」31.8 px，内边距 5；「导出」33.8 px，内边距 6；「⋯」34 px），所以上下沿对不齐。AI 窗口里也一样：「圈出来」28.2 px 挨着「发送」33.8 px，标题 29.7 px 挨着 32 px 的图标。
- 改法：同一排的按钮定成一样高。顶栏都是 34 px；AI 窗口的标题栏和输入区都是 32 px；消息下面的「复制」「重新生成」「撤回这一轮」，和对话列表里的按钮都是 26 px；图标和字竖着居中。量过：顶栏三个按钮上沿都是 6.6 px、高都是 34 px，输入区两个按钮上沿、高度都一样。
- 窗口右下角加了两道斜杠（只在电脑上有，鼠标移上去变成主题色），提示这里能拖着改大小。输入区右边留了 16 px，斜杠不会压在「发送」上。
