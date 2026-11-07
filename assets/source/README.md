# 素材来源

这里大部分文件是 VRoid Studio 旧版（beta）自带的模型，pixiv 以 CC0 1.0（公有领域贡献）发布：放弃著作权，可以随意使用、修改、再分发，不要求署名。
另外五个角色是别的作者做的，许可各不相同，见最后的「另外九个成品角色」一节；现成姿势用的动作库是 Quaternius 的（CC0）。
pixiv 的总说明见 VRoid 帮助中心「▼CC0 license models」一段，里面列了 Base models、HairSample_Male / Female 和 β Ver AvatarSample_1 – 4：
<https://vroid.pixiv.help/hc/en-us/articles/4402614652569-Do-VRoid-Studio-s-sample-models-come-with-conditions-of-use>

下载页是同一个：<https://opengameart.org/content/vroid-studio-cc0-models>

如果这个文件夹里只有这份说明（拿到的是源码压缩包就是这样，原始文件有一百多 MB，没有放进去）：工坊照常能用，加工好的数据都在 `public/` 里。
只有要重新运行 `tools/build-anime-body.mjs`、`tools/build-hair.mjs`、`tools/build-characters.ts` 时才需要原始文件：按下面各节的地址下载压缩包，解压到这个文件夹里，文件夹名和文件名照下面写的来。

## avatarsample_f.zip / avatarsample_f/AvatarSample_F.vrm

- **是什么**：样例模型 3（β Ver AvatarSample_3），VRM 0.x 格式。银色短发带蓝色挑染、左右眼不同色、自带一副电子猫耳。文件里写的名字是「ヴィータ」。
- **许可**：CC0。pixiv 给这个模型单独写的说明：<https://vroid.pixiv.help/hc/en-us/articles/360014900113>
  （「The CC license for this model is CC0 … pixiv Inc. has waived all copyright and related or neighboring rights to this model.」）
  文件自己的元数据里写的不是 `CC0`，而是 `Other` 加一个 VRoid Hub 条件页的网址，条件是：谁都可以用、可以改、可以再分发、可以商用、不要求署名。
- **下载地址**：<https://opengameart.org/sites/default/files/avatarsample_f.zip>，2026-10-05 下载。
- **校验**：压缩包 10.65 MB，SHA-256 以 `E187569E` 开头、`EBD1` 结尾；解压出来的 VRM 13.54 MB。
- **用在哪**：「成品角色」样式里默认的那个角色（银发猫耳）。`node tools/run.mjs tools/build-characters.ts` 把它加工成
  `public/character/vita.vrm`（只把工坊用不到的贴图换成 1×1 的占位图，14.2 MB → 8.9 MB），
  工坊运行时读的是加工后的这一份（`src/character/`），按部件数量拼成多肢体的样子。

## base_female.zip / base_female/Base_Female.vrm

- **是什么**：女性基础模型（Base model, female），VRM 0.x 格式。文件的元数据里写着 `CC0`。
- **下载地址**：<https://opengameart.org/sites/default/files/base_female.zip>，2026-10-05 下载。
- **校验**：压缩包 12.54 MB，SHA-256 以 `BF2717CF` 开头、`EB3` 结尾。
- **用在哪**：「二次元素体」样式。`node tools/build-anime-body.mjs` 读这个 VRM，只取皮肤（材质名以 `_SKIN` 结尾的面，不要头发、衣服、贴图），
  另外，白模人台（分指）和二次元素体的手用的是这个模型上现成的左手（`node tools/run.mjs tools/build-hand.ts` 取下来，写成 `src/anime/handMesh.json`）：网格和手指的蒙皮权重原样用，只去掉了指甲、细分了一次。
  加工成 `public/anime/body.bin` 和 `src/anime/bodyMeta.json`。这个样式运行时只用这两个文件，不读 VRM。
  （「成品角色」一开始用的也是它，后来换成了上面的样例 3。）

## 换发型用的四个模型

