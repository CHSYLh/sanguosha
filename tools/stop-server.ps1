# Stop the SanGuoSha LAN server.
# NOTE: this file must stay pure ASCII (no BOM) so Windows PowerShell 5.1
# parses it correctly on every locale. User-facing Chinese text lives in
# the .bat launcher (saved as GBK).
$ErrorActionPreference = 'Stop'
$targets = @()

try {
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
  $targets = @($procs | Where-Object { $_.CommandLine -like '*server.js*' })
} catch {
  $targets = @(Get-Process node -ErrorAction SilentlyContinue)
}

if ($targets.Count -eq 0) {
  Write-Output 'NOT_FOUND'
  exit 0
}

foreach ($p in $targets) {
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    Write-Output "STOPPED_PID $($p.ProcessId)"
  } catch {
    Write-Output "FAILED_PID $($p.ProcessId)"
  }
}

Start-Sleep -Seconds 1
$still = $false
try {
  (Invoke-WebRequest -Uri 'http://localhost:3000/healthz' -UseBasicParsing -TimeoutSec 2) | Out-Null
  $still = $true
} catch {
  $still = $false
}

if ($still) { Write-Output 'STILL_RUNNING' } else { Write-Output 'OK' }
exit 0
