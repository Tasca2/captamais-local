@echo off
rem Abre o CaptaMais no Windows com um duplo clique - sem precisar do Claude, do Cursor ou de terminal.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title CaptaMais

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O CaptaMais precisa do Node.js, que ainda nao esta instalado neste computador.
  echo  Baixe a versao LTS em https://nodejs.org , instale e abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\better-sqlite3" (
  echo.
  echo  Primeira vez: preparando o CaptaMais. Isso leva cerca de um minuto...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  Nao foi possivel preparar o CaptaMais. Confira a internet e abra este arquivo de novo.
    pause
    exit /b 1
  )
)

node scripts\server.mjs
if errorlevel 1 (
  echo.
  echo  O CaptaMais nao conseguiu iniciar. Veja a mensagem acima.
  pause
  exit /b 1
)

rem Na primeira vez, oferece um atalho na Area de Trabalho (so pergunta uma vez).
node scripts\atalho.mjs --oferecer
exit /b 0
