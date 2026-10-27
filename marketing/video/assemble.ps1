$ErrorActionPreference = 'Continue'
Set-Location "C:\TradingPlatform\marketing\video"
$ff = "C:\Users\hawdi\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe"

$V = @{ tick = 0.65; whoosh = 0.5; riser = 0.75; boom = 0.95; pop = 0.85; chime = 0.6 }

# (file, delayMs)
$mix = @(
  @('whoosh', 0), @('riser', 0), @('boom', 950),
  @('whoosh', 2800),
  @('tick', 3080), @('tick', 3220), @('tick', 3360), @('tick', 3500),
  @('tick', 3640), @('tick', 3780), @('tick', 3920), @('pop', 4400),
  @('whoosh', 5600), @('riser', 6200), @('boom', 7050),
  @('whoosh', 8000), @('chime', 8300),
  @('whoosh', 10800),
  @('tick', 11700), @('tick', 11900), @('tick', 12100), @('tick', 12300),
  @('tick', 12500), @('tick', 12700), @('tick', 12900),
  @('riser', 13100), @('pop', 14350),
  @('pop', 14750), @('boom', 14800),
  @('pop', 15000), @('pop', 15914), @('pop', 16828), @('pop', 17742),
  @('pop', 18656), @('pop', 19570), @('pop', 20484),
  @('boom', 21550), @('boom', 21950), @('boom', 22350),
  @('whoosh', 23000), @('chime', 23150)
)

$args = @('-y', '-i', 'out/video_nosound.mp4')
foreach ($m in $mix) { $args += @('-i', "sfx\$($m[0]).wav") }

$fc = ''
for ($i = 1; $i -le $mix.Count; $i++) {
  $idx = $i
  $fc += "[$($idx):a]volume=$($V[$mix[$i-1][0]]),adelay=$($mix[$i-1][1]):all=1[a$idx];"
}
$fc += "$(1..$mix.Count | ForEach-Object { "[a$_]" })"
$fc += "amix=inputs=$($mix.Count):normalize=0:duration=longest,atrim=0:25.0,volume=0.9[out]"

$args += @('-filter_complex', $fc, '-map', '0:v', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'out/tradebay_tiktok.mp4')

& $ff @args 2>&1 | ForEach-Object { "$_" } | Select-Object -Last 4
if ($LASTEXITCODE -eq 0) { Write-Output 'MUX OK' } else { Write-Output "MUX FAILED exit=$LASTEXITCODE" }
