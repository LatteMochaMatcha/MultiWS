# 软件内自动更新：方案

2026-11-06 写。还没开工。

## 目标

- exe 和 apk 打开后会自己检查有没有新版本，有的话在页面上提示，点一下就能更新。
- 平常的更新只下载改过的文件，通常只有几 MB，不用每次都下 67 MB 的整包。
- 更新完刷新一下页面就能用，不用重装，也不用重启。设定、保存的角色（localStorage）都保留。
- 更新下坏了、被人换了包，或者新版打不开，都自动退回能用的那一版。

## 现状（照代码看的）

- **exe**（`tools/launcher/Launcher.cs`）：把嵌在 exe 里的 `app.zip` 读进内存，在 `localhost:5210` 开一个小网站，再用默认浏览器打开。文件开头写着「不联网，不往硬盘上写东西」。
- **apk**（`tools/android/src/.../MainActivity.java`）：WebView 打开 `https://appassets.androidplatform.net/index.html`，网页要的每个文件都在 `shouldInterceptRequest` 里从 `assets/www` 取。`AndroidManifest.xml` 里没有申请任何权限，也没有联网权限。
- **dist 的大小**：35 个文件，一共 125 MB。
  - `character/` 下的十个成品角色 VRM 占 105 MB，几乎不改。
  - `assets/` 下的代码 2.8 MB，文件名带哈希（例如 `index-BHqgmWKw.js`），改了代码名字就会变。
  - 另外 `anime/` 7 MB、两个头发目录 10 MB、根目录 1 MB。
- **版本号对不上**：`package.json` 写的是 `2.0.0`，`Launcher.cs` 写死 `2.0.0.0`，apk 的 versionName 从 `package.json` 读（所以也是 2.0.0），versionCode 用的是打包时间。Git 标签已经到 `v2.7.2`。

## 整体做法

### 1. 一份签过名的文件清单

每次发版生成两个文件：

- `latest.json`：版本号、更新说明（中、英、日）、要求的最低外壳版本 `minShell`，以及 dist 里每个文件的路径、大小、sha256。
- `latest.json.sig`：用私钥对 `latest.json` 原文的签名（RSA-3072，SHA-256）。

外壳里只放公钥。处理顺序是：

1. 先核对 `latest.json` 的签名，对不上就整个不用。
2. 再按清单核对每个下载下来的文件的 sha256，对不上就丢掉重下。

这样文件本身不用单独签名，镜像放在哪里都不怕被人换包。

### 2. 文件按内容存放，只下改过的

- 两个下载地址上，文件都按 sha256 命名存放（`objects/<sha256>`），内容一样的文件只存一份。
- 打包时在 dist 里多写一个 `update-manifest.json`（格式和 `latest.json` 一样，只是没有更新说明），跟着 dist 进 `app.zip`，记下外壳自带的每个文件的 sha256 和版本号。
- 外壳拿到新清单后，只下载「本地没有、外壳也没带」的文件。
- 只改代码时大约下 1–4 MB。改了一个成品角色就多出一个 VRM，大约 11 MB。

### 3. 两个下载地址

| 顺序 | 地址 | 存放方式 |
|---|---|---|
| 先试 | Cloudflare R2 | 一个公开的存储桶：`latest.json`、`latest.json.sig`、`objects/<sha256>` |
| 再试 | GitHub Release | 一个固定的 Release，标签叫 `update-store`，不当正式版展示。文件名是 `<sha256>`；`latest.json` 每次用 `--clobber` 覆盖 |

- 每个地址超时 8 秒，连不上就试下一个。都连不上就安静失败，不弹错误。
- 先试 R2，是因为国内连 GitHub 不稳（见下面的测速结果）。顺序写在外壳里，以后能改。
- R2 的地址：`https://pub-d985d51f23684c13b3c981336d18882a.r2.dev`（存储桶 `oc-workshop-update`，亚太地区）。

#### 国内测速结果（2026-11-06）

