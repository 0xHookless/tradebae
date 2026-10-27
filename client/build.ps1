param(
    [string]$QtPrefix = "C:/Qt/6.8.3/msvc2022_64",
    [string]$Config = "Release"
)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 -DCMAKE_PREFIX_PATH="$QtPrefix"
cmake --build build --config $Config
Write-Host "Built: $PSScriptRoot\build\$Config\TradingLauncher.exe"
