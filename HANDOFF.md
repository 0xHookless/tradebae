# TradeBay — Session Handoff (2026-10-23)

Everything the next session needs from the 2026-10-23 marathon: production state, hard-won
gotchas, upload recipes, and where things live. Read this before touching the server or client.

---

## 1. System map (30 seconds)

```
C:\TradingPlatform\
├─ server\      FastAPI + SQLite (data.db) — catalog, releases, licenses, signed manifests
├─ admin\       React/Vite SPA (npm run build → admin\dist) — license/release management
├─ client\      Qt6 C++ launcher (TradingLauncher.exe) — downloads, verifies, ghost-launches apps
├─ deploy\      build_zip.py, setup.bat, start.bat, start-tunnel.bat, README-VPS.md
├─ installer\   payload exes + cleaned package zips (re-upload material, see §6)
├─ shared\ docs\ testdata\
```

- **Production = a VPS**, deployed by extracting `TradeBayServer.zip` (built by
  `deploy/build_zip.py`) to `C:\TradeBayServer` (user's latest deploy: `C:\Users\Administrator\Desktop\TradeBayServer`).
  The local machine is dev only. **Any server/admin code change requires**: rebuild admin
  (`cd admin && npm run build`) → `python deploy/build_zip.py` → re-extract on VPS → restart.
  The zip intentionally excludes `data.db`, `.env`, `storage/` (dev data never ships).
- **Public URL = free trycloudflare tunnel**, rotates on every VPS restart. Current:
  `https://promo-operation-transport-connectivity.trycloudflare.com` (do not hardcode; ask user / check Discord).
  Admin: username `admin`, password — ask the user (changes per redeploy; also sits in `server\.env` on the VPS).
- **Client install layout (per user machine)**: registry `HKCU\Software\TradingPlatform\TradingLauncher`
  holds `serverUrl`, `licenseKey`, `installRoot` (default `%APPDATA%\TradingPlatform\TradingLauncher\apps`),
  per-app overrides in `dirs\<slug>`, last-installed versions in `installed\<slug>`.
  This dev box: `installRoot=C:/TradeBayShowcasebv`, `dirs\bookmap=C:/Program Files/mozarelandstringbeans`.

## 2. Production state as of 2026-10-23 (evening)

| slug | version | payload (separate exe) | launch_mode | notes |
|---|---|---|---|---|
| bookmap | 14.1 | Bookmap.exe | **ghost** | flattened zip, Config/Keys stripped |
| motivewave | 1.0.0 | MotiveWave.exe | **ghost** | |
| deepcharts | 1.2.3 | Deepchart.Core.exe | **ghost** | proxy stack included (py312 build) |
| atas | 1.0.1 | OFT.Platform.exe | **ghost** | 1.0.1 = ASCII-filename fix |
| atas-x | 1.0.1 | OFT.PlatformX.exe | **ghost** | same |
| sierra-chart | none | — | (empty, reflective) | placeholder, no builds; user wants it non-ghost |

User's personal license key `LIC-AZp3NCVMySnBWRa7oxfqDbezs3ssoqbfqrtUvNc5WFE` (perpetual, `*`
scope) was recreated on the fresh VPS. Fresh VPS = empty DB → all licenses must be recreated
after any redeploy.

## 3. The one rule that broke everything once

**`launch_mode` MUST be `"ghost"` for every app except sierra-chart.** The VPS bootstrap does
NOT set it. Without ghost, the client runs the payload via the in-process reflective PE loader
inside `TradingLauncher.exe`:
- native stubs (Bookmap/MotiveWave launchers) self-respawn via `GetModuleFileName` → **spawn a
  second Trade Bay window**;
- .NET payloads → **"One or more required types cannot be loaded"** (ReflectionTypeLoadException).

Fix on server (PUT requires the FULL SoftwareCreate body — partial body 422s; and SoftwareOut
does NOT echo launch_mode, verify via `/catalog`):

```
PUT /software/{slug}  {"slug": "...", "display_name": "...", "launch_mode": "ghost",
                       "executable_name": "<payload exe>", "separate_executable": true}
```

Client fetches the catalog **at startup only** → users with stale catalogs need "restart Trade
Bay". (Optional future hardening: re-fetch catalog before each launch click.)

## 4. Release upload recipe (proven, repeat it exactly)

1. **Prepare the zip**: FLATTEN any wrapper folder (`Bookmap-patched/`, `ATAS Platform/` …) so
   `Bookmap.jar`, `jre/`, `OFT.Platform.dll` etc. sit at the zip root. Strip personal data
   (Bookmap `Config/`+`Keys/`, activation tokens, `*.bmw` workspaces). **ASCII-only entry
   names** — Windows `tar.exe` (the client's extractor) fails with "Archive entry has empty or
   unreadable filename" on non-ASCII (Cyrillic look-alikes in ATAS template names cost a 1.0.1
   re-release); transliterate (`Tick сluster.cst` → `Tick cluster.cst`).
   Server auto-strips `.bak .db .log .zip __pycache__ node_modules ...` (see `server/app/services/exclusions.py`).