用 Globalping 的国内节点测了三个地址：R2 上的 10 MB 测速文件；GitHub Release 的 v2.7.2 apk；以及 GitHub 跳转以后真正提供文件的那个网站。三个地址用的是同一批 40 个节点，覆盖电信、联通、移动和腾讯云、阿里云等机房，分布在北京、上海、广深、成都、武汉等 20 多个城市。

| 地址 | 连得上 | 首字节（中位数） | 整次请求（中位数） |
|---|---|---|---|
| R2（`pub-….r2.dev`） | 40 / 40 | 469 ms | 1.7 s |
| GitHub `github.com/…/releases/download/…`（第一步，返回跳转） | 24 / 40 | 520 ms | 0.7 s |
| GitHub `release-assets.githubusercontent.com`（跳转后的文件站） | 36 / 40 | 217 ms | 0.7 s |

注：GitHub 第一步连不上的 16 个里有 1 个是节点下线，其余 15 个是超时；文件站连不上的 4 个里有 2 个是节点下线。

- 从 GitHub 下载必须先经过 `github.com` 这一步，而它在国内有四成节点超时（上海联通、北京移动、深圳腾讯云等都有），所以 GitHub 只能当备用。
- R2 每个节点都连得上，个别节点握手慢（宁波一个点 11 s），整体最稳，定为先试的地址。
- Globalping 只下载开头一小段，测的是连不连得上、多快开始传，不是完整下载 10 MB 的速度。节点也多在机房，家里宽带的情况可能更差一点。
- 在澳大利亚本机测：两边都是 3–4 MB/s，卡在本地网速上。
- 为什么不用 Gitee、国内的 OSS、网盘、jsDelivr：见本文最后「没选的地方」。

### 4. 外壳怎么用新文件

