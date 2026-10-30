# Drives a running simulator (started with --automation-port 9898) through a
# list of steps and saves glasses screenshots. Example:
#   ./scripts/sim-shots.ps1 -Out $env:TEMP\shots -Steps 'shot:boot','wait:2500','click','wait:800','shot:typing'
param(
  [string[]]$Steps,
  [string]$Out = "$env:TEMP\jarvis-shots",
  [string]$Api = 'http://127.0.0.1:9898'
)
New-Item -ItemType Directory -Force $Out | Out-Null
for ($i = 0; $i -lt 30; $i++) {
  try { if ((Invoke-RestMethod "$Api/api/ping" -TimeoutSec 1) -match 'pong') { break } } catch {}
  Start-Sleep -Milliseconds 300
}
foreach ($s in $Steps) {
  $verb, $arg = $s -split ':', 2
  switch ($verb) {
    'wait' { Start-Sleep -Milliseconds ([int]$arg) }
    'shot' { Invoke-WebRequest "$Api/api/screenshot/glasses" -OutFile "$Out\$arg.png"; "shot $arg" }
    default {
      Invoke-RestMethod -Method Post "$Api/api/input" -ContentType 'application/json' -Body (@{ action = $verb } | ConvertTo-Json) | Out-Null
      "input $verb"
    }
  }
}
(Invoke-RestMethod "$Api/api/console").entries |
  Where-Object { $_.message -notmatch 'audioPcm' -and ($_.level -in 'error', 'warn' -or $_.message -match 'EvenHub event|^\[voice\]|^\[boot\]') } |
  Select-Object -Last 12 | ForEach-Object { "[$($_.level)] $($_.message)" }
