# Removes everything the player does not need from an administrative install tree.
param(
  [Parameter(Mandatory = $true)][string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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
  'share\extensions\solver'
)

foreach ($rel in $targets) {
  $path = Join-Path $InstallRoot $rel
  if (Test-Path $path) {
    Write-Host "prune: $rel"
    Remove-Item -Recurse -Force $path
  }
}

# Drop non-essential language packs and dictionaries but keep the UI resources.
$dicDir = Join-Path $InstallRoot 'share\extensions\dict-*'
Get-ChildItem -Path $dicDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "prune dict: $($_.Name)"
  Remove-Item -Recurse -Force $_.FullName
}

# Visual C++ runtime: the administrative install keeps it under Windows/System.
$sysDir = Join-Path $InstallRoot 'Windows\System'
$programDir = Join-Path $InstallRoot 'program'
if (Test-Path $sysDir) {
  Get-ChildItem -Path $sysDir -Filter 'msvc*.dll' | ForEach-Object {
    $dest = Join-Path $programDir $_.Name
    if (-not (Test-Path $dest)) {
      Write-Host "runtime: $($_.Name) -> program"
      Copy-Item $_.FullName $dest
    }
  }
}

$totalBytes = (Get-ChildItem -Path $InstallRoot -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ("pruned tree size: {0:N1} MB" -f ($totalBytes / 1MB))
