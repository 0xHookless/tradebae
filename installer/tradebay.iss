; Trade Bay installer — TradingLauncher client
; Build: ISCC tradebay.iss

#define MyAppName "Trade Bay"
#define MyAppVersion "1.4.3"
#define MyAppPublisher "Trade Bay"
#define MyAppExeName "TradingLauncher.exe"

[Setup]
AppId={{A5D6C7E4-3A0F-4B7C-9F1D-6D8B33F0A2E1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\TradeBay
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=.
OutputBaseFilename=TradeBayInstaller
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=tradebay.ico
; Self-update swaps run the installer while the app is open: close it silently.
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\client\build\Release\TradingLauncher.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\Qt6Core.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\Qt6Gui.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\Qt6Network.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\Qt6Widgets.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion
; Standalone 7-Zip console exe (LGPL, unmodified): zip extractor that works in
; Wine prefixes (Sikarugir on macOS) which ship no tar.exe and no PowerShell.
Source: "..\client\build\Release\7za.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\dxcompiler.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\dxil.dll"; DestDir: "{app}"; Flags: ignoreversion
; Visual C++ 2015-2022 runtime, shipped next to the exe so it runs on a clean Windows 10/11
; x64 machine with nothing pre-installed (fixes "vcruntime140_1.dll was not found").
Source: "..\client\build\Release\vcruntime140.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\vcruntime140_1.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\vcruntime140_threads.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\msvcp140.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\msvcp140_1.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\msvcp140_2.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\msvcp140_atomic_wait.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\msvcp140_codecvt_ids.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\concrt140.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\client\build\Release\vccorlib140.dll"; DestDir: "{app}"; Flags: ignoreversion
; WebView2 Evergreen runtime bootstrapper (built into Windows 11, often missing on Windows 10).
; Installed silently below; it no-ops if the runtime is already present.
Source: "MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "..\client\build\Release\app.html"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\client\build\Release\platforms\qwindows.dll"; DestDir: "{app}\platforms"; Flags: ignoreversion
Source: "..\client\build\Release\styles\qmodernwindowsstyle.dll"; DestDir: "{app}\styles"; Flags: ignoreversion
Source: "..\client\build\Release\imageformats\qgif.dll"; DestDir: "{app}\imageformats"; Flags: ignoreversion
Source: "..\client\build\Release\imageformats\qico.dll"; DestDir: "{app}\imageformats"; Flags: ignoreversion
Source: "..\client\build\Release\imageformats\qjpeg.dll"; DestDir: "{app}\imageformats"; Flags: ignoreversion
Source: "..\client\build\Release\networkinformation\qnetworklistmanager.dll"; DestDir: "{app}\networkinformation"; Flags: ignoreversion
Source: "..\client\build\Release\tls\qcertonlybackend.dll"; DestDir: "{app}\tls"; Flags: ignoreversion
Source: "..\client\build\Release\tls\qschannelbackend.dll"; DestDir: "{app}\tls"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

[Run]
; Ensure the WebView2 runtime is present (needed for the app UI on Windows 10).
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing WebView2 runtime (one time)..."; Flags: waituntilterminated runhidden
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

; Uninstall keeps per-user client data (apps, cache, logs) intact.
