# 把工坊打成安卓安装包（apk），放在 release 文件夹里。给手机用。用法：npm run apk（会先 npm run build）。
#
# 不用 Android Studio，也不用 Gradle。只要两样东西，位置从环境变量里找：
#   - JDK（JAVA_HOME）：用里面的 javac、keytool；
#   - 安卓 SDK（ANDROID_HOME）：用 build-tools 里的 aapt2、d8、zipalign、apksigner，和 platforms 里的 android.jar。
# 做六件事：
#   1. 画图标上的字；
#   2. aapt2 把外壳的资源和打包好的网页（dist 文件夹）装进安装包；
#   3. javac 编外壳（tools/android/src 里那一个 Java 文件）；
#   4. d8 把它转成安卓认的格式，塞进安装包；
#   5. zipalign 对齐；
#   6. apksigner 签名。
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root 'dist'
$shell = Join-Path $PSScriptRoot 'android'
$release = Join-Path $root 'release'
$name = 'OC白模工坊'
# 安卓 10 起存文件不用申请权限；写 34 是因为 35 会强制把页面铺到状态栏底下
$minSdk = 29
$targetSdk = 34
# 签名用的钥匙：只是为了让新版能盖在旧版上装（安卓要求两次的签名一样），不是什么秘密。
# 第一次打包时生成，留在 tools/android 里；弄丢了的话，新打的包装不上去，手机上要先卸掉旧的
$keystore = Join-Path $shell 'sign.keystore'
$keyAlias = 'oc'
$keyPass = 'oc-basemesh'

if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw '还没有打包好的网页：先运行 npm run build' }

# ---- 找工具 ----
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if (-not $sdk -or -not (Test-Path $sdk)) { throw '没找到安卓 SDK：环境变量 ANDROID_HOME 要指向它' }
$buildTools = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^\d+(\.\d+)+$' -and (Test-Path (Join-Path $_.FullName 'aapt2.exe')) } |
  Sort-Object { [version]$_.Name } | Select-Object -Last 1
if (-not $buildTools) { throw "安卓 SDK 里没有 build-tools：$sdk" }
$platform = Get-ChildItem (Join-Path $sdk 'platforms') -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^android-\d+$' -and (Test-Path (Join-Path $_.FullName 'android.jar')) } |
  Sort-Object { [int]($_.Name -replace '\D', '') } | Select-Object -Last 1
if (-not $platform) { throw "安卓 SDK 里没有 platforms（要其中的 android.jar）：$sdk" }
$androidJar = Join-Path $platform.FullName 'android.jar'
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
$aapt2 = Join-Path $buildTools.FullName 'aapt2.exe'
$d8 = Join-Path $buildTools.FullName 'd8.bat'
$zipalign = Join-Path $buildTools.FullName 'zipalign.exe'
$apksigner = Join-Path $buildTools.FullName 'apksigner.bat'

function Find-JavaTool([string]$Tool) {
  if ($env:JAVA_HOME) {
    $inHome = Join-Path $env:JAVA_HOME "bin\$Tool.exe"
    if (Test-Path $inHome) { return $inHome }
  }
  $onPath = Get-Command $Tool -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  throw "没找到 $Tool：要装 JDK，并让环境变量 JAVA_HOME 指向它"
}
$javac = Find-JavaTool 'javac'
$keytool = Find-JavaTool 'keytool'

# 每一步跑完看一眼退出码，出错就停
function Assert-Step([string]$What) {
  if ($LASTEXITCODE -ne 0) { throw "$What 这一步没成功，看上面的提示" }
}

Add-Type -AssemblyName System.Drawing

