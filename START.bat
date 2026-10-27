@echo off
setlocal
cd /d "%~dp0"
set "NODE_HOME=%CD%\vendor\node\win-x64"
if not exist "%NODE_HOME%\node.exe" (
  echo Preparing the included Node.js...
  powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '%CD%\vendor\node\node-win-x64.zip' -DestinationPath '%CD%\vendor\node\win-tmp'"
  if errorlevel 1 goto fail
  for /d %%D in ("%CD%\vendor\node\win-tmp\node-*") do move "%%D" "%NODE_HOME%" >nul
)
set "PATH=%NODE_HOME%;%PATH%"
if not exist "%CD%\node_modules\electron" (
  echo Downloading the player pieces. This needs the internet once.
  call npm.cmd install
  if errorlevel 1 goto fail
)
echo Opening TripleA.
call npm.cmd run desktop
if errorlevel 1 goto fail
exit /b 0
:fail
echo TripleA did not start.
pause
exit /b 1
