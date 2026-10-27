@echo off
setlocal
cd /d "%~dp0"

if not exist "server\.venv\Scripts\python.exe" ( echo Run setup.bat first. & pause & exit /b 1 )
if not exist "server\.env" ( echo server\.env is missing. Run setup.bat first. & pause & exit /b 1 )

rem --- make sure cloudflared is present ---
if not exist "cloudflared.exe" (
  echo Downloading cloudflared ^(one time^)...
  powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' } catch { Write-Host $_; exit 1 }"
  if not exist "cloudflared.exe" ( echo Could not download cloudflared. Check the VPS has internet access. & pause & exit /b 1 )
)

rem --- start the backend in its own window ---
echo Starting the Trade Bay backend...
start "Trade Bay Server" /d "%~dp0server" cmd /c ""%~dp0server\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 & pause"

rem --- wait for the backend to answer ---
echo Waiting for the backend to come up...
set UP=
for /l %%i in (1,1,30) do (
  if not defined UP (
    powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }" && set UP=1
    if not defined UP timeout /t 2 >nul
  )
)
if not defined UP ( echo Backend did not start. Check the server window for errors. & pause & exit /b 1 )
echo Backend is up on http://127.0.0.1:8000

echo.
echo ============================================================
echo  Opening the public Cloudflare tunnel.
echo  Your public address is the https://XXXX.trycloudflare.com
echo  line printed below. Give that URL to your users.
echo  Keep BOTH windows open. Closing them takes the site down.
echo ============================================================
echo.

rem --- open the public trycloudflare tunnel (prints the URL) ---
cloudflared.exe tunnel --url http://127.0.0.1:8000 --no-autoupdate
echo.
echo Tunnel closed.
pause
