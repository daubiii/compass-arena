$ErrorActionPreference = 'Continue'
$log = 'C:\Users\artem\Desktop\compass-arena-test\bcd-report-2.txt'
$lines = New-Object System.Collections.Generic.List[string]
function Add-Line([string]$t) { $lines.Add($t) }

Add-Line "### Elevated session: $([Security.Principal.WindowsIdentity]::GetCurrent().Name) at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Line '===== BEFORE: bcdedit /enum {bootmgr} ====='
Add-Line ((& bcdedit.exe /enum '{bootmgr}' 2>&1 | Out-String))

Add-Line '===== APPLY: bcdedit /set {bootmgr} flightsigning off ====='
Add-Line ((& bcdedit.exe /set '{bootmgr}' flightsigning off 2>&1 | Out-String))
Add-Line "-- exit code: $LASTEXITCODE"

Add-Line '===== AFTER: bcdedit /enum {bootmgr} ====='
Add-Line ((& bcdedit.exe /enum '{bootmgr}' 2>&1 | Out-String))

Add-Line '===== FINAL: bcdedit /enum {current} ====='
Add-Line ((& bcdedit.exe /enum '{current}' 2>&1 | Out-String))

[System.IO.File]::WriteAllLines($log, $lines, (New-Object System.Text.UTF8Encoding($true)))
