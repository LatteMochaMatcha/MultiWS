# 把工坊打成一个双击就能用的 exe，连同使用说明压成一个 zip，放在 release 文件夹里。
# 给没装 Node.js 的人用。用法：npm run pack（会先 npm run build）。
#
# 只用 Windows 自带的东西：.NET Framework 的 C# 编译器（csc.exe）。做四件事：
#   1. 把打包好的网页（dist 文件夹）压成 app.zip；
#   2. 画一个图标；
#   3. 把 tools/launcher/ 里的 Launcher.cs、Updater.cs 编成 exe，app.zip 嵌在里面；
#   4. exe 和使用说明一起压成 zip。
# -OutDir <目录>：放到别处（试打包时不覆盖 release 里的）
param([string]$OutDir)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root 'dist'
$release = if ($OutDir) { $OutDir } else { Join-Path $root 'release' }
$name = 'OC白模工坊'
$package = "$name-v2"
# 版本号只在 package.json 里写一处；exe 属性里的版本是四段数字，不够的补 0
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+(\.\d+){0,3}$') { throw "package.json 的版本号要是几段数字（例如 2.7.2）：$version" }
$parts = @($version.Split('.'))
while ($parts.Count -lt 4) { $parts += '0' }
$assemblyVersion = $parts -join '.'

# 编进 exe 的东西：版本号、核对更新签名的公钥、下载站（tools/update/）。生成一个 Build.cs 和 Launcher.cs、Updater.cs 一起编
function New-BuildInfo {
  $update = Join-Path $PSScriptRoot 'update'
  $key = (Get-Content -LiteralPath (Join-Path $update 'public-key.xml') -Raw).Trim()
  $config = Get-Content -LiteralPath (Join-Path $update 'config.json') -Raw | ConvertFrom-Json
  $quote = { param($s) '"' + ($s -replace '\\', '\\' -replace '"', '\"') + '"' }
  $sources = ($config.sources | ForEach-Object { 'new string[] { ' + (& $quote $_.base) + ', ' + (& $quote $_.objects) + ' }' }) -join ', '
  @"
using System.Reflection;
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
[assembly: AssemblyInformationalVersion("$version")]

static class BuildInfo
{
    public const string Version = $(& $quote $version);
    // 外壳的版本（tools/update/config.json 的 shell）：清单的 minShell、新安装包的 shell 都和它比
    public const int Shell = $([int]$(if ($config.shell) { $config.shell } else { 1 }));
    public const string PublicKeyXml = $(& $quote $key);
    // 下载站，按顺序试：{ 清单所在的地址, 文件在这个地址下的前缀 }
    public static readonly string[][] Sources = new string[][] { $sources };
}
"@
}

if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw '还没有打包好的网页：先运行 npm run build' }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "没找到 Windows 自带的 C# 编译器：$csc" }

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

# 图标：青色的圆角方块，上面写着 OC。一个 .ico 里放几种大小，每种是一张 PNG
function New-IconFile([string]$Path) {
  $pictures = foreach ($size in 256, 64, 48, 32, 16) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $corner = [single]($size * 0.44)
    $far = [single]($size - $corner)
    $outline = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $outline.AddArc([single]0, [single]0, $corner, $corner, [single]180, [single]90)
    $outline.AddArc($far, [single]0, $corner, $corner, [single]270, [single]90)
    $outline.AddArc($far, $far, $corner, $corner, [single]0, [single]90)
    $outline.AddArc([single]0, $far, $corner, $corner, [single]90, [single]90)
    $outline.CloseFigure()
    $fill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(0x0d, 0x78, 0x83))
    $graphics.FillPath($fill, $outline)
    $font = [System.Drawing.Font]::new('Segoe UI', [single]($size * 0.44), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $centered = [System.Drawing.StringFormat]::new()
    $centered.Alignment = [System.Drawing.StringAlignment]::Center
    $centered.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString('OC', $font, [System.Drawing.Brushes]::White, [System.Drawing.RectangleF]::new(0, 0, $size, $size), $centered)
    $graphics.Dispose()
    $stream = [System.IO.MemoryStream]::new()
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    [pscustomobject]@{ Size = $size; Bytes = $stream.ToArray() }
  }
  $file = [System.IO.File]::Create($Path)
  $writer = [System.IO.BinaryWriter]::new($file)
  # 文件头：保留、类型（1 是图标）、张数
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$pictures.Count)
  $offset = 6 + 16 * $pictures.Count
  foreach ($picture in $pictures) {
    # 宽、高（256 写成 0）、调色板、保留、色彩平面数、每像素位数、数据长度、数据从哪开始
    $edge = [byte]($picture.Size -band 0xff)
    $writer.Write($edge); $writer.Write($edge); $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$picture.Bytes.Length); $writer.Write([uint32]$offset)
    $offset += $picture.Bytes.Length
  }
  foreach ($picture in $pictures) { $writer.Write([byte[]]$picture.Bytes) }
  $writer.Dispose()
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) "oc-pack-$PID"
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $appZip = Join-Path $work 'app.zip'
  [System.IO.Compression.ZipFile]::CreateFromDirectory($dist, $appZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

  $icon = Join-Path $work 'icon.ico'
  New-IconFile $icon

  $stage = Join-Path $work $package
  New-Item -ItemType Directory -Path $stage | Out-Null
  $exe = Join-Path $stage "$name.exe"
  $buildCs = Join-Path $work 'Build.cs'
  [System.IO.File]::WriteAllText($buildCs, (New-BuildInfo), [System.Text.UTF8Encoding]::new($false))
  & $csc /nologo /target:exe /optimize+ /codepage:65001 "/out:$exe" "/win32icon:$icon" "/resource:$appZip,app.zip" /reference:System.IO.Compression.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'launcher\Launcher.cs') (Join-Path $PSScriptRoot 'launcher\Updater.cs') (Join-Path $PSScriptRoot 'launcher\AiForward.cs') $buildCs
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) { throw 'exe 没编出来，看上面编译器的提示' }

  # 使用说明带上 BOM：老一点的记事本靠它认出这是 UTF-8，不然中文会乱码
  $guide = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'launcher\使用说明.txt') -Raw
  [System.IO.File]::WriteAllText((Join-Path $stage '使用说明.txt'), $guide.Replace("`r`n", "`n").Replace("`n", "`r`n"), [System.Text.UTF8Encoding]::new($true))
  # 英文、日文版的说明（在的话）也一样处理，一起放进去
  foreach ($guideName in 'Guide-en.txt', 'ガイド-ja.txt') {
    $guidePath = Join-Path $PSScriptRoot "launcher\$guideName"
    if (-not (Test-Path -LiteralPath $guidePath)) { continue }
    $text = Get-Content -LiteralPath $guidePath -Raw
    [System.IO.File]::WriteAllText((Join-Path $stage $guideName), $text.Replace("`r`n", "`n").Replace("`n", "`r`n"), [System.Text.UTF8Encoding]::new($true))
  }

  # release 文件夹里还可能有 npm run apk 生成的安卓安装包：只换自己的这几样
  if (-not (Test-Path $release)) { New-Item -ItemType Directory -Path $release | Out-Null }
  Copy-Item -Path (Join-Path $stage '*') -Destination $release -Force
  $zip = Join-Path $release "$package.zip"
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $true)

  Get-ChildItem $release | ForEach-Object { '{0,-24} {1,6:N1} MB' -f $_.Name, ($_.Length / 1MB) }
}
finally {
  Remove-Item -LiteralPath $work -Recurse -Force
}
