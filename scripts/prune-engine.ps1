# Trims an administrative LibreOffice install down to what a headless
# Impress-to-PDF converter actually needs, then makes the tree self-contained.
#
# Pruning runs in named stages so build-engine.ps1 can verify a conversion after
# each one. That turns "the engine broke" into "stage X broke it" without a
# bisect across CI runs.
param(
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [Parameter(Mandatory = $true)][ValidateSet(
    'docs', 'junk', 'modules', 'ui', 'authoring', 'pdfimport', 'locales', 'fonts', 'runtime', 'report'
  )][string]$Stage
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

function Remove-Relative {
  param([string]$Relative)
  $path = Join-Path $InstallRoot $Relative
  if (Test-Path $path) { Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue }
}

switch ($Stage) {
  'docs' {
    Remove-Relative 'help'
    Remove-Relative 'sdk'
    Remove-Relative 'readmes'
  }

  'junk' {
    # The administrative install leaves its own payload inside the tree.
    Remove-Relative 'LibreOffice.msi'
  }

  'modules' {
    # Only `impress_pdf_Export` ever runs. Calc, Writer, Base, Math and the legacy
    # Mac/Works/Apple filters are separate shared libraries that never load.
    $unused = @(
      'sclo.dll', 'scfiltlo.dll',
      'swlo.dll', 'swuilo.dll', 'mswordlo.dll', 'sw_writerfilterlo.dll',
      'Engine12.dll', 'dbaselo.dll',
      'smlo.dll',
      'mwaw.dll', 'wps.dll', 'etonyek.dll',
      'CoinMP.dll'
    )
    foreach ($name in $unused) {
      $target = Join-Path $programDir $name
      if (Test-Path $target) { Remove-Item -Force $target -ErrorAction SilentlyContinue }
    }
    Remove-Relative 'program\classes'
  }

  'ui' {
    # Measured: removing share/config/soffice.cfg breaks the headless export even
    # though no dialog is ever painted, because the office bootstrap reads the
    # dialog configuration while building its component context. Keep it.
    #
    # The icon themes, however, are pure bitmaps and are safe to drop.
    Get-ChildItem -Path (Join-Path $InstallRoot 'share\config') -Filter 'images_*.zip' -ErrorAction SilentlyContinue |
      ForEach-Object { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }
  }

  'authoring' {
    Remove-Relative 'share\gallery'
    Remove-Relative 'share\template'
    Remove-Relative 'share\Scripts'
    Remove-Relative 'share\autotext'
    Remove-Relative 'share\wizards'
    Remove-Relative 'share\basic'
  }

  'pdfimport' {
    # Measured: removing the PDF import filter breaks the Impress export too, so
    # it stays. Only the standalone converter binary is dropped.
    $target = Join-Path $programDir 'xpdfimport.exe'
    if (Test-Path $target) { Remove-Item -Force $target -ErrorAction SilentlyContinue }
  }

  'locales' {
    # Keep the three locales the app can display. The rest is translated dialog
    # text and number formats that are never read.
    $keepLocales = @('en-US', 'en-GB', 'zh-CN')
    $isKept = {
      param([string]$baseName)
      foreach ($locale in $keepLocales) {
        if ($baseName -like "*$locale*") { return $true }
      }
      return $false
    }

    $resDir = Join-Path $InstallRoot 'share\registry\res'
    if (Test-Path $resDir) {
      Get-ChildItem -Path $resDir -File -Filter '*.xcd' -ErrorAction SilentlyContinue | ForEach-Object {
        if (-not (& $isKept $_.BaseName)) { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }
      }
    }

    $regDir = Join-Path $InstallRoot 'share\registry'
    if (Test-Path $regDir) {
      Get-ChildItem -Path $regDir -File -Filter 'Langpack-*.xcd' -ErrorAction SilentlyContinue | ForEach-Object {
        if (-not (& $isKept $_.BaseName)) { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }
      }
    }

    $resourceDir = Join-Path $programDir 'resource'
    if (Test-Path $resourceDir) {
      Get-ChildItem -Path $resourceDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        if ($keepLocales -notcontains $_.Name) { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
      }
    }
  }

  'fonts' {
    # Windows supplies CJK and UI fonts. Keep the metric-compatible Latin set that
    # substitutes for Calibri/Arial/Times, drop the scripts this product never draws.
    $dropPrefixes = @(
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
        foreach ($prefix in $dropPrefixes) {
          if ($_.Name -like "$prefix*") {
            Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue
            break
          }
        }
      }
    }
  }

  'runtime' {
    Get-ChildItem -Path $InstallRoot -Recurse -File -Include '*.pdb', '*.ilk', '*.map' -ErrorAction SilentlyContinue |
      ForEach-Object { Remove-Item -Force $_.FullName -ErrorAction SilentlyContinue }

    # The MSI expects the VC++ runtime in the system directory; ship it locally so
    # the tree runs on a machine without the redistributables installed.
    $runtimeDlls = @(
      'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll',
      'vcruntime140.dll', 'vcruntime140_1.dll', 'concrt140.dll'
    )
    $systemDir = Join-Path $env:SystemRoot 'System32'
    foreach ($dll in $runtimeDlls) {
      $target = Join-Path $programDir $dll
      if (Test-Path $target) { continue }
      $source = Join-Path $systemDir $dll
      if (Test-Path $source) { Copy-Item -Path $source -Destination $target }
    }
  }

  'report' {
    Get-ChildItem -Path $InstallRoot -Directory | ForEach-Object {
      $bytes = (Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
      Write-Host ("  {0,-16} {1,8:N1} MB" -f $_.Name, ($bytes / 1MB))
    }

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
  }
}

Write-Host ("stage {0,-11} -> {1,7:N1} MB" -f $Stage, (Get-TreeMb))