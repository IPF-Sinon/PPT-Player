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

$soffice = Join-Path $installRoot 'program\soffice.com'
$pruneScript = Join-Path $PSScriptRoot 'prune-engine.ps1'
$fixtures = @('smoke.pptx', 'smoke.odp', 'deck-16x9.pptx', 'deck-4x3.pptx')
$expectedPages = @{
  'smoke.pptx'     = 1
  'smoke.odp'      = 2
  'deck-16x9.pptx' = 3
  'deck-4x3.pptx'  = 2
}

$smokeDir = Join-Path $WorkDir 'smoke'

# Runs soffice with a hard timeout. A pruned tree can make LibreOffice hang while
# loading a component, so every probe must be able to give up.
function Invoke-Soffice {
  param([string]$SofficeExe, [string[]]$Arguments, [int]$TimeoutSeconds = 90)

  $proc = Start-Process -FilePath $SofficeExe -ArgumentList $Arguments -PassThru -NoNewWindow
  if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
    Write-Host "    soffice exceeded $TimeoutSeconds s, killing it"
    & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null
    return $false
  }
  return $true
}

function Invoke-Smoke {
  param([string]$Label, [string[]]$Fixtures)

  if (Test-Path $smokeDir) { Remove-Item -Recurse -Force $smokeDir }
  New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null

  foreach ($fixture in $Fixtures) {
    $source = Join-Path $repoRoot "tests\fixtures\$fixture"
    if (-not (Test-Path $source)) { throw "missing smoke fixture $source" }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($fixture)
    $out = Join-Path $smokeDir ($Label + '-' + $stem)
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    $profileDir = Join-Path $smokeDir ('profile-' + [guid]::NewGuid().ToString('N'))
    $profileUrl = 'file:///' + ($profileDir -replace '\\', '/')

    $sofficeArgs = @(
      '--headless', '--norestore', '--invisible', '--nologo',
      "-env:UserInstallation=$profileUrl",
      '--convert-to', 'pdf:impress_pdf_Export',
      '--outdir', $out, $source
    )
    if (-not (Invoke-Soffice -SofficeExe $soffice -Arguments $sofficeArgs)) {
      throw "[$Label] conversion timed out for $fixture"
    }
    $pdf = Join-Path $out "$stem.pdf"
    if (-not (Test-Path $pdf)) { throw "[$Label] conversion produced no PDF for $fixture" }
    $bytes = (Get-Item $pdf).Length
    if ($bytes -lt 1024) { throw "[$Label] PDF for $fixture is too small: $bytes bytes" }

    # A pruned engine can emit a structurally valid but empty PDF, so parse it with
    # the same pdf.js build the app renders with and require real content.
    $statsJson = & node (Join-Path $repoRoot 'scripts\count-pdf-pages.mjs') $pdf
    if ($LASTEXITCODE -ne 0) { throw "[$Label] could not parse the PDF produced for $fixture" }
    $stats = $statsJson | ConvertFrom-Json
    $expected = $expectedPages[$fixture]
    Write-Host ("  [{0}] {1}: {2} bytes, {3} pages, {4} ops (expected {5})" -f $Label, $fixture, $bytes, $stats.pages, $stats.firstPageOps, $expected)
    if ($stats.pages -ne $expected) {
      throw "[$Label] $fixture produced $($stats.pages) pages, expected $expected"
    }
    if ($stats.firstPageOps -lt 1) {
      throw "[$Label] $fixture produced a page with no drawable content"
    }
  }
}

# Non-throwing variant used to probe individual files: returns $true when the
# engine still converts, and never lets an exception decide the outcome.
function Test-Smoke {
  param([string[]]$Fixtures)
  try {
    Invoke-Smoke -Label 'probe' -Fixtures $Fixtures
    return $true
  } catch {
    Write-Host "    probe failed: $($_.Exception.Message)"
    return $false
  }
}

# Baseline: the untouched tree must convert before any pruning, otherwise a later
# failure cannot be attributed to pruning.
Write-Host 'smoke: baseline (unpruned)'
Invoke-Smoke -Label 'baseline' -Fixtures @('smoke.pptx')

# Safe stages first: nothing here is part of the conversion filter graph.
foreach ($stage in @('docs', 'junk', 'ui', 'authoring', 'locales', 'fonts', 'runtime')) {
  & $pruneScript -InstallRoot $installRoot -Stage $stage
  Write-Host "smoke: after $stage"
  Invoke-Smoke -Label $stage -Fixtures @('smoke.pptx')
}

# Everything below is a file or directory that *might* be load-bearing. Probe each
# one with a real conversion and restore it when the engine stops working, so the
# shipped tree is derived from measurement rather than assumption.
$probePaths = @(
  'program\sclo.dll', 'program\scfiltlo.dll',
  'program\swlo.dll', 'program\swuilo.dll',
  'program\mswordlo.dll', 'program\sw_writerfilterlo.dll',
  'program\Engine12.dll', 'program\dbaselo.dll',
  'program\smlo.dll', 'program\mwaw.dll', 'program\wps.dll',
  'program\etonyek.dll', 'program\CoinMP.dll',
  'program\python311.dll', 'program\python-core-3.11.15',
  'program\xpdfimport.exe', 'program\pdfiumlo.dll',
  'program\classes',
  'share\xpdfimport',
  'share\extensions'
)

$dropped = @()
$kept = @()
foreach ($rel in $probePaths) {
  $target = Join-Path $installRoot $rel
  if (-not (Test-Path $target)) { continue }

  $backup = $target + '.probe-bak'
  Move-Item -Path $target -Destination $backup -Force
  if (Test-Smoke -Fixtures @('smoke.pptx')) {
    Write-Host "  drop $rel"
    Remove-Item -Recurse -Force $backup -ErrorAction SilentlyContinue
    $dropped += $rel
  } else {
    Write-Host "  keep $rel (conversion depends on it)"
    Move-Item -Path $backup -Destination $target -Force
    $kept += $rel
  }
}
Write-Host ("dropped: {0}" -f ($(if ($dropped.Count) { $dropped -join ', ' } else { 'none' })))
Write-Host ("kept:    {0}" -f ($(if ($kept.Count) { $kept -join ', ' } else { 'none' })))

& $pruneScript -InstallRoot $installRoot -Stage 'report'

# Final gate: every fixture must convert with the fully pruned tree.
Write-Host 'smoke: final (all fixtures)'
Invoke-Smoke -Label 'final' -Fixtures $fixtures

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