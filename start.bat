@echo off
echo.
echo  Starting Truth or Dare 2.0...
echo.
cd /d "%~dp0"
if not exist "node_modules\" (
  echo  Installing dependencies... (first run only)
  echo.
  npm install
  echo.
)
if exist "%~dp0node.exe" (
  "%~dp0node.exe" server.js
) else (
  node server.js
)
pause
