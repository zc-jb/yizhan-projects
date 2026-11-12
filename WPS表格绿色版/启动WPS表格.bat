@echo off
title WPS 表格
cd /d "%~dp0"
if not exist "runtime\bin\server\jvm.dll" goto missing
if not exist "app\wps-office-1.0.0.jar" goto missing
start "" "%~dp0WPSOffice.exe"
exit /b 0

:missing
echo.
echo  [提示] 程序文件不完整：缺少 runtime 或 app 文件夹。
echo  很可能是在压缩包里直接双击运行，或只复制了单个 exe 文件。
echo.
echo  请这样操作：
echo   1. 右键 WPS表格绿色版.zip，选择「全部解压缩」
echo   2. 进入解压出来的文件夹
echo   3. 双击 WPSOffice.exe（或本文件）启动
echo.
pause
