@echo off
rem Abre o CaptaMais no Windows com um duplo clique - sem precisar do Claude, do Cursor ou de terminal.
rem Se o computador nao tiver Node.js 18 ou superior, baixa um Node portatil oficial para a pasta runtime\node
rem desta skill. Nada e instalado no sistema e o PATH do Windows nao e alterado.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title CaptaMais

set "SILENT=0"
if /i "%~1"=="--silencioso" set "SILENT=1"
set "RUNTIME_NODE=%~dp0runtime\node"

rem 1) Node portatil ja baixado antes? Usa ele.
if exist "%RUNTIME_NODE%\node.exe" set "PATH=%RUNTIME_NODE%;%PATH%"

rem 2) Senao, serve o Node do sistema se for 18 ou superior.
call :node_ok
if not errorlevel 1 goto :tem_node

rem 3) Senao, baixa o portatil.
echo.
echo  Preparando o CaptaMais pela primeira vez. Estou baixando o Node.js, sem precisar instalar nada.
echo  Isso leva alguns minutos e precisa de internet...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\node-portatil.ps1" -Dest "%RUNTIME_NODE%"
if errorlevel 1 goto :sem_node
set "PATH=%RUNTIME_NODE%;%PATH%"
call :node_ok
if errorlevel 1 goto :sem_node

:tem_node
if not exist "node_modules\better-sqlite3" (
  echo.
  echo  Primeira vez: preparando o CaptaMais. Isso leva cerca de um minuto...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  Nao foi possivel preparar o CaptaMais. Confira a internet e abra este arquivo de novo.
    if "%SILENT%"=="0" pause
    exit /b 1
  )
)

node scripts\server.mjs
if errorlevel 1 (
  echo.
  echo  O CaptaMais nao conseguiu iniciar. Veja a mensagem acima.
  if "%SILENT%"=="0" pause
  exit /b 1
)

rem Na primeira vez, oferece um atalho na Area de Trabalho (so pergunta uma vez; nunca no modo silencioso).
if "%SILENT%"=="0" node scripts\atalho.mjs --oferecer
exit /b 0

:node_ok
where node >nul 2>nul
if errorlevel 1 exit /b 1
node -e "process.exit(parseInt(process.versions.node,10)>=18?0:1)" >nul 2>nul
exit /b %errorlevel%

:sem_node
echo.
echo  Nao consegui baixar o Node.js automaticamente. Confira a internet e abra este arquivo de novo.
echo  Se continuar, instale o Node.js LTS em https://nodejs.org marcando a opcao de adicionar ao PATH.
echo.
if "%SILENT%"=="0" pause
exit /b 1
