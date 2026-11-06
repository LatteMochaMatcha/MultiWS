# 生成软件内自动更新用的签名钥匙（一次就够，见 docs/update-plan.md）。用法：pwsh -File tools/update-keygen.ps1
#
#   - 私钥：放在仓库外，默认 ~/.oc-update-key/private.pem。发版时 tools/release.ps1 用它给 latest.json 签名。
#     自己另外备份一份。弄丢了，已经装好的 exe/apk 就再也收不到更新（只能重新下载安装包）。
#   - 公钥：写进仓库的 tools/update/，打包时放进外壳，外壳用它核对签名。
#       public-key.xml       给 exe（.NET Framework 的 RSACryptoServiceProvider.FromXmlString）
#       public-key.spki.b64  给 apk（Java 的 X509EncodedKeySpec），一行 base64
#
# 已经有私钥时不会覆盖；真要换钥匙，先自己把旧的挪走（换钥匙等于所有外壳都要重装）。
param([string]$KeyDir = (Join-Path $HOME '.oc-update-key'))
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$private = Join-Path $KeyDir 'private.pem'
$public = Join-Path $root 'tools\update'
if (Test-Path -LiteralPath $private) { throw "已经有私钥了：$private（不覆盖）" }

New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
$rsa = [System.Security.Cryptography.RSA]::Create(3072)
try {
  [System.IO.File]::WriteAllText($private, $rsa.ExportPkcs8PrivateKeyPem() + "`n", [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $public 'public-key.xml'), $rsa.ToXmlString($false) + "`n", [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $public 'public-key.spki.b64'), [Convert]::ToBase64String($rsa.ExportSubjectPublicKeyInfo()) + "`n", [System.Text.UTF8Encoding]::new($false))
}
finally { $rsa.Dispose() }

# 私钥文件只给自己读
icacls $private /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
"私钥：$private（记得另外备份）"
"公钥：$public\public-key.xml、public-key.spki.b64"
