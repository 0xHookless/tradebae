@echo off
setlocal
cd /d "%~dp0server"

if not exist ".venv\Scripts\python.exe" (
  echo Run setup.bat first.
  pause
  exit /b 1
)
if not exist ".env" (
  echo server\.env is missing. Run setup.bat first.
  pause
  exit /b 1
)

echo Trade Bay server starting on port 8000. Leave this window open.
echo Admin panel: http://localhost:8000/admin/
echo.
:run
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
echo.
echo Server stopped. Restarting in 5 seconds (close this window to stop it for good)...
timeout /t 5 >nul
goto run
