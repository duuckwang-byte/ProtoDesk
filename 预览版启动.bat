@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem Keep echo lines ending with ASCII punctuation; CMD UTF-8 batch parser can swallow bytes after a CJK full stop.
title 原型工具 - 预览版
cd /d "%~dp0"

set "LOG=%~dp0preview-start.log"
copy /y nul "%LOG%" >nul 2>&1
if not errorlevel 1 goto :log_ready
set "LOG=%~dp0preview-start.%RANDOM%.log"
copy /y nul "%LOG%" >nul 2>&1
if errorlevel 1 (
  echo [错误] 无法创建日志文件.
  echo        请检查目录写入权限，或关闭占用 preview-start.log 的程序.
  pause
  exit /b 1
)
echo [提示] preview-start.log 被占用，可能上一个预览窗口还在运行.
echo        本次日志改为：%LOG%
:log_ready

echo [%date% %time%] ===== 预览版启动 ===== >> "%LOG%"
echo [1/3] 检查 Node.js...
where node >nul 2>&1
if errorlevel 1 goto :no_node
set "NODE_EXE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE goto :no_node
set "NODE_VER="
for /f "delims=" %%V in ('"%NODE_EXE%" --version 2^>nul') do set "NODE_VER=%%V"
if not defined NODE_VER goto :node_broken
echo Node 版本：%NODE_VER%
echo Node 路径："%NODE_EXE%"
echo Node 版本：%NODE_VER% >> "%LOG%"
echo Node 路径："%NODE_EXE%" >> "%LOG%"

echo [2/3] 检查依赖...
set "ELECTRON_CLI=%~dp0node_modules\electron\cli.js"
set "ELECTRON_EXE=%~dp0node_modules\electron\dist\electron.exe"
if exist "%ELECTRON_CLI%" goto :deps_ready
where npm >nul 2>&1
if errorlevel 1 goto :no_npm
echo 缺少依赖，正在 npm install，可能需要几分钟...
echo 缺少依赖，正在 npm install... >> "%LOG%"
call npm install >> "%LOG%" 2>&1
if errorlevel 1 goto :npm_failed

:deps_ready
if not exist "%ELECTRON_CLI%" goto :no_electron_cli
if exist "%ELECTRON_EXE%" goto :electron_exe_ready
if exist "%~dp0dist\electron.exe" (
  set "ELECTRON_EXE=%~dp0dist\electron.exe"
  goto :electron_exe_ready
)
goto :no_electron_exe

:electron_exe_ready
echo 依赖正常.
echo Electron："%ELECTRON_EXE%"
echo 依赖正常. >> "%LOG%"
echo Electron："%ELECTRON_EXE%" >> "%LOG%"

echo [3/3] 准备启动...
set "RUNLOG=%~dp0preview-start.run.log"
copy /y nul "%RUNLOG%" >nul 2>&1
if not errorlevel 1 goto :runlog_ready
set "RUNLOG=%~dp0preview-start.run.%RANDOM%.log"
copy /y nul "%RUNLOG%" >nul 2>&1
if errorlevel 1 (
  echo [提示] 无法创建启动输出日志，Electron 输出将直接显示在本窗口.
  set "RUNLOG="
)
:runlog_ready
if defined RUNLOG echo 启动输出："%RUNLOG%" >> "%LOG%"
echo 正在启动预览版 - 关闭应用窗口后本窗口自动关闭...
echo 启动命令："%NODE_EXE%" "%ELECTRON_CLI%" .
echo 启动命令："%NODE_EXE%" "%ELECTRON_CLI%" . >> "%LOG%"
if defined RUNLOG (
  "%NODE_EXE%" "%ELECTRON_CLI%" . >> "%RUNLOG%" 2>&1
) else (
  "%NODE_EXE%" "%ELECTRON_CLI%" .
)
set "CODE=%errorlevel%"
echo 退出码：%CODE% >> "%LOG%"
if defined RUNLOG (
  echo. >> "%LOG%"
  echo ===== 启动输出 ===== >> "%LOG%"
  type "%RUNLOG%" >> "%LOG%" 2>nul
)
echo.
echo 预览版已退出，退出码：%CODE%
echo 日志：%LOG%
if not "%CODE%"=="0" goto :failed
exit /b 0

:failed
echo.
if "%CODE%"=="9009" (
  echo [错误] 退出码 9009：node/Electron 启动命令不可执行.
  echo         实际命令："%NODE_EXE%" "%ELECTRON_CLI%" .
  echo         请检查 Node.js 与 Electron 依赖是否完整.
) else (
  echo [错误] 启动失败，退出码：%CODE%
  echo         实际命令："%NODE_EXE%" "%ELECTRON_CLI%" .
)
echo         日志路径：%LOG%
if defined RUNLOG echo         启动输出：%RUNLOG%
echo         请把日志发我排查.
pause
exit /b %CODE%

:no_node
echo [错误] 未找到 node，请先安装 Node.js 官网长期支持版.
echo [错误] 未找到 node >> "%LOG%"
pause
exit /b 1

:node_broken
echo [错误] 找到 node 但无法执行："%NODE_EXE%"
echo [错误] node 无法执行："%NODE_EXE%" >> "%LOG%"
pause
exit /b 1

:no_npm
echo [错误] 缺少依赖且未找到 npm，请安装含 npm 的 Node.js 长期支持版.
echo [错误] 未找到 npm >> "%LOG%"
pause
exit /b 1

:npm_failed
echo [错误] 依赖安装失败，详见 "%LOG%"
pause
exit /b 1

:no_electron_cli
echo [错误] 未找到 node_modules\electron\cli.js，依赖安装不完整.
echo [错误] 未找到 node_modules\electron\cli.js >> "%LOG%"
pause
exit /b 1

:no_electron_exe
echo [错误] 未找到 Electron 可执行文件.
echo         已检查："%ELECTRON_EXE%"
echo         也已检查："%~dp0dist\electron.exe"
echo [错误] 未找到 Electron 可执行文件 >> "%LOG%"
pause
exit /b 1