2. Login: `POST /auth/login {"username":"admin","password":...}` → bearer token.
3. `POST /releases/{slug} {"version":"X"}` → release id.
4. **Payload FIRST**: `POST /release/{id}/payload` (multipart file; must be a PE, ≥1KB; correct
   filename matters — it lands in the manifest as the managed executable).
5. **Then the zip**: `POST /release/{id}/zip` (multipart; auto-skips entries named like the
   payload; rebuilds a cleaned zip server-side).
6. `POST /release/{id}/publish`. `latest` = newest **created_at** among published releases.
7. Verify: `GET /catalog/{slug}/manifest?version=latest` (layout, payload role) and
   `POST /download/{slug}/latest/zip-url` with a license key.

Decrypt a payload from dev storage when the original exe is lost:
`python -c "from app.services.storage import read_decrypted_file; ..."` (needs the env the blob
was encrypted under — fresh VPS redeploys generate a new MASTER_ENCRYPTION_KEY; old `.bin`s are
only readable on the machine/env that wrote them).

## 5. Launcher mechanics worth knowing

- **GhostLaunch** (`client/src/GhostLaunch.cpp`): writes the payload as a hidden
  random-named exe at the install ROOT, workDir = payload's folder, copies
  `<payload>.exe.config` → `<ghost>.exe.config`, CreateProcessW, sweeps old ghosts on next
  launch. .NET apphosts are rename-safe (embedded assembly name). Verified working for every
  payload type shipped.
- **Zip-mode releases** download one zip via `downloadToFile` (HTTP Range resume, 4 attempts)
  and extract with `C:\Windows\System32\tar.exe`. Fallback to Expand-Archive only when tar
  fails to *start*, not on errors — so keep zips ASCII (§4.1).
- **License flow on launch**: manifest fetch → local SHA-256 verify of all files (UI shows
  "Checking license" during this — a long stall there = full re-download of changed files,
  one-time per release, not a bug) → `POST /licenses/activate {key,hwid,software_slug}` →
  download missing files.
- **HWID** = sha256(MachineGuid + boot-volume serial + CPU ident) — registry/env only, no WMI.
- **DeepCharts local stack**: launcher's DeepStack needs `proxy/DeepChartsProxy/DeepChartsProxy.exe`,
  `proxy/DeepChartsHistServer/DeepChartsHistServer.exe`, `bridge/VolumetricaBridge.exe`; it
  clears stale listeners on 443/12010, edits the hosts file, writes CA certs to ProgramData.
  "It launched the pythons" = healthy DeepCharts launch.
- **Self-update**: `GET /client-update` (version compare vs `TP_CLIENT_VERSION`) → installer
  swap. `installer/tradebay.iss` builds `TradeBayInstaller.exe` from `client/build/Release`.

## 6. Re-upload material in `installer\`

`Bookmap.exe` (stub payload), `MotiveWave.exe`, `Deepchart.Core.exe`, `OFT.Platform.exe`,
`OFT.PlatformX.exe` (all payloads) · `Bookmap-clean.zip`, `ATAS-fixed.zip`, `ATASX-fixed.zip`
(flattened, ASCII-safe packages) · `Bookmap-patched.zip` (original, dirty — reference only,
contains personal Config) · `DeepCharts-package.zip` (deepcharts source package).

## 7. Bugs fixed this session (do not reintroduce)

- Admin license form silently dropped custom keys → added optional Custom key field
  (`admin/src/pages/Licenses.jsx`).
- `deploy/start-tunnel.bat`: server window launched without working dir (`No module named
  'app'`) → `start "Trade Bay Server" /d "%~dp0server" ...`; health check used `^|` inside
  quotes (PS parse error) → plain `|`. Both shipped in rebuilt zip.
- Bookmap "stuck on Starting": nested zip layout + missing ghost mode (see §3, §4.1).
- ATAS tar extraction failure: Cyrillic filenames (§4.1).
- "Unknown license key": old VPS build lacked custom-key support (fresh zip fixed it).

## 7.4c Client 1.3.2 (2026-10-24)

- `downloadToFile`: 8 attempts (was 4), 30s stall detection (was 90s), resume with backoff,
  visible "resuming from N%" state, actionable final error ("Click Install again — it resumes").
  Root cause of the 6%/11% stalls + failed installs: flaky trycloudflare tunnel dropping big
  downloads mid-stream; self-update downloads fail the same way (silently, keeping users on old
  clients that lack the unlink fix).
