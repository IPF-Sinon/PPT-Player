# Builds the pruned LibreOffice engine tree that ships inside the installer.
# Runs on windows-latest only; no local builds.
param(
  [string]$Version = '25.8.7',
  [string]$WorkDir = "$env:RUNNER_TEMP\lo-work",
  [string]$OutFile = "$env:RUNNER_TEMP\lo-engine.zip"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$manifestPath = Join-Path $PSScriptRoot '..\resources\engine.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

if ($Version -ne $manifest.version) {
  Write-Host "Manifest version $($manifest.version) differs from requested $Version; using requested version."
}

$msiPath = Join-Path $WorkDir 'LibreOffice.msi'
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

if (-not (Test-Path $msiPath)) {
  Write-Host "Downloading $($manifest.msiUrl)"
  Invoke-WebRequest -Uri $manifest.msiUrl -OutFile $msiPath -UseBasicParsing
}

$hash = (Get-FileHash -Path $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "MSI sha256: $hash"
if ($hash -ne $manifest.msiSha256.ToLowerInvariant()) {
  throw "MSI checksum mismatch: expected $($manifest.msiSha256) got $hash"
}

$adminDir = Join-Path $WorkDir 'admin'
if (Test-Path $adminDir) { Remove-Item -Recurse -Force $adminDir }
New-Item -ItemType Directory -Force -Path $adminDir | Out-Null

Write-Host "Extracting MSI into $adminDir"
$proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList @(
  '/a', "\"$msiPath\"", '/qn', "TARGETDIR=\"$adminDir\""
) -Wait -PassThru
Write-Host "msiexec exit code: $($proc.ExitCode)"
if ($proc.ExitCode -ne 0) {
  throw "msiexec /a failed with exit code $($proc.ExitCode)"
}

$tree = Get-ChildItem -Path $adminDir -Recurse -Filter 'soffice.com' | Select-Object -First 1
if (-not $tree) { throw 'soffice.com not found in administrative install tree' }
$installRoot = Split-Path (Split-Path $tree.FullName -Parent) -Parent
Write-Host "LibreOffice tree root: $installRoot"

& (Join-Path $PSScriptRoot 'prune-engine.ps1') -InstallRoot $installRoot

# Smoke gate: the pruned tree must convert three fixture formats.
$soffice = Join-Path $installRoot 'program\soffice.com'
if (-not (Test-Path $soffice)) { throw "soffice.com missing after prune: $soffice" }

$smokeDir = Join-Path $WorkDir 'smoke'
New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null

$fixtures = @('smoke.pptx', 'smoke.ppt', 'smoke.odp')
foreach ($fixture in $fixtures) {
  $source = Join-Path $PSScriptRoot "..\tests\fixtures\$fixture"
  if (-not (Test-Path $source)) { throw "missing smoke fixture $source" }
  $out = Join-Path $smokeDir ([System.IO.Path]::GetFileNameWithoutExtension($fixture))
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $profileDir = Join-Path $smokeDir ('profile-' + [guid]::NewGuid().ToString('N'))
  $args = @(
    '--headless', '--norestore', '--invisible', '--nologo',
    "-env:UserInstallation=file:///$($profileDir -replace '\\','/')",
    '--convert-to', 'pdf:impress_pdf_Export', '--outdir', $out, $source
  )
  $p = Start-Process -FilePath $soffice -ArgumentList $args -Wait -PassThru -NoNewWindow
  $pdf = Join-Path $out 'smoke.pdf'
  if (-not (Test-Path $pdf)) { throw "smoke conversion produced no PDF for $fixture (exit $($p.ExitCode))" }
  $size = (Get-Item $pdf).Length
  Write-Host "smoke $fixture -> $size bytes"
  if ($size -lt 1024) { throw "smoke PDF for $fixture is too small: $size bytes" }
}

if (Test-Path $OutFile) { Remove-Item -Force $OutFile }
Write-Host "Compressing engine to $OutFile"
& 'C:\Program Files\7-Zip\7z.exe' a -mx=9 -tzip $OutFile "$installRoot\*" | Out-Null
$zipSize = (Get-Item $OutFile).Length
Write-Host "Engine zip size: $([math]::Round($zipSize/1MB,1)) MB"

# Write a small marker for downstream steps.
$marker = Join-Path $WorkDir 'engine-info.json'
@{
  version = $manifest.version
  msiSha256 = $manifest.msiSha256
  zipBytes = $zipSize
  builtAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -Path $marker -Encoding utf8
Write-Host "Engine build finished."
