@echo off
setlocal
cd /d "%~dp0"
echo.
echo === Trade Bay server setup ===
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo Python is not installed or not on PATH.
  echo Install Python 3.11 or newer from https://www.python.org/downloads/windows/
  echo and tick "Add python.exe to PATH" in the installer, then run this again.
  pause
  exit /b 1
)

if not exist "server\.venv\Scripts\python.exe" (
  echo Creating Python environment...
  python -m venv server\.venv
  if errorlevel 1 ( echo Could not create the environment. & pause & exit /b 1 )
)

echo Installing server packages (this can take a minute)...
"server\.venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
"server\.venv\Scripts\python.exe" -m pip install --quiet -r server\requirements.txt
if errorlevel 1 ( echo Package install failed. Check the VPS has internet access. & pause & exit /b 1 )

"server\.venv\Scripts\python.exe" setup_env.py
if errorlevel 1 ( pause & exit /b 1 )

echo.
echo Setup finished. Run start.bat to launch the server.
pause
