# Builds the pruned LibreOffice engine tree that ships inside the installer.
# Runs on windows-latest only; nothing is built locally.
param(
  [string]$WorkDir = "$env:RUNNER_TEMP\lo-work",
  [string]$OutFile = "$env:RUNNER_TEMP\lo-engine.zip"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path $PSScriptRoot -Parent
$manifestPath = Join-Path $repoRoot 'resources\engine.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$msiPath = Join-Path $WorkDir 'LibreOffice.msi'

if (-not (Test-Path $msiPath)) {
  Write-Host "Downloading $($manifest.msiUrl)"
  & curl.exe -L --fail --retry 3 --retry-delay 5 -o $msiPath $manifest.msiUrl
  if ($LASTEXITCODE -ne 0) { throw "download failed with exit code $LASTEXITCODE" }
}

$sizeMb = [math]::Round((Get-Item $msiPath).Length / 1MB, 1)
Write-Host "MSI size: $sizeMb MB"
$hash = (Get-FileHash -Path $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "MSI sha256: $hash"
if ($hash -ne $manifest.msiSha256.ToLowerInvariant()) {
  throw "MSI checksum mismatch: expected $($manifest.msiSha256) got $hash"
}

# Administrative install extracts the payload without touching the registry.
$adminDir = Join-Path $WorkDir 'admin'
if (Test-Path $adminDir) { Remove-Item -Recurse -Force $adminDir }
New-Item -ItemType Directory -Force -Path $adminDir | Out-Null

Write-Host "Extracting MSI into $adminDir"
$msiLog = Join-Path $WorkDir 'msiexec.log'
if (Test-Path $msiLog) { Remove-Item -Force $msiLog }

# msiexec detaches from the caller, so it must be waited on explicitly.
$q = [char]34
$msiArgs = @(
  '/a',
  ($q + $msiPath + $q),
  '/qn',
  '/l*v',
  ($q + $msiLog + $q),
  ('TARGETDIR=' + $q + $adminDir + $q)
)
$proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $msiArgs -Wait -PassThru -NoNewWindow
Write-Host "msiexec exit code: $($proc.ExitCode)"
if ($proc.ExitCode -ne 0) {
  if (Test-Path $msiLog) { Get-Content $msiLog -Tail 40 }
  throw "msiexec /a failed with exit code $($proc.ExitCode)"
}

$extracted = @(Get-ChildItem -Path $adminDir -Recurse -File -ErrorAction SilentlyContinue)
Write-Host "extracted files: $($extracted.Count)"
if ($extracted.Count -eq 0) {
  if (Test-Path $msiLog) { Get-Content $msiLog -Tail 60 }
  throw "administrative install produced no files in $adminDir"
}

$sofficeHit = $extracted | Where-Object { $_.Name -eq 'soffice.com' } | Select-Object -First 1
if (-not $sofficeHit) {
  $extracted | Select-Object -First 30 | ForEach-Object { Write-Host "  $($_.FullName)" }
  throw 'soffice.com not found in administrative install tree'
}
$installRoot = Split-Path (Split-Path $sofficeHit.FullName -Parent) -Parent
Write-Host "LibreOffice tree root: $installRoot"

& (Join-Path $PSScriptRoot 'prune-engine.ps1') -InstallRoot $installRoot

$soffice = Join-Path $installRoot 'program\soffice.com'
if (-not (Test-Path $soffice)) { throw "soffice.com missing after prune: $soffice" }

# Smoke gate: the pruned tree must still convert every fixture the app ships
# tests for. Aggressive pruning is only safe if this passes, so it runs against
# the same decks the e2e suite uses.
$smokeDir = Join-Path $WorkDir 'smoke'
if (Test-Path $smokeDir) { Remove-Item -Recurse -Force $smokeDir }
New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null

$fixtures = @('smoke.pptx', 'smoke.odp', 'deck-16x9.pptx', 'deck-4x3.pptx')
$expectedPages = @{
  'smoke.pptx'     = 1
  'smoke.odp'      = 2
  'deck-16x9.pptx' = 3
  'deck-4x3.pptx'  = 2
}
foreach ($fixture in $fixtures) {
  $source = Join-Path $repoRoot "tests\fixtures\$fixture"
  if (-not (Test-Path $source)) { throw "missing smoke fixture $source" }
  $stem = [System.IO.Path]::GetFileNameWithoutExtension($fixture)
  $out = Join-Path $smokeDir $stem
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $profileDir = Join-Path $smokeDir ('profile-' + [guid]::NewGuid().ToString('N'))
  $profileUrl = 'file:///' + ($profileDir -replace '\\', '/')

  $sofficeArgs = @(
    '--headless', '--norestore', '--invisible', '--nologo',
    "-env:UserInstallation=$profileUrl",
    '--convert-to', 'pdf:impress_pdf_Export',
    '--outdir', $out, $source
  )
  Write-Host "smoke: $fixture"
  & $soffice @sofficeArgs
  $pdf = Join-Path $out "$stem.pdf"
  if (-not (Test-Path $pdf)) { throw "smoke conversion produced no PDF for $fixture" }
  $bytes = (Get-Item $pdf).Length
  if ($bytes -lt 1024) { throw "smoke PDF for $fixture is too small: $bytes bytes" }

  # A pruned engine can still emit a valid but empty PDF. Parse it with the same
  # pdf.js build the app renders with, then require the exact page count and a
  # non-empty first page, which catches a dropped Impress filter or a broken
  # renderer that a file-size check would miss.
  $statsJson = & node (Join-Path $repoRoot 'scripts\count-pdf-pages.mjs') $pdf
  if ($LASTEXITCODE -ne 0) { throw "could not parse the PDF produced for $fixture" }
  $stats = $statsJson | ConvertFrom-Json
  $expected = $expectedPages[$fixture]
  Write-Host "  -> $bytes bytes, $($stats.pages) pages, $($stats.firstPageOps) ops (expected $expected pages)"
  if ($stats.pages -ne $expected) {
    throw "smoke conversion of $fixture produced $($stats.pages) pages, expected $expected"
  }
  if ($stats.firstPageOps -lt 1) {
    throw "smoke conversion of $fixture produced a page with no drawable content"
  }
}
if (Test-Path $OutFile) { Remove-Item -Force $OutFile }
$sevenZip = 'C:\Program Files\7-Zip\7z.exe'
if (-not (Test-Path $sevenZip)) {
  $cmd = Get-Command 7z -ErrorAction SilentlyContinue
  if (-not $cmd) { throw '7-Zip not found' }
  $sevenZip = $cmd.Source
}
Write-Host "Compressing engine to $OutFile"
& $sevenZip a -mx=9 -tzip $OutFile "$installRoot\*" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "7z failed with exit code $LASTEXITCODE" }

$zipMb = [math]::Round((Get-Item $OutFile).Length / 1MB, 1)
Write-Host "Engine zip size: $zipMb MB"
if ($zipMb -lt 40) { throw "engine zip looks too small: $zipMb MB" }
# Budget guard: a regression in pruning would silently ship a huge installer.
if ($zipMb -gt 160) { throw "engine zip is $zipMb MB, over the 160 MB budget" }

$marker = Join-Path $WorkDir 'engine-info.json'
@{
  version = $manifest.version
  msiSha256 = $manifest.msiSha256
  zipBytes = (Get-Item $OutFile).Length
  treeBytes = (Get-ChildItem -Path $installRoot -Recurse -File | Measure-Object -Property Length -Sum).Sum
  builtAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -Path $marker -Encoding utf8

Write-Host "Engine build finished."