# 一键停止本地全部项目（可重复执行）
# 用法： powershell -ExecutionPolicy Bypass -File .\stop-all.ps1

$Runtime = 'C:\Users\Lewisyin\AppData\Local\ai-workspace-runtime'
$Pids = Join-Path $Runtime 'pids'
$MysqlAdm = Join-Path $Runtime 'mysql-8.0.28-winx64\bin\mysqladmin.exe'

function Stop-ByPidFile([string]$Name) {
  $f = Join-Path $Pids "$Name.pid"
  if (Test-Path $f) {
    $procId = [int](Get-Content $f -Raw).Trim()
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) { Stop-Process -Id $procId -Force; Write-Host "[STOP] $Name (pid $procId)" }
    Remove-Item $f -ErrorAction SilentlyContinue
  }
}

function Stop-ByPort([int]$Port, [string]$Name) {
  $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "[STOP] $Name (pid $($c.OwningProcess), port $Port)"
  }
}

Stop-ByPidFile 'ai-poster'
Stop-ByPort 5173 'ai-poster'
Stop-ByPidFile 'hotel-system'
Stop-ByPort 8080 'hotel-system'
Stop-ByPidFile 'tech-blog'
Stop-ByPort 3100 'tech-blog'

Write-Host '=== stopping MySQL ==='
if (Test-Path $MysqlAdm) {
  & $MysqlAdm -uroot -h 127.0.0.1 -P 3306 shutdown 2>$null | Out-Null
  Start-Sleep -Seconds 3
}
Stop-ByPidFile 'mysql'
Stop-ByPort 3306 'MySQL'
Write-Host 'All stopped.'
