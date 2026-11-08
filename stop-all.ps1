# 一键停止本地全部项目（可重复执行）
# 用法： powershell -ExecutionPolicy Bypass -File .\stop-all.ps1

$Runtime = 'C:\Users\Lewisyin\AppData\Local\ai-workspace-runtime'
$Pids = Join-Path $Runtime 'pids'
$MysqlAdm = Join-Path $Runtime 'mysql-8.0.28-winx64\bin\mysqladmin.exe'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppsJson = Join-Path $Root '_apps\apps.json'

# 把作品应用标记为已停止，避免作品页继续展示「在线体验」入口
function Set-AppStopped([string]$Slug, [string]$Note) {
  if (-not (Test-Path $AppsJson)) { return }
  try {
    $data = [IO.File]::ReadAllText($AppsJson, [Text.Encoding]::UTF8) | ConvertFrom-Json
    $now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $hit = $false
    foreach ($a in $data.apps) {
      if ($a.slug -eq $Slug) {
        $a.status = 'deployed'
        $a.port = 0
        $a.startAt = ''
        $a.note = $Note
        $hit = $true
      }
    }
    if ($hit) {
      $data.updated_at = $now
      $json = $data | ConvertTo-Json -Depth 12
      [IO.File]::WriteAllText($AppsJson, $json, (New-Object Text.UTF8Encoding($false)))
      Write-Host "[OK] apps.json: $Slug -> stopped"
    }
  } catch {
    Write-Host "[WARN] apps.json update failed: $($_.Exception.Message)"
  }
}

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
Stop-ByPidFile 'library-system'
Stop-ByPort 8090 'library-system'
Set-AppStopped 'library-system-v1-68b3d2' '已停止，可随时重新启动'
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