# 图标上的字：白色的 OC，画在一张透明的图上（底色是资源里的青色，系统自己裁成圆的或方的）。
# 整张图 108 个单位见方，系统只保证中间 66 个单位不被裁掉，字要落在那里面
function New-IconFront([string]$Path) {
  $size = 432
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $font = [System.Drawing.Font]::new('Segoe UI', [single]($size * 0.3), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $centered = [System.Drawing.StringFormat]::new()
  $centered.Alignment = [System.Drawing.StringAlignment]::Center
  $centered.LineAlignment = [System.Drawing.StringAlignment]::Center
  $graphics.DrawString('OC', $font, [System.Drawing.Brushes]::White, [System.Drawing.RectangleF]::new(0, 0, $size, $size), $centered)
  $graphics.Dispose()
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

# 版本名跟着 package.json；版本号用打包的时刻（年月日时），后打的包就能盖在先打的上面装
$versionName = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$versionCode = [int](Get-Date -Format 'yyMMddHH')

# 安卓的打包工具不一定认带汉字的路径：所有东西先拷到临时文件夹里，在那边打
$work = Join-Path ([System.IO.Path]::GetTempPath()) "oc-apk-$PID"
New-Item -ItemType Directory -Path $work | Out-Null
try {
  Copy-Item -LiteralPath (Join-Path $shell 'res') -Destination (Join-Path $work 'res') -Recurse
  Copy-Item -LiteralPath (Join-Path $shell 'src') -Destination (Join-Path $work 'src') -Recurse
  Copy-Item -LiteralPath (Join-Path $shell 'AndroidManifest.xml') -Destination $work
  $assets = Join-Path $work 'assets'
  New-Item -ItemType Directory -Path $assets | Out-Null
  $www = Join-Path $assets 'www'
  Copy-Item -LiteralPath $dist -Destination $www -Recurse

  # 1. 图标
  $front = Join-Path $work 'res\drawable-xxxhdpi'
  New-Item -ItemType Directory -Path $front | Out-Null
  New-IconFront (Join-Path $front 'ic_launcher_front.png')

  # 2. 资源。网页不在这一步装：aapt2 在 Windows 上会把文件夹里的路径写成反斜杠，手机上就找不到了
  $compiled = Join-Path $work 'res.zip'
  & $aapt2 compile --dir (Join-Path $work 'res') -o $compiled
  Assert-Step 'aapt2 compile（编资源）'
  $apk = Join-Path $work 'base.apk'
  & $aapt2 link -o $apk -I $androidJar --manifest (Join-Path $work 'AndroidManifest.xml') `
    --min-sdk-version $minSdk --target-sdk-version $targetSdk --version-code $versionCode --version-name $versionName $compiled
  Assert-Step 'aapt2 link（装资源）'

  # 3. 外壳。-source / -target 11：新的 JDK 默认编出来的格式 d8 不一定认
  $classes = Join-Path $work 'classes'
  New-Item -ItemType Directory -Path $classes | Out-Null
  $sources = @(Get-ChildItem (Join-Path $work 'src') -Recurse -Filter '*.java' | ForEach-Object FullName)
  # -J-Duser.language=en：提示用英文印，不然中文提示在这个窗口里是乱码
  & $javac '-J-Duser.language=en' -encoding UTF-8 -source 11 -target 11 '-Xlint:-options' -XDsuppressNotes -classpath $androidJar -d $classes @sources
  Assert-Step 'javac（编外壳）'

  # 4. 转成安卓的格式（classes.dex），连同网页一起塞进安装包。
  #    包里的名字就是这里给的相对路径：站在临时文件夹里，用正斜杠一个个报
  $compiledClasses = @(Get-ChildItem $classes -Recurse -Filter '*.class' | ForEach-Object FullName)
  & $d8 --release --min-api $minSdk --lib $androidJar --output $work @compiledClasses
  Assert-Step 'd8（转格式）'
  $pages = @(Get-ChildItem $www -Recurse -File | ForEach-Object {
      'assets/www/' + $_.FullName.Substring($www.Length + 1).Replace('\', '/')
    })
  Push-Location $work
  try { & $aapt add $apk 'classes.dex' @pages | Out-Null } finally { Pop-Location }
  Assert-Step 'aapt add（塞进安装包）'

  # 5. 对齐
  $aligned = Join-Path $work 'aligned.apk'
  & $zipalign -f -p 4 $apk $aligned
  Assert-Step 'zipalign（对齐）'

  # 6. 签名。钥匙第一次用时生成
  $key = Join-Path $work 'sign.keystore'
  if (Test-Path $keystore) {
    Copy-Item -LiteralPath $keystore -Destination $key
  }
  else {
    & $keytool '-J-Duser.language=en' -genkeypair -keystore $key -storetype PKCS12 -storepass $keyPass -alias $keyAlias `
      -keyalg RSA -keysize 2048 -validity 36500 -dname 'CN=OC Basemesh Workshop' 2>&1 | Out-Null
    Assert-Step 'keytool（生成签名用的钥匙）'
    Copy-Item -LiteralPath $key -Destination $keystore
    "生成了签名用的钥匙：$keystore（留着，以后打的包要用同一把）"
  }
  $signed = Join-Path $work 'signed.apk'
  & $apksigner sign --ks $key --ks-key-alias $keyAlias --ks-pass "pass:$keyPass" --out $signed $aligned
  Assert-Step 'apksigner sign（签名）'
  & $apksigner verify $signed
  Assert-Step 'apksigner verify（核对签名）'

  # release 文件夹里还有 npm run pack 生成的 exe 和压缩包：只换安装包这一个
  if (-not (Test-Path $release)) { New-Item -ItemType Directory -Path $release | Out-Null }
  $out = Join-Path $release "$name.apk"
  Copy-Item -LiteralPath $signed -Destination $out -Force

  $badging = & $aapt2 dump badging $signed
  $badging | Where-Object { $_ -match '^(package:|minSdkVersion:|sdkVersion:|targetSdkVersion:|uses-permission)' }
  '{0,-24} {1,6:N1} MB' -f "$name.apk", ((Get-Item -LiteralPath $out).Length / 1MB)
}
finally {
  Remove-Item -LiteralPath $work -Recurse -Force
}
