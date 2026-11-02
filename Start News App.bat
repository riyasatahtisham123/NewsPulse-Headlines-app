@echo off
title News App (local server)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js install nahi hai. Pehle nodejs.org se "LTS" wala install karo,
  echo  phir ye file dobara double-click karna.
  echo.
  pause
  exit /b
)
node server.js