2026-10-06 下载。只用它们的头发：`node tools/build-hair.mjs` 从每个 VRM 里取出头发那一块网格，做成两份：
- 给「成品角色」换发型用的：连同材质、贴图和头发的骨骼，写成 `public/character/hair/<名字>.glb`（每个 1–2 MB）；
- 给「白模人台」「二次元素体」戴的：摆到素体的头上，算出每个格点到头发面片的距离，写成 `public/hair/<名字>.bin`（每个 0.5–1.6 MB，
  尺寸记在 `src/hair/hairMeta.json`），没有贴图和骨骼。双马尾自带的那副猫耳不在这一份里。

工坊运行时只读这两种文件，不读 VRM。衣服、脸、身体都没有用。

| 压缩包 / VRM | 是什么 | 工坊里的发型 | 许可说明 | 校验 |
| --- | --- | --- | --- | --- |
| `sendagaya_shino.zip` / `sendagaya_shino/Sendagaya Shino.vrm` | 千駄ヶ谷篠（Sendagaya Shino），旧版 v0.4.0 加进来的样例。黑蓝色长直发、齐刘海 | 长直发（`long`） | <https://vroid.pixiv.help/hc/en-us/articles/360013482714> | 压缩包 11.19 MB，SHA-256 以 `FF85FF42` 开头、`3696` 结尾 |
| `avatarsample_g.zip` / `avatarsample_g/AvatarSample_G.vrm` | 样例模型 4（β Ver AvatarSample_4，文件里的名字是「ヴィクトリア・ルービン」）。金色过肩发、粉色发梢、侧马尾 | 侧马尾（`sidetail`） | <https://vroid.pixiv.help/hc/en-us/articles/360014900233> | 压缩包 11.68 MB，SHA-256 以 `3DC643AA` 开头、`1B34` 结尾 |
| `avatarsample_d_darkness.zip` / `avatarsample_d_darkness/AvatarSample_D_Darkness.vrm` | 样例模型 1 的暗黑版（β Ver AvatarSample_1 那一页上的「Darkness version」）。银白色波波头 | 波波头（`bob`） | <https://vroid.pixiv.help/hc/en-us/articles/360012381793>；文件的元数据里也写着 `CC0` | 压缩包 16.41 MB，SHA-256 以 `330AB409` 开头、`7FA1` 结尾 |
| `hairsample_female.zip` / `hairsample_female/HairSample_Female.vrm` | 发型样例（HairSample_Female）。黑色双马尾，头发里做了一副猫耳 | 双马尾（`twintails`） | 总说明里「▼CC0 license models」点了名；文件的元数据里也写着 `CC0` | 压缩包 13.65 MB，SHA-256 以 `E00FC661` 开头、`BBE4` 结尾 |

四个压缩包的下载地址都是 `https://opengameart.org/sites/default/files/<压缩包名>`。
样例 4 和千駄ヶ谷篠的文件元数据里写的是 `Other` 加 VRoid Hub 条件页的网址（谁都可以用、可以改、可以再分发、可以商用、不要求署名），
CC0 是 pixiv 在上面各自的说明页里声明的。

## 现成姿势用的两个动作库

（「现成的姿势」最前面 8 个柔和的站姿不来自这两个库：是工坊自己在默认的二次元素体上摆出来的，见 `tools/build-soft-poses.ts`。
它们的起点「站着」是下面这个库里的一帧。）

2026-10-08 下载，放在 `quaternius-animation/` 里。不是 VRoid 的，是 Quaternius 做的通用人形动作库，CC0 1.0（压缩包里的 `License.txt` 写着
「CC0 1.0 Universal (CC0 1.0) Public Domain Dedication」，下载页上写着「Free to use in personal, educational and commercial projects. (CC0 License)」）。
用的是免费的「Standard」版；同一页上还有付费的 Pro / Source 版，没有下载。

