@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22.13 or newer from https://nodejs.org/ & pause & exit /b 1)
where npm >nul 2>nul || (echo npm was not found. Reinstall Node.js. & pause & exit /b 1)
if not exist node_modules call npm.cmd ci || (pause & exit /b 1)
call npm.cmd start
if errorlevel 1 pause
