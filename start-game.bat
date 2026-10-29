@echo off
REM ===========================================================================
REM  Hangbitch - Windows launcher
REM
REM  Starts a static web server bound to 127.0.0.1 only (never the network) and
REM  opens the game in the default browser. No admin rights, no downloads, no
REM  internet access required.
REM
REM  Why a server at all? Browsers disable the Web Crypto API (which the game
REM  needs to decrypt words) when a page is opened from file://. Running on
REM  http://127.0.0.1 makes the page a "secure context", which enables both the
REM  crypto API and the offline service-worker cache.
REM ===========================================================================
setlocal enabledelayedexpansion
title Hangbitch - local server (safe to close this window)

cd /d "%~dp0app"
if not exist "index.html" (
  echo Could not find app\index.html next to this script.
  echo Keep the project folder structure intact and try again.
  pause
  exit /b 1
)

set START_PORT=8777
set END_PORT=8796
set PORT=

for /l %%P in (%START_PORT%,1,%END_PORT%) do (
  if not defined PORT (
    netstat -ano | findstr /r /c:":%%P .*LISTENING" >nul 2>nul
    if errorlevel 1 set PORT=%%P
  )
)

if not defined PORT (
  echo Every port between %START_PORT% and %END_PORT% is already in use.
  echo Close whatever is using them, or edit START_PORT/END_PORT in this file.
  pause
  exit /b 1
)

set URL=http://127.0.0.1:!PORT!/index.html
echo ===========================================================================
echo  Hangbitch
echo  Serving the game from: %CD%
echo  Open this address:     !URL!
echo.
echo  Keep this window open while you play. Close it (or press Ctrl+C) to stop
echo  the server. Nothing on this machine is exposed to the network.
echo ===========================================================================
echo.

where python >nul 2>nul
if not errorlevel 1 (
  echo Using Python's built-in HTTP server...
  start "" "!URL!"
  python -m http.server !PORT! --bind 127.0.0.1
  goto :done
)

where py >nul 2>nul
if not errorlevel 1 (
  echo Using the Python launcher ^(py^)...
  start "" "!URL!"
  py -3 -m http.server !PORT! --bind 127.0.0.1
  goto :done
)

where node >nul 2>nul
if not errorlevel 1 (
  echo Python was not found - using the bundled Node.js server instead...
  start "" "!URL!"
  node "%~dp0tools\serve.js" !PORT! "%~dp0app"
  goto :done
)

echo.
echo Neither Python nor Node.js was found on this PC.
echo.
echo Install either one (both are free) and run this file again:
echo   * Python  - the installer offers a "Add python.exe to PATH" checkbox.
echo   * Node.js - the LTS installer adds "node" to PATH automatically.
echo.
pause
exit /b 1

:done
echo.
echo Local server stopped.
pause
exit /b 0