| 压缩包 | 下载页 | 里面有什么 | 校验 |
| --- | --- | --- | --- |
| `Universal Animation Library[Standard].zip` | <https://quaternius.itch.io/universal-animation-library> | 43 个动作（站、走、跑、跳、蹲、坐、游泳、出拳、举枪、挥剑、倒地 …） | 15.17 MB，SHA-256 以 `CC73FC4E` 开头 |
| `Universal Animation Library 2[Standard].zip` | <https://quaternius.itch.io/universal-animation-library-2> | 43 个动作（抱臂、打电话、靠栏杆、提灯、举盾、投掷、滑铲、几套挥剑、丧尸 …），外加一个女性人台 | 17.87 MB，SHA-256 以 `4008EA20` 开头 |

- **怎么下**：下载页上点「Download Now」→「No thanks, just take me to the downloads」→ 选名字里带 `[Standard]` 的那个。解压到 `quaternius-animation/` 里，
  得到 `Universal Animation Library[Standard]/` 和 `Universal Animation Library 2[Standard]/` 两个文件夹。
- **用在哪**：只用两个文件——各自 `Unreal-Godot/` 文件夹里不带 `_RM` 的那个 GLB（`UAL1_Standard.glb`、`UAL2_Standard.glb`，人在原地做动作的版本）。
  `node tools/run.mjs tools/build-poses.ts` 照 `tools/poses.json` 的清单从里面一帧一帧取出 51 个姿势，换成工坊的姿势数据，写到 `src/pose/library.json`（约 50 KB）。
  工坊运行时只读这个 JSON，不读 GLB；动作库自带的人台、FBX、动作本身都没有打进工坊。
- 素材的骨架是 Unreal 那套名字（`pelvis`、`spine_01`、`upperarm_l` …），静止姿势是 A-pose；只取了身体和四肢的骨骼，手指没有取。

## 另外九个成品角色

2026-10-09 加的。和上面的样例 3 一样，都由 `node tools/run.mjs tools/build-characters.ts` 加工成 `public/character/<名字>.vrm`
（只把工坊用不到的贴图换成 1×1 的占位图，别的不动），清单在 `src/character/roster.ts`。十个角色的原件一共 163.5 MB，加工后 109.7 MB。

### pixiv 的 CC0 样例（四个）

许可和下载页同最上面那一段。其中两个原件早就在这个文件夹里（之前只取了头发），另外两个是这次下载的。

| 工坊里的名字 | 压缩包 / VRM | 是什么 | 许可说明 | 校验 |
| --- | --- | --- | --- | --- |
| 金发侧马尾（`victoria`） | `avatarsample_g.zip` / `avatarsample_g/AvatarSample_G.vrm` | 样例模型 4，文件里的名字是「ヴィクトリア・ルービン」 | 见上面「换发型用的四个模型」 | 同上 |
| 黑长直（`shino`） | `sendagaya_shino.zip` / `sendagaya_shino/Sendagaya Shino.vrm` | 千駄ヶ谷篠 | 同上 | 同上 |
| 蓝短发制服（`shibu`） | `avatarsample_d.zip` / `avatarsample_d/AvatarSample_D.vrm` | 样例模型 1（β Ver AvatarSample_1），文件里的名字是「千駄ヶ谷渋」。深蓝色短发、红色发夹，和千駄ヶ谷篠一样的制服 | <https://vroid.pixiv.help/hc/en-us/articles/360012381793> | 压缩包 13.60 MB，SHA-256 以 `311A383B` 开头、`3167` 结尾 |
| 棕发围裙（`vivi`） | `avatarsample_e.zip` / `avatarsample_e/AvatarSample_E.vrm` | 样例模型 2（β Ver AvatarSample_2），文件里的名字是「ビビ」 | <https://vroid.pixiv.help/hc/en-us/articles/360014900273> | 压缩包 14.96 MB，SHA-256 以 `3B6808E2` 开头、`B6B1` 结尾 |

