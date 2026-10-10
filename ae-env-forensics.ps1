# Rebound real-AE forensics - Phase 1: OS-level environment (items 1 & 2).
$ErrorActionPreference = 'Continue'

$Markers = @{
  'client\js\ui\color-picker.js' = @{
    NEW = @('normalizeHex', 'closeColorPickers', 'pending = hexInput.value')
    OLD = @('function setFromHex(hex) { var rgb = hexToRgb(hex);')
  }
  'client\js\main.js'            = @{ NEW = @('closeColorPickers'); OLD = @() }
  'client\js\features\color.js'  = @{ NEW = @('syncPicker(true)'); OLD = @() }
  'client\js\features\stroke.js' = @{ NEW = @('{ user: true }'); OLD = @() }
  'client\js\features\palette.js'= @{ NEW = @('if (r.ci && r.ci.destroy) r.ci.destroy();'); OLD = @() }
}

function Get-Verdict([string]$file, $markers) {
  if (-not (Test-Path $file)) { return 'MISSING' }
  $text = [System.IO.File]::ReadAllText($file)
  $size = (Get-Item $file).Length
  $newHits = 0; foreach ($m in $markers.NEW) { if ($text.IndexOf($m) -ge 0) { $newHits++ } }
  $oldHits = 0; foreach ($m in $markers.OLD) { if ($text.IndexOf($m) -ge 0) { $oldHits++ } }
  $allNew = ($newHits -eq $markers.NEW.Count) -and ($markers.NEW.Count -gt 0)
  $anyOld = ($oldHits -gt 0)
  if ($allNew -and -not $anyOld) { return "NEW(84719ca)  [${size} bytes]" }
  if ($anyOld) { return "OLD(98813fe) !!!  [${size} bytes]" }
  return "UNKNOWN  [${size} bytes]"
}

Write-Host "`n=== 1. RUNNING After Effects processes (the one actually being tested) ===" -ForegroundColor Cyan
$running = Get-CimInstance Win32_Process -Filter "Name='AfterFX.exe'" -ErrorAction SilentlyContinue
if (-not $running) {
  Write-Warning 'No AfterFX.exe is running right now. Start AE with the Rebound panel open, then re-run.'
} else {
  foreach ($p in $running) {
    $vi = $null
    if ($p.ExecutablePath) { try { $vi = (Get-Item $p.ExecutablePath).VersionInfo } catch { } }
    [pscustomobject]@{
      PID       = $p.ProcessId
      Exe       = $p.ExecutablePath
      Product   = if ($vi) { $vi.ProductVersion } else { '?' }
      FileVer   = if ($vi) { $vi.FileVersion } else { '?' }
      Started   = $p.CreationDate
    } | Format-List
  }
  Write-Host '--- child processes of AE that mention rebound / CEF renderers ---' -ForegroundColor DarkCyan
  $runningIds = @($running | ForEach-Object { $_.ProcessId })
  $children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    (($_.ParentProcessId -in $runningIds) -or ($_.CommandLine -match 'rebound')) -and
    ($_.CommandLine -match 'rebound|--type=renderer|cef')
  }
  if ($children) {
    foreach ($c in $children) {
      Write-Host ("  pid={0} parent={1} name={2}" -f $c.ProcessId, $c.ParentProcessId, $c.Name)
      if ($c.CommandLine) { Write-Host ("    cmd={0}" -f $c.CommandLine.Substring(0, [Math]::Min(260, $c.CommandLine.Length))) }
    }
  } else { Write-Host '  (none found - the DevTools env snapshot will still prove the loaded path)' }
}

Write-Host "`n=== 2. Every com.meszmate.rebound copy on this machine ===" -ForegroundColor Cyan
$dirs = @(
  (Join-Path $env:APPDATA 'Adobe\CEP\extensions'),
  'C:\Program Files (x86)\Common Files\Adobe\CEP\extensions',
  'C:\Program Files\Common Files\Adobe\CEP\extensions'
) | Sort-Object -Unique
$anyOld = $false
foreach ($d in $dirs) {
  if (-not (Test-Path $d)) { continue }
  Get-ChildItem $d -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'meszmate|rebound' } | ForEach-Object {
    $item = $_
    Write-Host "`n  COPY: $($item.FullName)" -ForegroundColor Yellow
    try { Write-Host ("    LinkType: {0}   Target: {1}" -f $item.LinkType, ($item.Target -join ', ')) } catch { }
    foreach ($rel in $Markers.Keys) {
      $what = Get-Verdict (Join-Path $item.FullName $rel) $Markers[$rel]
      if ($what -like 'OLD*') { $anyOld = $true; Write-Host ("    {0,-34} {1}" -f $rel, $what) -ForegroundColor Red }
      else { Write-Host ("    {0,-34} {1}" -f $rel, $what) }
    }
    $dbg = Join-Path $item.FullName '.debug'
    if (Test-Path $dbg) {
      $dbgText = (Get-Content $dbg -Raw) -replace "\s+", " "
      Write-Host ("    .debug: {0}" -f $dbgText.Substring(0, [Math]::Min(220, $dbgText.Length)))
    } else { Write-Host '    .debug: ABSENT (remote debugging not configured in this copy)' }
  }
  Get-ChildItem $d -Filter '*.zxp' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'rebound|meszmate' } | ForEach-Object {
    Write-Host "`n  ZXP PRESENT: $($_.FullName) ($($_.Length) bytes, $($_.LastWriteTime)) - an installed ZXP can shadow a dev copy!" -ForegroundColor Red
  }
}
if ($anyOld) { Write-Host "`n  !!! At least one copy on disk still has OLD code. If AE loads that copy, that alone explains 'exactly as before'." -ForegroundColor Red }

Write-Host "`n=== 3. PlayerDebugMode (required to attach DevTools on port 8718) ===" -ForegroundColor Cyan
foreach ($v in 9, 10, 11, 12, 13) {
  $k = "HKCU:\Software\Adobe\CSXS.$v"
  if (Test-Path $k) {
    $pdm = (Get-ItemProperty $k -ErrorAction SilentlyContinue).PlayerDebugMode
    if ($null -eq $pdm) { $pdm = '<not set>' }
    Write-Host ("  CSXS.{0}: PlayerDebugMode = {1}" -f $v, $pdm)
  }
}

Write-Host "`nDone. Send this whole output back together with the RBKF report." -ForegroundColor Green
