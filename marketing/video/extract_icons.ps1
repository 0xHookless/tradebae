# Pull the largest icon (up to 256px, with alpha) out of each installed platform exe -> icons/<id>.png
# Usage: powershell -ExecutionPolicy Bypass -File extract_icons.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force icons | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class IconX {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern uint PrivateExtractIcons(string file, int idx, int cx, int cy, IntPtr[] icons, uint[] ids, uint n, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);
}
'@
$src = [ordered]@{
  atas = 'C:\Users\hawdi\Desktop\OFT.Platform.exe'
  ax   = 'C:\Users\hawdi\Desktop\OFT.PlatformX.exe'
  bm   = 'C:\Users\hawdi\Desktop\Bookmap.exe'
  mw   = 'C:\Program Files (x86)\MotiveWave\MotiveWave.exe'
  dc   = 'C:\Users\hawdi\Desktop\Deepchart.Core.exe'
  sc   = 'C:\SierraChart\SierraChart_64.exe'
  jig  = 'C:\Program Files\Jigsaw Trading\daytradr64.exe'
}
foreach ($k in $src.Keys) {
  $h = New-Object IntPtr[] 1; $ids = New-Object UInt32[] 1
  $n = [IconX]::PrivateExtractIcons($src[$k], 0, 256, 256, $h, $ids, 1, 0)
  if ($n -lt 1 -or $h[0] -eq [IntPtr]::Zero) { Write-Output "$k FAILED"; continue }
  $ico = [System.Drawing.Icon]::FromHandle($h[0])
  $bmp = $ico.ToBitmap()
  $bmp.Save("icons\$k.png", [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "$k $($bmp.Width)x$($bmp.Height)"
  $bmp.Dispose(); [IconX]::DestroyIcon($h[0]) | Out-Null
}