`avatarsample_e.zip` 的下载地址是 `https://opengameart.org/sites/default/files/avatarsample_e.zip`；
`avatarsample_d.zip` 在那个网站上的文件名多一个 `_0`：`https://opengameart.org/sites/default/files/avatarsample_d_0.zip`（下回来以后改了名）。

注意：VRoid Studio 正式版里也有叫 AvatarSample_D、E 的预设（银发精灵耳、黑色长外套的那个就是正式版的 AvatarSample_D），
和这里的不是同一批，也不是 CC0（条款见 <https://vroid.pixiv.help/hc/en-us/articles/4402394424089>，其中一条不许把样例的数据用于「角色创建服务」），工坊没有用。

### VRoid Hub 上的（三个）

作者在 VRoid Hub 上把条件设成了：谁都能用（Avatar Use: Allow）、暴力表现 Allow、公司商用 Allow、个人商用 Allow、再分发 Allow、改变 Allow、不用署名。
文件自己的元数据里记着同样的条件（`licenseName: Other` 加一个 `hub.vroid.com/license?…` 的网址）。VRoid Hub 要登录 pixiv 账号、勾「按使用条件使用」才能下载。
都是 VRoid Studio 正式版导出的 VRM 0.0。

| 工坊里的名字 | 文件 | 原名 / 作者 | 网页 | 备注 | 校验 |
| --- | --- | --- | --- | --- | --- |
| 兔耳（`rabbit`） | `rabbit_aquamarine/5975234397273575285.vrm` | Preset Only Rabbit - Aquamarine / 七百屋（なおしま） | <https://hub.vroid.com/characters/1717274721342417994/models/7864107620888472526> | 只用 VRoid Studio 自带的预设做的；作者写着「VRM 無料」 | 16.50 MB，SHA-256 以 `BE274DD3` 开头 |
| 狼耳（`kuro`） | `nekomimi_kuro/3937691808267523746.vrm` | Kuro（Preset Nekomimi Girls）/ 七百屋（なおしま） | <https://hub.vroid.com/characters/6562992088211538595/models/9028223814359507805> | 同上；**性表现：不允许** | 15.39 MB，SHA-256 以 `AFB59593` 开头 |
| 马尾水手服（`sailor`） | `ponytail_sailor/7482151987160479129.vrm` | 【DL可】セーラーカーディガン【FREE】（文件里叫「水色2」）/ 白い白米 | <https://hub.vroid.com/characters/3437260818058077430/models/1673540765472485601> | 作者在 BOOTH 上给自己的素材另写了条件：不许用于 NFT、政治、宗教 | 20.00 MB，SHA-256 以 `DEBB981C` 开头 |

### itch.io 上的（两个）

| 工坊里的名字 | 压缩包 / VRM | 原名 / 作者 | 网页 | 许可 | 校验 |
| --- | --- | --- | --- | --- | --- |
| 橙发校服（`alice`） | `alice_chan.zip`（网站上叫 `Alice Chan (Uniform ver) v1.0.4.zip`）/ `alice_chan/Alice Chan (Uniform ver) v1.0.4/Alice Chan (Uniform ver) 1.0.2.vrm` | Alice Chan / edisonlee55（yuna0x0） | <https://yuna0x0.itch.io/alice-chan> | **CC BY-SA 4.0**（压缩包里带着 `LICENSE.md`，文件的元数据里也写着 `CC_BY_SA`）：要署名；改过再发出去也得用同样的许可 | 压缩包 30.44 MB，SHA-256 以 `F2D7FFFE` 开头 |
| 绿发红裙（`kotori`） | `kotori.zip`（网站上叫 `VRoid Kotori.zip`）/ `kotori/Model/Kotori.vrm` | Kotori / Fox Jump | <https://fox-jump.itch.io/kotori-anime-character> | 网页上只写着「You can use for comercial purposes」；文件的元数据里写的是 **`CC_BY`**：要署名 | 压缩包 23.82 MB，SHA-256 以 `29220577` 开头 |

