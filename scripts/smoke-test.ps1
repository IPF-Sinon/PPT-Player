<#
.SYNOPSIS
  Launch a built app and fail unless its renderer actually reports in.

.DESCRIPTION
  A smoke test that accepts "a window exists" is not a smoke test. The window is
  created before the webview loads anything, so an app that panics in setup, or whose
  renderer never mounts, still has a window handle for a moment.

  The only accepted proof of a working build is the marker the React app writes once
  it has mounted and painted. Everything else is a failure with the log attached.
#>
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Label,
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Exe)) { throw "$Label smoke test: $Exe is missing" }

$out = Join-Path $env:RUNNER_TEMP "smoke-$Label.out"
$err = Join-Path $env:RUNNER_TEMP "smoke-$Label.err"
$log = Join-Path $env:APPDATA 'com.ipf.sinon.pptplayer\config\ppt-player.log'

# The log lives in app data and survives between steps and between runs on a reused
# runner, so a stale marker from an earlier launch would satisfy this test.
Remove-Item $out, $err, $log -Force -ErrorAction SilentlyContinue

$proc = Start-Process -FilePath $Exe -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$ready = $false
$exitedEarly = $false
$exitCode = $null

while ((Get-Date) -lt $deadline) {
  $proc.Refresh()
  if ($proc.HasExited) {
    $exitedEarly = $true
    $exitCode = $proc.ExitCode
    break
  }
  # Both destinations are checked: stderr is written by the macro, the file is what a
  # user would send in a bug report, and either one proves the renderer ran.
  foreach ($source in @($err, $log)) {
    if (Test-Path $source) {
      $text = Get-Content $source -Raw -ErrorAction SilentlyContinue
      if ($text -and $text -match 'renderer ready') { $ready = $true; break }
    }
  }
  if ($ready) { break }
  Start-Sleep -Milliseconds 300
}

$stillRunning = -not $proc.HasExited
if ($stillRunning) { Stop-Process -Id $proc.Id -Force }

Write-Host "--- $Label stderr ---"
if (Test-Path $err) { Get-Content $err | Select-Object -Last 40 }
Write-Host "--- $Label app log ---"
if (Test-Path $log) { Get-Content $log | Select-Object -Last 40 }

if ($ready) {
  Write-Host "$Label smoke test passed: the renderer mounted and reported ready"
  exit 0
}

# Every failure path names what was observed, so a red build is diagnosable without
# downloading artifacts.
if ($exitedEarly) {
  throw "$Label smoke test failed: the process exited (code $exitCode) before the renderer reported ready. This is what a startup panic looks like."
}
if ($stillRunning) {
  throw "$Label smoke test failed: the process stayed alive for $TimeoutSeconds s but the renderer never reported ready. This is what a blank webview looks like."
}
throw "$Label smoke test failed: no renderer marker and the process state is unknown"
