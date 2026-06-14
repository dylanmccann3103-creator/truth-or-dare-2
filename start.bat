@echo off
echo.
echo  Starting Truth or Dare 2.0...
echo.
cd /d "%~dp0"
if exist "%~dp0node.exe" (
  "%~dp0node.exe" server.js
) else (
  node server.js
)
pause