两个都是「自定价格、可以填 0」的免费下载。工坊在这两个角色导出的 GLB 里自动写上署名（`asset.copyright`）。

**Kotori 的脚也用在二次元素体上**（2026-10-31）：素体本来的脚是给穿鞋做的、没有脚趾，`node tools/run.mjs tools/build-foot.ts` 从 `kotori/Model/Kotori.vrm` 的皮肤上取下左脚（脚踝往上 3.5 厘米以下，连着它自带的小腿、脚、脚趾权重），放大 1.08 倍摆到素体的脚踝上，写成 `src/anime/footMesh.json`。所以二次元素体导出的模型里也有 Kotori 的东西：工坊在这种 GLB 里同样写上署名（「脚部网格 © Fox Jump（Kotori），CC BY」），状态栏也提醒。

## djp/（大胸的胸型，2026-10-31）

Death Joe Productions 的「CC0 Character Base Mesh Pack」（<https://deathjoeproductions.gumroad.com/l/CC0pack01>），**CC0**（页面上写着「fully CC0 Licence」，链到 <http://creativecommons.org/publicdomain/zero/1.0/>）：放弃著作权，可以随意使用、修改、再分发，不要求署名。
Gumroad 上「自定价格、可以填 0」，要填邮箱才给下载链接：是他自己下的（`G:\下载`），拷到这里。

| 文件 | 是什么 | 校验（SHA-256 开头） |
| --- | --- | --- |
| `DJP CC0 Free Base Mesh 00.obj` | 大胸的二次元素体（「busty anime body base mesh」），2.2 万个顶点 | `dc80f4cd4a57` |
| `DJP CC0 Free Base Mesh 01.obj` | 同一个身子更密的一份（5.7 万个顶点，体型丰满一点）：**工坊用的是这个** | `b4eb1190c8cc` |
| `DJP Anime Base Sculpt.obj` | 胸小的那个素体（预览图第一张） | `94406cf775c5` |
| `DJP Anime Sculpt BaseMesh 01.blend` | 同上，Blender 文件 | `6c542db0db8e` |

胸（2026-11-01 换做法，见 [docs/rework-plan.md](../../docs/rework-plan.md)）：中胸用 `DJP Anime Base Sculpt.obj`，大胸用 `DJP CC0 Free Base Mesh 01.obj`。两个模型照素体的躯干长短等比缩放、腋下对齐，在「沿躯干表面横着多远、多高、离抹平的躯干往外多远」三个坐标里原样采成距离场（胸根、胸底的缝原样保留），连同素体平胸躯干的展开图写进 `body.bin`。`00` 作为丰满版本的对照；`.blend` 为 Sculpt 的 Blender 版本，原件不修改。

```powershell
node tools/run.mjs tools/build-chest.ts --write
```

重跑 `tools/build-anime-body.mjs`、`tools/build-torso.ts` 以后要再跑一遍。

## blender-human-base-meshes/（胸口、肚子、后背的起伏，2026-11-01）

Blender Studio 的「Human Base Meshes」资源包 v1.4.1，**CC0**（下载页上写着「49 MB – CC0」）：<https://www.blender.org/download/demo-files/>，
文件实际在 <https://mirror.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip>。2026-11-01 他点名同意后下载。

| 文件 | 是什么 | 校验（SHA-256 开头） |
| --- | --- | --- |
| `human-base-meshes-bundle-v1.4.1.zip` | 原包，50.6 MB，解压出 `human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend` | `811f43accbb3` |
| `female_realistic.obj` | 写实女性全身（`GEO-body_female_realistic`，多级细分取第二级） | 由下面的命令导出 |
| `female_stylized.obj` | 风格化女性全身（`GEO-body_female_stylized`），比例偏儿童，工坊没用 | 同上 |

```powershell
& "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --disable-autoexec "assets/source/blender-human-base-meshes/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend" --python tools/export-human-base-meshes.py
node tools/run.mjs tools/build-torso.ts
```