- 新文件存在本机：exe 存在 `%LOCALAPPDATA%\OC白模工坊\update\`，apk 存在应用自己的 `files/update/`。里面是 `objects/` 加一个 `current.json`，`current.json` 指向现在用的那份清单。
- 网页要一个文件时：当前清单里有、本地也有的就从 `objects/` 取，否则从外壳自带的那份取。
- 地址不变：exe 还是 `localhost:5210`，apk 还是 `appassets.androidplatform.net`。所以 localStorage 和以前保存的东西都还在。
- 换版本：等所有新文件都下好、核对完，才一次性改写 `current.json`（先写临时文件再改名）。下到一半断了，旧版照常能用，下次接着下。
- 外壳会实时换到新清单，所以页面 `location.reload()` 一下就是新版，不用关窗口。

### 5. 退回

几种情况会退回，或者不用更新包：

- **外壳太旧**：清单的 `minShell` 比外壳的版本高，就不用这个更新包，提示「这次更新要重新下载安装包」。
- **装了更新的外壳**：外壳自带的版本比更新包新（比如用户重装了新 exe），就用自带的。
- **新版打不开**：网页启动成功后告诉外壳一声（exe 发一个 `/__shell/booted`，apk 走 JS 接口）。连续两次打开都没收到，下次就退回上一份清单；上一份也不行，就退回外壳自带的那份。
- **清理旧文件**：只保留当前和上一份清单用到的文件，其余删掉。

### 6. 网页这边

- `src/update/` 统一管更新，下面分 exe、apk 两套接法。开发服务器上没有外壳，就不显示任何更新入口。
- 检查时机：每次打开查一次，一天最多一次。
- 有新版时显示一张卡片：「有新版本 2.8（约 3 MB）」，下面是更新说明、「现在更新」「以后再说」「跳过这一版」。下载时显示进度，下完后点「刷新」就用上了。
- 设置里加两项：「自动检查更新」开关，和一个「现在检查」按钮。
- 新加的界面文字都包 `t()`，补上英文、日文译文。

### 7. 外壳本身的更新（第 5 期做）

只有改了 Launcher.cs、MainActivity.java 才需要，很少用。

- **exe**：清单里多写一项新 exe 的地址和 sha256。下载核对后，先把正在运行的 exe 改名成 `.old`，把新 exe 放到原来的位置，再重启；下次启动时删掉 `.old`。
- **apk**：下载新 apk，核对后调起系统安装界面，用户点「安装」。
  - 要加「安装未知应用」权限（`REQUEST_INSTALL_PACKAGES`）和 FileProvider。
  - 签名钥匙 `tools/android/sign.keystore` 绝对不能丢，丢了新包就盖不上旧包。

## 要注意的地方

- **.NET Framework 的 TLS**：exe 用 Windows 自带的 .NET Framework 编译，默认可能不用 TLS 1.2，连 GitHub 和 R2 会失败。要先设 `ServicePointManager.SecurityProtocol` 为 TLS 1.2（3072）。
- **代理**：exe 下载时用系统代理（HttpWebRequest 默认就会用），开了代理的人也能下。
- **安卓网络**：`INTERNET` 是普通权限，装的时候自动给，用户看不到弹窗。网络请求要放到后台线程。
- **不带身份信息**：只下载静态文件，请求里不带任何能认出用户的东西。
- **改说明文字**：Launcher.cs 和 AndroidManifest.xml 开头「不联网」的注释，`使用说明.txt` 和三语说明里的对应说法，都要跟着改。
- **私钥**：
  - 放在仓库外，例如 `~/.oc-update-key/`，自己再备份一份。
  - 丢了以后，已经装好的 exe/apk 就再也收不到更新，只能重新下载安装包。
  - 公钥写进外壳，换钥匙等于换外壳。
- **R2 的地址**：Cloudflare 说 `r2.dev` 子域名是给开发用的，有限速。有自己的域名，挂到 Cloudflare 上更好；服务器不在国内，不用备案。

## 分期

### 第 0 期：先定的事、开通 R2

- R2 已开通、测过速，定为先试的地址（11-06）。存储桶里现在只有 `speedtest-10mb.bin`（随机数据），以后可以删。
- 四件事都定了（见「已定的事」）。第 0 期完成。
- 第 1 期上传要用到的两样东西，到时候你来弄：
  - `npx wrangler login`：在浏览器里登录 Cloudflare 授权；
  - 签名私钥：我生成，放在仓库外，你自己再备份一份。

### 第 1 期：统一版本号、发版脚本（11-06 做完、传过一次，没提交）

做好的：

| 东西 | 在哪 |
|---|---|
| 版本号只在 `package.json` 写一处（改成了 2.7.2） | `pack.ps1` 照它生成 `Version.cs` 和 Launcher.cs 一起编；apk 本来就读它 |
| 清单的规则（版本比较、路径检查、读写、要下哪些文件、挑清单） | `src/update/manifest.ts`，测试 `tests/updateManifest.test.ts`（15 项） |
| 打包时写 `dist/update-manifest.json` | `tools/update-manifest.ts`，`npm run build` 最后一步自动跑 |
| 下载地址、R2 存储桶、GitHub 仓库和标签、`minShell` | `tools/update/config.json` |
| 生成钥匙 | `tools/update-keygen.ps1`；私钥在 `~/.oc-update-key/private.pem`，公钥在 `tools/update/public-key.xml`（给 exe）和 `public-key.spki.b64`（给 apk） |
| 发版 | `npm run release`（`tools/release.ps1`），参数 `-NotesZh/-NotesEn/-NotesJa`、`-DryRun`、`-SkipBuild`、`-Force` |

验过的：

- `-DryRun` 在现有 dist 上跑通：35 个文件、125 MB，签名后用仓库里的公钥核对通过。
- 同一份签名在 Windows PowerShell 5.1（.NET Framework 4，和 exe 外壳一样）和 Java 22（`SHA256withRSA`，和 apk 外壳一样的接口）里都核对通过；清单改一个字节，两边都核对不过。
- .NET Framework 设成 TLS 1.2 后能连上 R2。
- Launcher.cs 加上生成的 `Version.cs` 编译通过，exe 属性里的版本是 2.7.2.0。

11-06 晚第一次真正上传了 2.7.2（用的是现有的 dist，`-SkipBuild`）：

- wrangler 已登录（OAuth，存在本机，以后不用再登）。GitHub 上建了预发布的 `update-store` Release，不当最新版，最新版还是 v2.7.2。
- 第一次往 R2 传到第 13 个文件时网络闪断失败。脚本改成每个上传最多试三次，重跑时已有的 12 个自动跳过。
- 从两边各把清单、签名、35 个文件全下载回来：签名用 .NET Framework 核对都对，每个文件的 sha256 都对。本机下载 125 MB，R2 用了 110 s，GitHub 用了 79 s。
- 版本号没往上加时，脚本拒绝发版；加 `-Force` 重发时两边都是「要传 0 个」，只换了清单和签名。
- **GitHub 有几分钟缓存**：覆盖 `latest.json` 以后，`github.com/…/download/…` 有几分钟还给旧的那份，API 那边是新的。旧清单和旧签名是一对，核对得上，只是晚几分钟才看到新版。但清单和签名分开缓存，可能有一小段时间对不上。第 2、3 期的外壳要这样处理：签名对不上时不报错，先试下一个地址，都不行就下次打开再查。R2 设了 `no-cache`，没碰到这个问题。

原来的计划：

- `package.json` 的版本号作为唯一来源，改成 `2.7.2`。`pack.ps1` 照它生成 Launcher.cs 里的 AssemblyVersion；apk 已经从这里读了。
- 新命令 `npm run release`（`tools/release.ps1`）：
  1. 打包；
  2. 算哈希，写 `builtin.json` 和 `latest.json`；
  3. 签名；
  4. 只上传两边都还没有的文件：R2 用 `wrangler r2 object put`，GitHub 用 `gh release upload update-store`，凭据照现在推送的办法，临时用 gh 的；
  5. 最后才上传 `latest.json` 和签名，免得别人先读到新清单，文件却还没传完。
- 另加一个 `-DryRun`，只在本地生成，不上传。
- 版本比较、找出要下的文件这些逻辑，用 vitest 测。

### 第 2 期：exe 外壳

- 检查、下载、核对、按清单取文件、`/__shell/update` 接口（网页用它问有没有新版、看下载进度）、启动成功的回报、退回。
- 测法：在临时目录开一个本地文件服务器当假的下载站，用一把测试钥匙签名，下面几种情况都要过：
  - 正常更新；
  - 改了一个字节的文件；
  - 改了清单；
  - 下到一半断网；
  - `minShell` 太高；
  - 新版打不开、能退回；
  - 完全没网。

### 第 3 期：apk 外壳

- 和 exe 做同样几件事，接口走 JS 桥。
- 在模拟器上把第 2 期那几种情况再测一遍。模拟器你自己也在用，往里点之前先看前台是不是我的应用。

### 第 4 期：网页提示和设置

- 更新卡片、进度、设置里的两项、三语文字。
- 自己试一遍完整流程：发一个 2.7.3 测试版到 `update-store` → 旧 exe/apk 收到提示 → 更新 → 刷新 → 设定都还在。

### 第 5 期：外壳本身的更新

- 照上面第 7 节做。

## 已定的事（2026-11-06）

1. **网页包公开**：可以。更新文件不加密，放在 R2 和 GitHub 上谁都能下。原来 Release 里那两个加了密码的 zip，照旧发不发由你。
2. **「自动检查更新」默认开**：所以 Launcher.cs、AndroidManifest.xml 里「不联网」的注释，以及三语使用说明里的对应说法，第 2、3 期都要改成「打开时会检查更新，可在设置里关」。
3. **外壳本身的更新**：做，第 5 期不再是可选。
4. **没有自己的域名**：先用 `r2.dev`。地址写在外壳里，以后有了域名，靠外壳更新（第 5 期）或网页包里的地址列表都能换过去。

## 没选的地方

- **Gitee、阿里云/腾讯云 OSS**：要实名，自己的域名还要备案，而且有内容审核。工坊带成人部件（默认关），被下架的风险不小。
- **网盘**：没有稳定的直链，还防盗链，软件没法自动下载。
- **jsDelivr**：单个文件限 20 MB，VRM 放不下；2021 年以后在国内也不好用。
- **Cloudflare Pages**：单个文件限 25 MB，同样放不下 VRM。
- **第三方 GitHub 加速站**：经常挂掉，不当主力。以后想加，可以当第三个地址，有签名兜底。
