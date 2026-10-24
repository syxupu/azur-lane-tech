$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '请先安装 Node.js 20 或更高版本，然后重新运行此脚本。'
    exit 1
}
$nativeArgs = @((Join-Path $PSScriptRoot 'scripts/server.mjs'), '--open')
& node @nativeArgs
exit $LASTEXITCODE
