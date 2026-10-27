$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath ".env")) {
    Write-Error "Missing .env. Copy .env.example to .env and fill in real values."
}
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