`build-torso.ts` 用写实女性和 `djp/` 里的两个素体，只取躯干表面的起伏叠到二次元素体的躯干格子上（`body.bin` 里的 `torso`、`torsoFlat`），素材本身不进工坊。

## sketchfab-woman/（躯干起伏的第四个参考，2026-11-01）

Fly_jkey 的「Woman」：<https://sketchfab.com/3d-models/woman-b303b7606140480f8335cda121b9607c>，**CC BY 4.0**（压缩包里的 `license.txt`：「Author must be credited. Commercial use is allowed.」）。
Sketchfab 要登录才能下：是他自己下的（`G:\下载\woman.glb`、`woman.zip`），拷到这里。风格化的曲线身材（大胸、大胯），T 字姿势，1.2 万顶点，单位是厘米。

| 文件 | 是什么 | 校验（SHA-256 开头） |
| --- | --- | --- |
| `woman.glb` | 原件 | `1f6412c4b5b3` |
| `woman.zip` | 同一个模型的 glTF 版（`gltf/` 是解压出来的，带 `license.txt`） | `c94d710fee5e` |
| `woman.obj` | 用 Blender 从 glb 转的（导入 glTF、导出 OBJ，Y 朝上） | — |

只用来给 `tools/build-torso.ts` 取躯干表面的起伏（和另外三个平均），模型本身不进工坊。导出时署名写进文件：`src/anime/body.ts` 的 `TORSO_CREDIT`。

## djp-male/（阴茎、阴囊，2026-11-02）

Death Joe Productions 的「DJP Male Base Mesh Mark 03」：<https://deathjoeproductions.gumroad.com/l/MaleBM03>，**CC BY 4.0**（商品页：「License CC-BY」，<https://creativecommons.org/licenses/by/4.0/>）。
Gumroad 上 0 元起、要填邮箱：是他自己下的（`G:\下载\DJP Male Mark 03 Base Mesh.zip`），拷到这里。二次元风格的男性全身，勃起，一整块网格、没有骨骼，T 字姿势，身高 1.48 米，约 1.2 万个面。

| 文件 | 是什么 | 校验（SHA-256 开头） |
| --- | --- | --- |
| `djp-male.zip` | 原包，124.4 MB，解压出 `djp-male/DJP Male Mark 03 Base Mesh.fbx` 和 4K 贴图（贴图没用） | `a649a484dba7` |
| `djp-male/djp-male.obj` | 用 Blender 从 FBX 转的，只留身体那一大块，坐标换成工坊的（米，Y 朝上，面朝 +Z） | 由下面的命令导出 |

```powershell
& "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --disable-autoexec --python tools/export-djp-male.py
node tools/run.mjs tools/build-genital.ts
```

`build-genital.ts` 只取阴茎（切口以外原样的网格，写成 `src/anime/penisMesh.json`）和阴囊（采成距离场格子，写进 `public/genital.bin`，尺寸在 `src/anime/genitalMeta.json`），别的部分不进工坊。
导出时署名写进文件：`src/anime/genital.ts` 的 `GENITAL_CREDIT`。离线试接、出图用 `tools/try-genital.ts`（见 `docs/genital-plan.md` 第 1 期）。

## 两个男生（2026-11-07）

和最上面的样例 3 同一页（<https://opengameart.org/content/vroid-studio-cc0-models>）、同样是 pixiv 以 CC0 放出的 VRoid 旧版样例（总说明「▼CC0 license models」那一段）。他点名同意后下载，给「成品角色」好几个上半身时把某一个上半身换成男生用（男女连体，见 `BodySpec.torsoCharacters`），也能单独当一个角色选。
由 `node tools/run.mjs tools/build-characters.ts fumiriya haruto` 加工成 `public/character/fumiriya.vrm`、`haruto.vrm`（同样只把用不到的贴图换成 1×1 的占位图）；头像 `public/character/thumb/` 是文件里自带的缩略图缩成 192×192。

