@echo off
title Ludoteca
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Falta Node.js. Descargalo en https://nodejs.org  ^(version 18 o superior^)
  echo.
  pause
  exit /b 1
)

echo.
echo   Iniciando Ludoteca... el navegador se abrira solo.
echo   Para cerrar la aplicacion, cierra esta ventana o pulsa Ctrl+C.
echo.
node server\index.js --open
pause
