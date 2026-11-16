@echo off
setlocal
if exist "%~dp0node.exe" (
  "%~dp0node.exe" "%~dp0install.cjs" %*
) else (
  node "%~dp0install.cjs" %*
)
if errorlevel 1 (
  echo Installation failed. Check the message above.
  pause
  exit /b 1
)
pause
