$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$wccRelativePath = "resources\app.asar.unpacked\node_modules\wcc-exec\wcc.exe"
$candidateRoots = @()
if ($env:WECHAT_DEVTOOLS_PATH) {
  $candidateRoots += $env:WECHAT_DEVTOOLS_PATH
}

$tencentParents = @(
  (Join-Path ${env:ProgramFiles(x86)} "Tencent"),
  (Join-Path $env:ProgramFiles "Tencent"),
  $env:LOCALAPPDATA
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

foreach ($parent in $tencentParents) {
  $candidateRoots += Get-ChildItem -LiteralPath $parent -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $wccRelativePath) } |
    ForEach-Object FullName
}

$toolRoot = $candidateRoots | Where-Object {
  Test-Path -LiteralPath (Join-Path $_ $wccRelativePath)
} | Select-Object -First 1

if (-not $toolRoot) {
  throw "WeChat DevTools was not found. Set WECHAT_DEVTOOLS_PATH to its install directory."
}

$compilerRoot = Join-Path $toolRoot "resources\app.asar.unpacked\node_modules\wcc-exec"
$wcc = Join-Path $compilerRoot "wcc.exe"
$wcsc = Join-Path $compilerRoot "wcsc.exe"
$miniProgramRoot = Join-Path $projectRoot "miniprogram"

Push-Location $projectRoot
try {
  $wxmlFiles = Get-ChildItem -LiteralPath $miniProgramRoot -Recurse -Filter "*.wxml" -File
  foreach ($file in $wxmlFiles) {
    $relative = $file.FullName.Substring($projectRoot.Length + 1).Replace("\", "/")
    $compilerOutput = & $wcc $relative 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "WXML compilation failed: $relative`n$($compilerOutput -join "`n")"
    }
    Write-Host "WXML OK  $relative"
  }

  $wxssFiles = Get-ChildItem -LiteralPath $miniProgramRoot -Recurse -Filter "*.wxss" -File
  foreach ($file in $wxssFiles) {
    $relative = $file.FullName.Substring($projectRoot.Length + 1).Replace("\", "/")
    $compilerOutput = & $wcsc -lc $relative 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "WXSS compilation failed: $relative`n$($compilerOutput -join "`n")"
    }
    Write-Host "WXSS OK  $relative"
  }

  Write-Host "Native compiler checks passed: $($wxmlFiles.Count) WXML, $($wxssFiles.Count) WXSS."
}
finally {
  Pop-Location
}