- `DeepStack::stopStack` now kills proxy/hist/bridge **by image name regardless of path** — a
  leftover stack from any install root (or elevated) still locks DLLs and caused
  "Can't unlink already-existing object" during extraction. This is the definitive unlink fix.
- Same distribution rule as always: users stuck on old clients just need one successful
  launcher start to self-update (update = 16MB, also resumable in 1.3.2+).

## 7.4b DeepCharts 1.2.3 (2026-10-24)

Root-caused "One or more required types cannot be loaded": SlimDX.dll (mixed-mode) needs the
**VC++ 2010 x64 runtime** (msvcr100.dll / msvcp100.dll). Never shipped in any release — it only
worked on machines that happened to have 2010 installed. 1.2.3 = 1.2.2 + both DLLs at the
package root (DLL search finds them next to the exe; no admin, no redistributable install).
Same trick applies if another app ever needs a runtime: ship the x64 DLLs at package root.

## 7.5 Client 1.3.1 (2026-10-24, shipped via self-update)

- `DeepStack::stopStack(appDir)` kills proxy/hist-server/bridge processes **running from that
  app dir** before package extraction — fixes "Can't unlink already-existing object" when a
  leftover DeepCharts stack locks DLLs during an update.
- `extractZip` now falls back to `Expand-Archive -Force` when tar.exe FAILS (not only when it
  is missing) — survives non-ASCII zip entry names.
- Clients on 1.3.0 auto-update (installer swap restarts the app → catalog refresh also heals
  any stale `launch_mode` / ReflectionTypeLoadException cases).

## 7.5b Client 1.3.3 (2026-10-25)

- Bundled `7za.exe` (7-Zip 26.05 standalone, LGPL, in client/build/Release + installer) as the
  zip extractor between inbox tar and PowerShell. Reason: Mac users running the launcher under
  Wine (Sikarugir) have no tar.exe/PowerShell in the prefix — extraction was impossible there.
  Wine runs a plain x64 console PE, so 7za works. Order: system tar -> 7za -> Expand-Archive.
- "Package incomplete" message now reports extracted/total + first 3 missing files — that list
  identifies the cause remotely (AV quarantine shows the missing patched DLLs; empty extraction
  shows the first alphabetical entry).
- NOTE: inbox C:\Windows\System32	ar.exe depends on archiveint.dll (Windows-internal, not
  redistributable) — do not try to bundle it; 7za is the portable choice.

## 7.4c ATAS/ATAS X 1.0.2 (2026-10-25)

Root cause of "starts then closes after 5s" / "crashes while entering datafeed credentials"
(two customers): the packages shipped only msvcr110.dll but the native libs (DxFeedGraalNativeSdk,
libprotobuf, snappy, glfw3, OFT.Lua, libcurl/ssl) need **VC++ 2015-2022 runtime**
(vcruntime140, vcruntime140_1, msvcp140). Vendor's original installer ran the VC++ redist setup;
the repack lost that step. Works on the dev box because the redist is installed.
Fix: 1.0.2 = package + the three x64 DLLs at root (same pattern as DeepCharts 1.2.3).
Rule of thumb for every repack: scan native DLL imports for CRT deps and ship them at root.

## 7.5c License backup (2026-10-25)

`backups/licenses-20261025-0154.json` = full dump of all 37 licenses on the live VPS (35 active,
2 revoked) via GET /licenses: exact keys (incl. custom ones), expires_at, scope, revoked, notes,
masked HWIDs. If the VPS is ever redeployed (fresh DB), restore by POSTing each license with its
original key and matching expires_at via extend. Re-run the same dump before any risky server work.

## 7.4d ATAS X 1.1.0 + ATAS user-indicator sync (2026-10-26)

