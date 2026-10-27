@echo off
setlocal
cd /d "%~dp0"
set STAMP=%date:~-4%%date:~3,2%%date:~0,2%-%time:~0,2%%time:~3,2%
set STAMP=%STAMP: =0%
if not exist backups mkdir backups
powershell -NoProfile -Command "Compress-Archive -Force -DestinationPath 'backups\tradebay-backup-%STAMP%.zip' -Path 'server\data.db','server\.env','server\app\signing_key.pem','server\storage'"
echo Backup written to backups\tradebay-backup-%STAMP%.zip
echo It contains your secrets. Keep it somewhere private, not on this VPS only.
pause
