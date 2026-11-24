# Removes everything the player does not need from an administrative install tree
# and makes the tree self-contained (VC runtime DLLs copied next to soffice.com).
param(
  [Parameter(Mandatory = $true)][string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path $InstallRoot)) { throw "install root missing: $InstallRoot" }

$targets = @(
  'help',
  'sdk',
  'readmes',
  'share\gallery',
  'share\template',
  'share\Scripts',
  'share\autotext',
  'share\extensions\wiki-publisher',
  'share\extensions\nlpsolver',
  'share\extensions\solver',
  'share\extensions\beanshell'
)

foreach ($rel in $targets) {
  $path = Join-Path $InstallRoot $rel
  if (Test-Path $path) {
    Write-Host "prune: $rel"
    Remove-Item -Recurse -Force $path
  }
}

# Dictionary extensions are large and only used by the spell checker.
$extDir = Join-Path $InstallRoot 'share\extensions'
if (Test-Path $extDir) {
  Get-ChildItem -Path $extDir -Directory -Filter 'dict-*' -ErrorAction SilentlyContinue |
    ForEach-Object {
      Write-Host "prune dict: $($_.Name)"
      Remove-Item -Recurse -Force $_.FullName
    }
}

$programDir = Join-Path $InstallRoot 'program'
if (-not (Test-Path $programDir)) { throw "program directory missing: $programDir" }

# The MSI expects the VC++ runtime in the system directory. Copy it next to the
# binaries so the shipped tree runs without those redistributables installed.
$runtimeDlls = @(
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_2.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'concrt140.dll'
)
$systemDir = Join-Path $env:SystemRoot 'System32'
foreach ($dll in $runtimeDlls) {
  $target = Join-Path $programDir $dll
  if (Test-Path $target) { continue }
  $source = Join-Path $systemDir $dll
  if (Test-Path $source) {
    Write-Host "runtime: $dll -> program"
    Copy-Item -Path $source -Destination $target
  }
}

$totalBytes = (Get-ChildItem -Path $InstallRoot -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ("pruned tree size: {0:N1} MB" -f ($totalBytes / 1MB))

$required = @(
  'program\soffice.com',
  'program\soffice.bin',
  'share\registry\main.xcd',
  'share\filter\xslt'
)
foreach ($rel in $required) {
  if (-not (Test-Path (Join-Path $InstallRoot $rel))) {
    throw "pruned tree is missing required path: $rel"
  }
}
Write-Host 'prune checks passed.'
