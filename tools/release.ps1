# 发一个软件内自动更新的新版本（方案见 docs/update-plan.md）。用法：
#   npm run release -- -NotesZh "修了手" -NotesEn "Fixed hands" -NotesJa "手を修正"
#   npm run release -- -DryRun      只在 release/update/ 里生成文件，不上传
#
# 做五件事：
#   1. 打包网页（npm run build；加 -SkipBuild 就用现有的 dist）；
#   2. 写清单 latest.json（dist 里每个文件的路径、大小、sha256，加上更新说明）；
#   3. 用私钥签名，得到 latest.json.sig；
#   4. 把下载站上还没有的文件按 sha256 命名传上去：R2 存成 objects/<sha256>，GitHub 的 update-store 那个 Release 里存成 <sha256>；
#   5. 文件都传完以后，才传 latest.json 和签名。这样别人不会读到新清单时文件还没传完。
#
# 上传要两样凭据：Cloudflare（先运行一次 npx wrangler login）和 GitHub（gh 已经登录）。
# 私钥默认在 ~/.oc-update-key/private.pem，没有的话先运行 tools/update-keygen.ps1。
param(
  [string]$NotesZh = '',
  [string]$NotesEn = '',
  [string]$NotesJa = '',
  [switch]$DryRun,
  [switch]$SkipBuild,
  # 下载站上已经是这个版本（或更新的）时默认不发，免得旧外壳收不到「更新」；确实要重发同一版时加 -Force
  [switch]$Force,
  [string]$KeyPath = (Join-Path $HOME '.oc-update-key\private.pem')
)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root 'dist'
$out = Join-Path $root 'release\update'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'update\config.json') -Raw | ConvertFrom-Json
$r2Base = $config.sources[0].base
$wrangler = 'wrangler@4'

function Invoke-Checked([scriptblock]$Command, [string]$What) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What 失败（退出码 $LASTEXITCODE）" }
}

# 上传偶尔会碰上网络闪断：最多试三次，每次之间等一会儿。重传同一个文件是安全的（按 sha256 命名，内容一样）
function Invoke-Retried([scriptblock]$Command, [string]$What) {
  for ($attempt = 1; ; $attempt++) {
    & $Command
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -ge 3) { throw "$What 失败（试了 $attempt 次，退出码 $LASTEXITCODE）" }
    Write-Warning "$What 失败，$($attempt * 5) 秒后重试"
    Start-Sleep -Seconds ($attempt * 5)
  }
}