- **Release**: `atas-x` 1.1.0 published, now `latest`. Built from `Desktop\ATASX-portable.zip`
  (user's fresh portable). Package changes vs the raw zip:
  - flattened `ATAS X\` wrapper to zip root (raw zip is Compress-Archive with BACKSLASH entry
    separators — python zipfile kept them flat; always detach wrapper folders),
  - ADDED `AppData\Indicators\{3 GUID}.dll` (the new custom indicators; the GUID names are
    ATAS' own compiled output names),
  - added `vcruntime140.dll` / `vcruntime140_1.dll` / `msvcp140.dll` at root (x64, from
    System32 — same VC++ 2015-2022 rule as 1.0.2; the portable zip does NOT contain them),
  - dropped `unins000.dat/.exe` and the payload copy `OFT.PlatformX.exe` (payload uploaded
    separately; exe byte-identical to 1.0.x, sha `857330f7...`),
  - transliterated 2 Cyrillic-named templates: `Tick сluster.cst` → `Tick cluster.cst`,
    `6Е - M5,M15,H1 analysis.cts` → `6E - ...` (U+0441 / U+0415 lookalikes),
  - package built with python zipfile → forward-slash entry names, all ASCII
    (`installer\ATASX-1.1.0.zip`, zip sha `028f294e...`, size 223,796,515 after server clean pass).
- **How ATAS locates user data (verified empirically)**: `OFT.PlatformX.dll.config`
  `<RootSettingsFolder>` = `%APPDATA%\%PROGRAMNAME%` (Roaming `ATAS X\`; `%APPDIR%` = exe dir).
  A package-root `AppData\Indicators` is INERT under the stock config. The KEY supports
  `%APPDIR%`: setting it to `%APPDIR%\AppData` makes the whole thing portable (tested — the app
  created ALL user data incl. Database/Logs in the install dir's `AppData\` and didn't touch
  Roaming). Deliberately NOT shipped: deployed that way it would reset every existing
  customer's settings/workspaces on update (their data all lives in Roaming from 1.0.x).
- **Chosen fix — client 1.3.5**: after package extraction, `Worker.cpp::syncAppDataIndicators`
  copies `<installDir>\AppData\Indicators\*.dll` into `%APPDATA%\ATAS X\Indicators` (and `ATAS`
  for plain atas; hard slug→program map). Rules: additive only, never deletes, skips
  same-size/locked (ATAS running) files, skips newer user-compiled versions. Indicator DLLs now
  flow: new release zip → install/extract → sync → ATAS sees them. Re-extract (click Install)
  re-syncs.
- Distribution: all 1.3.4 clients self-update to 1.3.5 on next start (`installer\``
  `TradeBayInstaller.exe`, sha `2daf4159...` = live /client-update). Order matters for
  customers: restart Trade Bay first (gets 1.3.5), then Install ATAS X → 1.1.0.

## 7.5e Client 1.3.6 — Update button + stale-file cleanup (2026-10-26)

- BUG: an installed-but-older app showed **Launch forever** — `app.html stateOf()` returned
  'installed' purely on `state.installed[id]`, and the native→UI update signal was discarded
  (`MainWindow::onAppInfo` was all-Q_UNUSED). The launch flow still healed file diffs silently,
  but the UI never said "Update".
- FIX (client 1.3.6):
  - app.html: `cmpVer()` semver compare + new state `'update'` (STATUS 'Update available') and
    a primary **"Update to <latest>"** button routed through the existing data-install job.
  - Worker.cpp: `saveManifestSnapshot` stores `manifests/<slug>-<version>.json` at every
    completed install; `saveCachedManifest` archives the previous version's snapshot before
    overwriting the live cache; `cleanupStaleFiles(slug, oldVer, latest, dir)` deletes files the
    previous release owned that the new manifest dropped — guarded by path-safe check + size
    match + SHA match against the OLD manifest (user-modified or unknown files are never
    touched) and prunes emptied dirs. First update after 1.3.6 has no snapshot yet → no-op;
    from the second update on, cleanup kicks in.
  - Qt6 note: `QFile::rmdir` no longer exists — use `QDir().rmdir(path)`.
- Live: `/client-update` = 1.3.6, sha `f7855fbc...`. Client versions <1.3.6 self-update on
  start; users then see Update available for ATAS X (1.0.x → 1.1.0).
- **1.3.8 (2026-10-26 evening):** the Update button was a silent no-op — `app.html enqueue()`
  filtered candidates with `!state.installed[id]`, so any platform with an existing install
  entry was dropped and the click did nothing. Now installs queue for both `available` and
  `update` states; clicking a blocked state logs the reason in the overview log instead of
  dying quietly. Live `/client-update` = 1.3.8, sha `80f4c117...`.
- Admin password was rotated by the user (per-redeploy rotation is expected); current value
  lives in `server\.env` on the VPS — ask the user, do not hardcode it here.

## 8. Environment quirks

- **User's dev machine GPU driver is unstable** (LiveKernelEvent 141/193/1cc, BSOD
  2026-10-23 19:34). "App opens and closes instantly" here can be driver crashes — check
  Event Viewer → Application/System BEFORE debugging app code.
- VPS runs Python 3.15 in `server\.venv`; keep the venv when re-extracting the zip.
- Tunnel log noise `stream canceled by remote with error code 0` = normal client download
  aborts/resumes; `context canceled` on /licenses/activate = client-side abort. Not bugs.

## 9. Working style (user's explicit preference)

**"Lean, simple, concise. Do not overengineer."** Fix the root cause with the smallest sound
change; verify end-to-end (reproduce → fix → re-verify against the real artifact); report
crisply. Server code style: FastAPI routers per domain, services/ helpers, SQLAlchemy models;
admin: plain React function components per page; client: Qt Widgets, Worker (QThread jobs) →
LauncherCore signals → MainWindow UI.
