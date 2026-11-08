# 一键启动本地全部项目
# 运行环境（便携 MySQL 8 + JRE 17）放在 ASCII 路径下：MySQL 8 无法处理含中文的路径。
# 用法： powershell -ExecutionPolicy Bypass -File .\start-all.ps1

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runtime = 'C:\Users\Lewisyin\AppData\Local\ai-workspace-runtime'
$Logs = Join-Path $Runtime 'logs'
$Pids = Join-Path $Runtime 'pids'
$MysqlHome = Join-Path $Runtime 'mysql-8.0.28-winx64'
$Mysqld = Join-Path $MysqlHome 'bin\mysqld.exe'
$Mysql = Join-Path $MysqlHome 'bin\mysql.exe'
$Ini = Join-Path $MysqlHome 'my.ini'
$DataDir = Join-Path $Runtime 'mysql-data'
$Java = Join-Path $Runtime 'jdk-17.0.20.1+1-jre\bin\java.exe'

New-Item -ItemType Directory -Force $Logs, $Pids | Out-Null

function Test-Port([int]$Port) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  return [bool]$c
}

function Wait-Port([int]$Port, [int]$Seconds, [string]$Name) {
  for ($i = 0; $i -lt ($Seconds * 2); $i++) {
    if (Test-Port $Port) { Write-Host "[OK]   $Name -> $Port"; return $true }
    Start-Sleep -Milliseconds 500
  }
  Write-Host "[FAIL] $Name not listening on $Port within $Seconds s, see $Logs"
  return $false
}

function Save-Pid([string]$Name, $Proc) {
  Set-Content -Path (Join-Path $Pids "$Name.pid") -Value $Proc.Id -Encoding ascii
}

Write-Host '=== 1. MySQL (127.0.0.1:3306) ==='
if (Test-Port 3306) {
  Write-Host '[SKIP] MySQL already running'
} else {
  if (-not (Test-Path $DataDir)) {
    Write-Host '[INIT] First run: initializing MySQL data directory ...'
    & $Mysqld --defaults-file="$Ini" --initialize-insecure
    if ($LASTEXITCODE -ne 0) { throw 'MySQL initialize failed, see logs\mysql-error.log' }
  }
  $p = Start-Process -FilePath $Mysqld -ArgumentList "--defaults-file=`"$Ini`"" `
        -RedirectStandardOutput (Join-Path $Logs 'mysql.out.log') `
        -RedirectStandardError (Join-Path $Logs 'mysql.err.log') `
        -WindowStyle Hidden -PassThru
  Save-Pid 'mysql' $p
  if (-not (Wait-Port 3306 60 'MySQL')) { throw 'MySQL failed to start, see logs\mysql-error.log' }
}

Write-Host '[DB] Ensure databases ...'
& $Mysql -uroot -h 127.0.0.1 -P 3306 -e "CREATE DATABASE IF NOT EXISTS tech_blog_test DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE IF NOT EXISTS tech_blog DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE IF NOT EXISTS hotel_db DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
if ($LASTEXITCODE -ne 0) { throw 'Create database failed' }

Write-Host '=== 2. tech-blog (http://127.0.0.1:3100) ==='
if (Test-Port 3100) {
  Write-Host '[SKIP] tech-blog already running'
} else {
  $p = Start-Process -FilePath 'node' -ArgumentList 'server/index.js' `
        -WorkingDirectory (Join-Path $Root 'tech-blog') `
        -RedirectStandardOutput (Join-Path $Logs 'tech-blog.out.log') `
        -RedirectStandardError (Join-Path $Logs 'tech-blog.err.log') `
        -WindowStyle Hidden -PassThru
  Save-Pid 'tech-blog' $p
  Wait-Port 3100 40 'tech-blog' | Out-Null
}

Write-Host '=== 3. hotel-system (http://127.0.0.1:8080) ==='
if (Test-Port 8080) {
  Write-Host '[SKIP] hotel-system already running'
} else {
  $jar = Join-Path $Root 'hotel-system\hotel-system-1.0.0.jar'
  $p = Start-Process -FilePath $Java -ArgumentList '-jar', "`"$jar`"", "--logging.file.name=`"$(Join-Path $Logs 'hotel-system.log')`"" `
        -WorkingDirectory (Join-Path $Root 'hotel-system') `
        -RedirectStandardOutput (Join-Path $Logs 'hotel.out.log') `
        -RedirectStandardError (Join-Path $Logs 'hotel.err.log') `
        -WindowStyle Hidden -PassThru
  Save-Pid 'hotel-system' $p
  Wait-Port 8080 90 'hotel-system' | Out-Null
}

Write-Host '=== 4. ai-poster-app (http://127.0.0.1:5173) ==='
if (Test-Port 5173) {
  Write-Host '[SKIP] ai-poster-app already running'
} else {
  $p = Start-Process -FilePath 'node' -ArgumentList "`"$(Join-Path $Runtime 'static-server.mjs')`"", "`"$(Join-Path $Root 'ai-poster-app')`"", '5173' `
        -WorkingDirectory $Runtime `
        -RedirectStandardOutput (Join-Path $Logs 'ai-poster.out.log') `
        -RedirectStandardError (Join-Path $Logs 'ai-poster.err.log') `
        -WindowStyle Hidden -PassThru
  Save-Pid 'ai-poster' $p
  Wait-Port 5173 15 'ai-poster-app' | Out-Null
}

Write-Host ''
Write-Host 'All done:'
Write-Host '  tech-blog      http://127.0.0.1:3100'
Write-Host '  hotel-system   http://127.0.0.1:8080   (admin / 123456)'
Write-Host '  ai-poster-app  http://127.0.0.1:5173'
Write-Host "Logs: $Logs"
