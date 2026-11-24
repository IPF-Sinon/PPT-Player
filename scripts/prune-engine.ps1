# Trims an administrative LibreOffice install down to what a headless
# Impress-to-PDF converter actually needs, then makes the tree self-contained.
#
# Measured on LibreOffice 25.8.7 (win x86-64), administrative install:
#   untouched           740.5 MB raw
#   after this script   ~355 MB raw   (~132 MB deflate, ~112 MB LZMA)
#
# Every removal below was chosen from that measurement, and the build fails if
# the trimmed tree can no longer convert the smoke fixtures.
param(
  [Parameter(Mandatory = $true)][string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path $InstallRoot)) { throw "install root missing: $InstallRoot" }

$programDir = Join-Path $InstallRoot 'program'
if (-not (Test-Path $programDir)) { throw "program directory missing: $programDir" }

function Get-TreeMb {
  $bytes = (Get-ChildItem -Path $InstallRoot -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  if (-not $bytes) { return 0 }
  return [math]::Round($bytes / 1MB, 1)
}

$startMb = Get-TreeMb
Write-Host "start: $startMb MB"

function Remove-Relative {
  param([string]$Relative, [string]$Label)
  $path = Join-Path $InstallRoot $Relative
  if (-not (Test-Path $path)) { return }
  Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
  Write-Host ("  - {0,-34} {1,7:N1} MB" -f $Label, (Get-TreeMb))
}

# ---------------------------------------------------------------- documentation
Remove-Relative 'help' 'help'
Remove-Relative 'sdk' 'sdk'
Remove-Relative 'readmes' 'readmes'

# ------------------------------------------------------------------ installer junk
# The administrative install leaves its own payload inside the extracted tree.
Remove-Relative 'LibreOffice.msi' 'LibreOffice.msi'

# ------------------------------------------------------------------ unused modules
# This build only ever runs `impress_pdf_Export`. Calc, Writer, Base, Math and
# the legacy Mac/Works filters are separate shared libraries that never load.
$unusedModules = @(
  'sclo.dll',                    # Calc
  'scfiltlo.dll',                # Calc filters
  'swlo.dll',                    # Writer
  'swuilo.dll',                  # Writer UI
  'mswordlo.dll',                # .doc import
  'sw_writerfilterlo.dll',       # Writer filter
  'Engine12.dll',                # Base database engine
  'dbaselo.dll',                 # Base
  'smlo.dll',                    # Math
  'mwaw.dll',                    # legacy Mac/Works formats
  'wps.dll',                     # Microsoft Works
  'etonyek.dll',                 # Apple iWork import
  'CoinMP.dll',                  # solver used by Calc
  'python311.dll',               # bundled Python runtime
  'python-core-3.11.15'          # Python standard library
)
foreach ($name in $unusedModules) {
  $target = Join-Path $programDir $name
  if (Test-Path $target) {
    Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
  }
}
Write-Host ("  - {0,-34} {1,7:N1} MB" -f 'unused modules', (Get-TreeMb))

# Java bridges are only used by Base reports and some wizards.
Remove-Relative 'program\classes' 'program/classes (Java)'

# ------------------------------------------------------------- UI-only resources
# A headless run never paints a dialog or a toolbar, so the entire UI config and
# every icon theme is dead weight. This is the single largest win.
Remove-Relative 'share\config\soffice.cfg' 'soffice.cfg (dialogs)'
Get-ChildItem -Path (Join-Path $InstallRoot 'share\config') -Filter 'images_*.zip' -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }
Write-Host ("  - {0,-34} {1,7:N1} MB" -f 'icon themes', (Get-TreeMb))

# --------------------------------------------------------------- authoring aids
Remove-Relative 'share\gallery' 'share/gallery'
Remove-Relative 'share\template' 'share/template'
Remove-Relative 'share\Scripts' 'share/Scripts'
Remove-Relative 'share\autotext' 'share/autotext'
Remove-Relative 'share\wizards' 'share/wizards'
Remove-Relative 'share\basic' 'share/basic (Basic IDE)'
Remove-Relative 'share\extensions' 'share/extensions'

