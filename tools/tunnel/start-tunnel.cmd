@echo off
REM ============================================================
REM  2026 SAP Winter Family Activity -- publish local site to Internet
REM  (Cloudflare Quick Tunnel: no server, no domain, no ICP filing)
REM
REM  Usage:
REM    1. Start Docker Desktop, then in project root:  docker compose up -d
REM    2. Run:  tools\tunnel\start-tunnel.cmd
REM    3. This window prints your public address in a big box.
REM       Share that address; anyone can open the site in a browser.
REM
REM  IMPORTANT LIMITS:
REM    - Your PC must stay ON, online, with Docker running.
REM    - The address CHANGES every time you restart this script.
REM    - Do not close this window. Closing it kills the tunnel.
REM    - Anyone with the link can open the admin login page.
REM      Change the default admin password BEFORE sharing the link.
REM
REM  NOTE: keep this file ASCII-only + CRLF.
REM    Chinese chars get mangled by the GBK console (code page 936)
REM    and cmd will then run the REM comment lines as commands.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "PORT=5280"
set "METRICS=127.0.0.1:20298"
set "LOG=%~dp0tunnel.log"
set "URLFILE=%~dp0public-url.txt"

echo.
echo [1/3] Checking frontend container on port %PORT% ...
curl -s -o nul -w "%%{http_code}" http://localhost:%PORT%/ > "%TEMP%\_sap_probe.txt" 2>nul
set /p CODE=<"%TEMP%\_sap_probe.txt"
if not "%CODE%"=="200" (
    echo.
    echo   [!] Port %PORT% did not respond ^(got %CODE%^).
    echo       Please run first, in project root:  docker compose up -d
    echo.
    pause
    exit /b 1
)
echo       OK, frontend is alive.

REM Refuse to start twice: 20298 is this project's private metrics port.
netstat -ano | findstr "127.0.0.1:20298" >nul
if not errorlevel 1 (
    echo       A tunnel for this project is already running.
    echo       Stop that window first, then run this script again.
    echo.
    pause
    exit /b 1
)

echo.
echo [2/3] Requesting public tunnel, please wait 10-40 seconds ...
start "sap-tunnel" /B cloudflared.exe tunnel --no-autoupdate --metrics %METRICS% --url http://localhost:%PORT% > "%LOG%" 2>&1

REM get-url.ps1 reads the hostname from the local metrics endpoint, which is
REM stable across cloudflared versions (the log line layout is not).
set "URL="
for /f "usebackq delims=" %%a in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0get-url.ps1" -MetricsHost 127.0.0.1 -MetricsPort 20298 -Retries 45 -WaitSeconds 2`) do (
    if not defined URL set "URL=%%a"
)

if not defined URL (
    echo.
    echo   [!] Could not get a public address within 90 seconds.
    echo       See log: %LOG%
    echo.
    pause
    exit /b 1
)

> "%URLFILE%" echo %URL%

echo.
echo [3/3] TUNNEL IS UP. Copy the address below and send it to
echo       whoever needs access. They open it in any browser.
echo.
echo   ================================================================
echo.
echo      %URL%
echo.
echo   ================================================================
echo.
echo   Front desk for employees : %URL%/a/{activity-code}/login
echo   Admin console            : %URL%/admin
echo.
echo   The plain address above shows the admin login by default.
echo   Replace {activity-code} with the real code, e.g. sap-winter-2026.
echo.
echo   Address also saved to:  %URLFILE%
echo   Log file:               %LOG%
echo.
echo   Do NOT close this window. Closing it kills the tunnel.
echo   This screen will stay idle -- that is NORMAL, it is working.
echo.
echo   Press any key to stop the tunnel and exit.
echo.

:WAIT
ping -n 3 127.0.0.1 >nul
tasklist /fi "imagename eq cloudflared.exe" 2>nul | findstr /i "cloudflared.exe" >nul
if errorlevel 1 goto DONE
goto WAIT

:DONE
echo.
echo   Tunnel stopped. The public address is now dead.
echo.
pause
