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
    & $soffice @sofficeArgs
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

# Prune in stages, verifying after each one so a regression names its own cause.
$stages = @('docs', 'junk', 'ui', 'authoring', 'pdfimport', 'locales', 'fonts')
foreach ($stage in $stages) {
  & $pruneScript -InstallRoot $installRoot -Stage $stage
  Write-Host "smoke: after $stage"
  Invoke-Smoke -Label $stage -Fixtures @('smoke.pptx')
}

# Module removal is the risky part: mergedlo.dll is a monolith and some of these
# libraries register services at startup. Test each candidate on its own and keep
# only the ones that still convert, so the tree never ships a broken cut.
$candidates = @(
  'sclo.dll', 'scfiltlo.dll',
  'swlo.dll', 'swuilo.dll', 'mswordlo.dll', 'sw_writerfilterlo.dll',
  'Engine12.dll', 'dbaselo.dll',
  'smlo.dll',
  'mwaw.dll', 'wps.dll', 'etonyek.dll',
  'CoinMP.dll'
)
$kept = @()
foreach ($candidate in $candidates) {
  $target = Join-Path $installRoot ('program\' + $candidate)
  if (-not (Test-Path $target)) { continue }

  $backup = $target + '.bak'
  Move-Item -Path $target -Destination $backup -Force
  if (Test-Smoke -Fixtures @('smoke.pptx')) {
    Write-Host "  drop $candidate"
    Remove-Item -Force $backup -ErrorAction SilentlyContinue
    $kept += $candidate
  } else {
    Write-Host "  keep $candidate (conversion depends on it)"
    Move-Item -Path $backup -Destination $target -Force
  }
}
Write-Host ("modules droppable: {0}" -f ($(if ($kept.Count) { $kept -join ', ' } else { 'none' })))
& $pruneScript -InstallRoot $installRoot -Stage 'runtime'
& $pruneScript -InstallRoot $installRoot -Stage 'report'

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