# 签名：RSA、SHA-256、PKCS#1 v1.5。exe（.NET Framework）和 apk（Java 的 SHA256withRSA）都认这一种
function New-Signature([string]$DataPath, [string]$SignaturePath) {
  $rsa = [System.Security.Cryptography.RSA]::Create()
  try {
    $rsa.ImportFromPem((Get-Content -LiteralPath $KeyPath -Raw))
    $signature = $rsa.SignData([System.IO.File]::ReadAllBytes($DataPath), [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
  }
  finally { $rsa.Dispose() }
  [System.IO.File]::WriteAllText($SignaturePath, [Convert]::ToBase64String($signature) + "`n", [System.Text.UTF8Encoding]::new($false))
}

# 用仓库里的公钥再核对一遍刚签的名，私钥和公钥对不上时在这里就发现
function Test-Signature([string]$DataPath, [string]$SignaturePath) {
  $rsa = [System.Security.Cryptography.RSA]::Create()
  try {
    $rsa.FromXmlString((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'update\public-key.xml') -Raw))
    $signature = [Convert]::FromBase64String((Get-Content -LiteralPath $SignaturePath -Raw).Trim())
    return $rsa.VerifyData([System.IO.File]::ReadAllBytes($DataPath), $signature, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
  }
  finally { $rsa.Dispose() }
}

# R2 上有没有这个文件：直接问公开地址，不用凭据
function Test-R2Object([string]$Key) {
  $code = curl.exe -s -o NUL -I -w '%{http_code}' --max-time 20 "$r2Base$Key"
  if ($code -eq '200') { return $true }
  if ($code -eq '404') { return $false }
  throw "问 R2 上有没有 $Key 时出错（HTTP $code）"
}

# 下载站上现在的版本号，读不到（第一次发、连不上）返回 $null
function Get-PublishedVersion {
  try {
    $text = curl.exe -s -f --max-time 20 "${r2Base}latest.json"
    if ($LASTEXITCODE -ne 0 -or -not $text) { return $null }
    return ($text | Out-String | ConvertFrom-Json).version
  }
  catch { return $null }
}

if (-not (Test-Path -LiteralPath $KeyPath)) { throw "没找到签名私钥：$KeyPath（先运行 tools/update-keygen.ps1）" }

# ---- 1. 打包 ----
if (-not $SkipBuild) {
  Push-Location $root
  try { Invoke-Checked { npm run build } '打包网页' }
  finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw '还没有打包好的网页：先运行 npm run build' }

# ---- 2. 清单 ----
if (Test-Path $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null
$notes = [ordered]@{}
if ($NotesZh) { $notes.zh = $NotesZh }
if ($NotesEn) { $notes.en = $NotesEn }
if ($NotesJa) { $notes.ja = $NotesJa }
if ($notes.Count -eq 0) { Write-Warning '没写更新说明（-NotesZh / -NotesEn / -NotesJa），提示卡片上就只有版本号' }
$notesFile = Join-Path $out 'notes.json'
[System.IO.File]::WriteAllText($notesFile, ($notes | ConvertTo-Json -Compress), [System.Text.UTF8Encoding]::new($false))
$latest = Join-Path $out 'latest.json'
Push-Location $root
try { Invoke-Checked { node tools/run.mjs tools/update-manifest.ts --notes $notesFile --out $latest } '写清单' }
finally { Pop-Location }
Remove-Item -LiteralPath $notesFile
$manifest = Get-Content -LiteralPath $latest -Raw | ConvertFrom-Json

# ---- 3. 签名 ----
$signature = Join-Path $out 'latest.json.sig'
New-Signature $latest $signature
if (-not (Test-Signature $latest $signature)) { throw '刚签的名用仓库里的公钥核对不上：私钥和 tools/update/public-key.xml 不是一对' }
"清单：$($manifest.version)，$($manifest.files.Count) 个文件，已签名"

# ---- 4. 要传哪些文件 ----
# 同样的内容只传一份；文件也拷到 release/update/objects/ 里，DryRun 时可以看
$objects = Join-Path $out 'objects'
New-Item -ItemType Directory -Path $objects | Out-Null
$unique = [ordered]@{}
foreach ($file in $manifest.files) {
  if (-not $unique.Contains($file.sha256)) { $unique[$file.sha256] = $file }
}
foreach ($file in $unique.Values) {
  Copy-Item -LiteralPath (Join-Path $dist ($file.path -replace '/', '\')) -Destination (Join-Path $objects $file.sha256)
}
$totalMB = ($unique.Values | Measure-Object size -Sum).Sum / 1MB
'{0} 份不同的内容，共 {1:N1} MB，在 {2}' -f $unique.Count, $totalMB, $objects

if ($DryRun) {
  '-DryRun：不上传。'
  return
}

$published = Get-PublishedVersion
if ($published) {
  $newer = [version]($manifest.version + ('.0' * (3 - ($manifest.version.Split('.').Count - 1))))
  $old = [version]($published + ('.0' * (3 - ($published.Split('.').Count - 1))))
  if ($newer -le $old -and -not $Force) { throw "下载站上已经是 $published 了，这次是 $($manifest.version)：先把 package.json 的版本号往上加（确实要重发加 -Force）" }
}

# ---- 4. 传文件：R2 ----
$toR2 = @($unique.Keys | Where-Object { -not (Test-R2Object "objects/$_") })
'R2：要传 {0} 个，其余已经有了' -f $toR2.Count
foreach ($sha in $toR2) {
  Invoke-Retried { npx --yes $wrangler r2 object put "$($config.r2Bucket)/objects/$sha" --file (Join-Path $objects $sha) --content-type 'application/octet-stream' --cache-control 'public, max-age=31536000, immutable' --remote } "传 objects/$sha 到 R2"
}

# ---- 4. 传文件：GitHub ----
$repo = $config.githubRepo
$tag = $config.githubTag
gh release view $tag -R $repo --json tagName 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  # 一个固定的 Release 专门放更新文件：标成预发布、不当最新版，Release 页面上排在正式版后面
  Invoke-Checked { gh release create $tag -R $repo --prerelease --latest=false --title '自动更新文件（不用手动下载）' --notes '软件内自动更新用的文件，按内容的 sha256 命名。要下载工坊请看正式版的 Release。' } '建 update-store Release'
}
$onGitHub = @(gh release view $tag -R $repo --json assets -q '.assets[].name')
if ($LASTEXITCODE -ne 0) { throw '读 update-store 里的文件列表失败' }
$toGitHub = @($unique.Keys | Where-Object { $onGitHub -notcontains $_ })
'GitHub：要传 {0} 个，其余已经有了' -f $toGitHub.Count
foreach ($sha in $toGitHub) {
  Invoke-Retried { gh release upload $tag -R $repo (Join-Path $objects $sha) } "传 $sha 到 GitHub"
}

# ---- 5. 最后传清单和签名 ----
foreach ($name in 'latest.json', 'latest.json.sig') {
  $type = if ($name -eq 'latest.json') { 'application/json' } else { 'text/plain' }
  Invoke-Retried { npx --yes $wrangler r2 object put "$($config.r2Bucket)/$name" --file (Join-Path $out $name) --content-type $type --cache-control 'no-cache' --remote } "传 $name 到 R2"
}
Invoke-Retried { gh release upload $tag -R $repo (Join-Path $out 'latest.json') (Join-Path $out 'latest.json.sig') --clobber } '传清单到 GitHub'

"发好了：$($manifest.version)"
