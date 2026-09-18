@echo off
chcp 65001 >nul
title 原型工具 - 预览版
cd /d "%~dp0"
set "LOG=%~dp0preview-start.log"
echo [%date% %time%] ===== 预览版启动 =====> "%LOG%"
echo [1/3] 检查运行环境...
node --version >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 node，请先安装 Node.js 官网长期支持版。
  echo [错误] 未找到 node >> "%LOG%"
  pause
  exit /b 1
)
for /f %%v in ('node --version') do echo Node 版本：%%v
for /f %%v in ('node --version') do echo Node 版本：%%v>> "%LOG%"
echo [2/3] 检查依赖...
if not exist "node_modules\electron\cli.js" (
  where npm >nul 2>&1
  if errorlevel 1 (
    echo [错误] 缺少依赖且未找到 npm，请先安装 Node.js 官网长期支持版（含 npm）。
    echo [错误] 未找到 npm >> "%LOG%"
    pause
    exit /b 1
  )
  echo 缺少依赖，正在 npm install（可能需要几分钟）...
  call npm install >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo [错误] 依赖安装失败，详见 preview-start.log
    pause
    exit /b 1
  )
)
echo 依赖正常。
echo [3/3] 正在启动预览版（关闭应用窗口后本窗口自动关闭）...
echo 启动命令：node node_modules\electron\cli.js .>> "%LOG%"
call node "node_modules\electron\cli.js" . >> "%LOG%" 2>&1
set "CODE=%errorlevel%"
echo 退出码：%CODE%>> "%LOG%"
if not "%CODE%"=="0" (
  echo.
  echo [已退出] 退出码 %CODE%，详见 preview-start.log，把它发我排查。
  pause
  exit /b %CODE%
)