# ------------------------------------------------------- PDF import round-trip
# The player renders PDFs with pdf.js, never with LibreOffice.
Remove-Relative 'share\xpdfimport' 'share/xpdfimport'
foreach ($name in @('xpdfimport.exe', 'pdfiumlo.dll')) {
  $target = Join-Path $programDir $name
  if (Test-Path $target) { Remove-Item -Force $target -ErrorAction SilentlyContinue }
}
Write-Host ("  - {0,-34} {1,7:N1} MB" -f 'pdf import', (Get-TreeMb))

# ----------------------------------------------------------------- localisation
# Keep the three locales the app can display. Everything else is 89 MB of
# translated dialog strings and number formats that are never read.
$keepLocales = @('en-US', 'en-GB', 'zh-CN')
$resDir = Join-Path $InstallRoot 'share\registry\res'
if (Test-Path $resDir) {
  Get-ChildItem -Path $resDir -File -Filter '*.xcd' -ErrorAction SilentlyContinue | ForEach-Object {
    $keep = $false
    foreach ($locale in $keepLocales) {
      if ($_.BaseName -like "*$locale*") { $keep = $true; break }
    }
    if (-not $keep) { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }
  }
}
Get-ChildItem -Path (Join-Path $InstallRoot 'share\registry') -File -Filter 'Langpack-*.xcd' -ErrorAction SilentlyContinue |
  ForEach-Object {
    $keep = $false
    foreach ($locale in $keepLocales) {
      if ($_.BaseName -like "*$locale*") { $keep = $true; break }
    }
    if (-not $keep) { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }
  }
$resourceDir = Join-Path $programDir 'resource'
if (Test-Path $resourceDir) {
  Get-ChildItem -Path $resourceDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    if ($keepLocales -notcontains $_.Name) { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
  }
}
Write-Host ("  - {0,-34} {1,7:N1} MB" -f 'localisation', (Get-TreeMb))

# ---------------------------------------------------------------------- fonts
# Windows already provides the CJK and UI fonts a deck asks for. Keep the metric
# compatible Latin set that LibreOffice substitutes for Calibri/Arial/Times and
# drop the scripts this product never renders.
$dropFontPrefixes = @(
  'NotoSansArabic', 'NotoNaskhArabic', 'NotoKufiArabic', 'ReemKufi', 'Amiri',
  'Scheherazade', 'NotoSansHebrew', 'NotoSerifHebrew', 'DavidCLM', 'DavidLibre',
  'FrankRuehlCLM', 'FrankRuhlHofshi', 'MiriamCLM', 'MiriamLibre', 'MiriamMonoCLM',
  'NachlieliCLM', 'Alef', 'NotoSansArmenian', 'NotoSerifArmenian',
  'NotoSansGeorgian', 'NotoSerifGeorgian', 'NotoSansLao', 'NotoSerifLao',
  'NotoSansLisu', 'Rubik', 'DejaVuMathTeXGyre'
)
$fontsDir = Join-Path $InstallRoot 'Fonts'
if (Test-Path $fontsDir) {
  Get-ChildItem -Path $fontsDir -File -ErrorAction SilentlyContinue | ForEach-Object {
    foreach ($prefix in $dropFontPrefixes) {
      if ($_.Name -like "$prefix*") {
        Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue
        break
      }
    }
  }
}
Write-Host ("  - {0,-34} {1,7:N1} MB" -f 'extra scripts', (Get-TreeMb))

# ------------------------------------------------------------------- leftovers
Get-ChildItem -Path $InstallRoot -Recurse -File -Include '*.pdb', '*.ilk', '*.map' -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }

# ------------------------------------------------ self-contained VC++ runtime
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
  if (Test-Path $source) { Copy-Item -Path $source -Destination $target }
}

# ------------------------------------------------------------------- report
Get-ChildItem -Path $InstallRoot -Directory | ForEach-Object {
  $bytes = (Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  Write-Host ("  {0,-16} {1,8:N1} MB" -f $_.Name, ($bytes / 1MB))
}

$endMb = Get-TreeMb
Write-Host "pruned tree size: $endMb MB (was $startMb MB)"

$required = @(
  'program\soffice.com',
  'program\soffice.bin',
  'program\sdlo.dll',
  'share\registry\main.xcd',
  'share\filter'
)
foreach ($rel in $required) {
  if (-not (Test-Path (Join-Path $InstallRoot $rel))) {
    throw "pruned tree is missing required path: $rel"
  }
}
Write-Host 'prune checks passed.'