| 工坊里的名字 | 压缩包 / VRM | 是什么 | 许可说明 | 校验 |
| --- | --- | --- | --- | --- |
| 渐变短发男生（`fumiriya`） | `sakurada_fumiriya.zip` / `sakurada_fumiriya/Sakurada Fumiriya.vrm` | 桜田史利矢，VRoid 的男生样例角色。橙色渐变到紫色的短发，白衬衫、黑色背心 | 文件的元数据写的是 `Other` 加 VRoid Hub 条件页的网址（谁都能用、可改、可再分发、可商用、不用署名），CC0 是那一页上声明的 | 压缩包 15.86 MB，SHA-256 以 `F3C53EEA` 开头、`FC66` 结尾；VRM 19.6 MB → 加工后 11.9 MB |
| 黑短发男生（`haruto`，名字是工坊起的） | `hairsample_male.zip` / `hairsample_male/HairSample_Male.vrm` | 发型样例（HairSample_Male）。黑色短发，白色连帽外套 | 文件的元数据写着 `CC0` | 压缩包 15.47 MB，SHA-256 以 `BA874402` 开头、`0129` 结尾；VRM 18.9 MB → 加工后 11.8 MB |

下载地址是 `https://opengameart.org/sites/default/files/<压缩包名>`。同一页上还有 `base_male.zip`（男性基础模型），没有下载。

## 再四个男生（2026-11-07，VRoid Hub）

VRoid Hub 上作者把条件设成谁都能用、可改、可再分发、可商用的男生模型（照 VRoid Hub 的数据逐个核对过，文件自己的元数据里记着同样的条件）。他点名同意以后，在 Claude 自带的浏览器面板里登录 pixiv、勾「按使用条件使用」下载，存到 `G:\下载` 再拷到这里。都是 VRoid Studio 正式版导出的 VRM 0.0。
由 `node tools/run.mjs tools/build-characters.ts noble fritz shinya marron` 加工成 `public/character/<名字>.vrm`；头像是文件里的缩略图缩成 192×192（黑发礼服青年的缩略图脸偏到一边，用的是 VRoid Hub 上的立绘裁出来的脸）。

| 工坊里的名字 | 文件 | 原名 / 作者 | 网页 | 备注 | 校验（SHA-256 开头） |
| --- | --- | --- | --- | --- | --- |
| 黑发礼服青年（`noble`） | `hub_noble/6594862416337265358.vrm` | プリセット/黒髪青年（文件里叫「プリセットのみ/転生貴族風青年」）/ sin | <https://hub.vroid.com/characters/9103390712787836864/models/1189100618626473688> | 说明里写着「改変する場合は元となるモデルがあることを明記して下さい」：工坊导出时自动写上署名（roster.ts 的 credit） | 15.69 MB，`9e35a6ff9483` |
| 白衬衫少年（`fritz`） | `hub_fritz/340860444786907840.vrm` | 汎用少年キャラFritz（kiritaroOC_Fritz）/ 霧太郎 | <https://hub.vroid.com/characters/256061151319389031/models/2876490360462822712> | 不用署名；不许用于政治、诽谤 | 14.04 MB，`f5fbc48a52f2` |
| 黑白连帽衫（`shinya`） | `hub_shinya/7817070836861794693.vrm` | モノクロ男性【シンヤ】（shinya1.00）/ 中森あか | <https://hub.vroid.com/characters/1318116850280961380/models/5973900355360991383> | 不用署名；不许用于犯罪；作者没放弃著作权 | 8.46 MB，`070b83881914` |
| 棕发针织背心（`marron`） | `hub_marron/2693294445634964331.vrm` | マロン / ピカピカ | <https://hub.vroid.com/characters/7459200881471498968/models/4791607087327485063> | **性表现：不允许** | 11.82 MB，`6122d085da94` |

同一批里另有两个条件也合适、他没选的：アジサイ（ピカピカ，不许性表现）、オリジナル眼鏡おじさん（ここは通，不许性表现）。
