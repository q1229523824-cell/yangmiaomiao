param([int]$AutomationPort = 9420)
$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$cliCandidates = @()
if ($env:WECHAT_DEVTOOLS_PATH) {
  $cliCandidates += Join-Path $env:WECHAT_DEVTOOLS_PATH "cli.bat"
}
foreach ($parent in @((Join-Path ${env:ProgramFiles(x86)} "Tencent"), (Join-Path $env:ProgramFiles "Tencent"))) {
  if (Test-Path -LiteralPath $parent) {
    $cliCandidates += Get-ChildItem -LiteralPath $parent -Directory |
      ForEach-Object { Join-Path $_.FullName "cli.bat" }
  }
}
$cli = $cliCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $cli) { throw "Set WECHAT_DEVTOOLS_PATH to an installed WeChat DevTools directory." }
Push-Location $projectRoot
try {
  & $cli auto --project $projectRoot --auto-port $AutomationPort --trust-project
  if ($LASTEXITCODE -ne 0) { throw "WeChat automation could not start. Sign into DevTools and enable its CLI service." }
  $env:WECHAT_AUTOMATION_PORT = [string]$AutomationPort
  & (Join-Path $projectRoot "node_modules\.bin\vite-node.cmd") (Join-Path $PSScriptRoot "verify-simulator.ts")
  if ($LASTEXITCODE -ne 0) { throw "Simulator acceptance failed. Check artifacts/simulator for report and restore backup." }
} finally {
  Pop-Location
}
