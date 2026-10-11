$ErrorActionPreference = 'Continue'
$log = 'C:\Users\artem\Desktop\compass-arena-test\bcd-report.txt'
$lines = New-Object System.Collections.Generic.List[string]

function Add-Line([string]$t) { $lines.Add($t) }

Add-Line "### Elevated session: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
Add-Line "### Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Line "### IsAdmin: $(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"
Add-Line ''
Add-Line '===== BEFORE: bcdedit /enum {current} ====='
$before = (& bcdedit.exe /enum '{current}' 2>&1 | Out-String)
Add-Line $before
Add-Line '===== BEFORE: bootmgr entry (all) ====='
Add-Line ((& bcdedit.exe /enum 2>&1 | Out-String))

$tsBefore = if ($before -match '(?im)^\s*testsigning\s+(\S+)') { $Matches[1] } else { 'unknown' }
$fsBefore = if ($before -match '(?im)^\s*flightsigning\s+(\S+)') { $Matches[1] } else { 'unknown' }
Add-Line "### Parsed: testsigning=$tsBefore flightsigning=$fsBefore"
Add-Line ''

Add-Line '===== APPLY ====='
if ($tsBefore -match '^(?i)yes$') {
  Add-Line '-- bcdedit /set testsigning off'
  Add-Line ((& bcdedit.exe /set testsigning off 2>&1 | Out-String))
  Add-Line "-- exit code: $LASTEXITCODE"
} else {
  Add-Line "-- testsigning is not Yes in BCD, no change made"
}
if ($fsBefore -match '^(?i)yes$') {
  Add-Line '-- bcdedit /set flightsigning off'
  Add-Line ((& bcdedit.exe /set flightsigning off 2>&1 | Out-String))
  Add-Line "-- exit code: $LASTEXITCODE"
} else {
  Add-Line "-- flightsigning is not Yes in BCD, no change made"
}
Add-Line ''

Add-Line '===== AFTER: bcdedit /enum {current} ====='
Add-Line ((& bcdedit.exe /enum '{current}' 2>&1 | Out-String))

Add-Line '===== Registry SystemStartOptions (current boot, not yet changed) ====='
Add-Line ((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control' -Name SystemStartOptions).SystemStartOptions)

[System.IO.File]::WriteAllLines($log, $lines, (New-Object System.Text.UTF8Encoding($true)))
