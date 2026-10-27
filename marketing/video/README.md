# TradeBay TikTok Video — 25s Vertical Motion-Graphics

Programmatic motion-graphics promo for TradeBay ($119.99 per platform, 7 trading
platforms). Renders every frame as a PNG in Node.js with `@napi-rs/canvas`,
pipes it straight into ffmpeg, then muxes procedurally generated SFX.

**Output:** `out/tradebay_tiktok.mp4` — 25.0 s, 1080×1920 @ 60 fps, H.264 CRF 18 + AAC 192k, ~5 MB.

---

## Quick start

```powershell
# 1. SFX (only needed once / after changing sfx.py)
python sfx.py

# 2. Smoke test — writes 24 QC stills to qc/ instead of a video (fast)
$env:SMOKE = "1"; node render.js

# 3. Full video-only render (1500 frames piped live into ffmpeg)
node render.js                 # -> out/video_nosound.mp4

# 4. Mux audio on top
powershell -ExecutionPolicy Bypass -File assemble.ps1
# -> out/tradebay_tiktok.mp4
```

`ffmpeg.exe` lives at `C:\Users\hawdi\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe`
(installed via `winget install Gyan.FFmpeg`). `render.js` ships the same absolute
path so it works in fresh shells whose PATH hasn't refreshed yet.

---

## Pipeline

```
site/styles.css + site/index.html          PowerShell 5.1 terminal
        |  (design tokens, real $119.99 pricing, platform metadata)      |
        v                                                                v
installer/tradebay.ico                    sfx.py  --(pure stdlib)-->  sfx/*.wav
        |  (ICO directory table -> largest PNG entry -> loadImage)        |
        v                                                                |
site/app.js (Market, Heatmap, Footprint, Candles, Waves scene classes)      |
        |  ported verbatim into render.js                                 |
        v                                                                v
render.js  --(1500 PNGs, image2pipe)-->  ffmpeg  -->  video_nosound.mp4    |
                                                          |               |
                                                     assemble.ps1 <-------+
                                                          |
                                                          v
                                                  out/tradebay_tiktok.mp4
```

| File | Role |
|---|---|
| `render.js` | Everything visual: tokens, easing, scene engines, scenes, frame loop, ffmpeg pipe. |
| `sfx.py` | Generates the SFX wav library with zero dependencies (see inside for the synth recipes). |
| `assemble.ps1` | ffmpeg filter_complex that volume-stages + adelay-mixes every SFX against the video. |

## Scene timeline (fixed, sums to exactly 25.0 s)

| # | Scene | Dur | Start | Content |
|---|---|---|---|---|
| S0 | `hook` | 2.8 | 0.0 | "$627+" monthly-rent counter with command shake |
| S1 | `chips` | 2.8 | 2.8 | 7 platform price chips fly in, `$627 / MO IN RENT` total |
| S2 | `implode` | 2.4 | 5.6 | Chips collapse to one point, impact at +1.45 |
| S3 | `reveal` | 2.8 | 8.0 | Brand panel: real tradebay.ico sprite, "$119.99 per platform", 7 hue tiles |
| S4 | `product` | 4.2 | 10.8 | Launcher window (client/build/Release/app.html styling): lib list, INSTALL, progress card, RUN |
| S5 | `showcase` | 6.4 | 15.0 | All 7 terminals, 0.914 s each, each drawing one of the ported site scenes |
| S6 | `proof` | 1.6 | 21.4 | LIFETIME ACTIVATION / FREE UPDATES / $119.99 EACH stamp cards |
| S7 | `cta` | 2.0 | 23.0 | PAY ONCE. TRADE FOREVER. + strap line + ico |

Beats are data: `SCENES` + the derived `starts[]` array at the top of the timeline
section in `render.js`. Crossfade `XFADE = 0.34` s with a sine dip-to-black and
small white impact flashes on the four key hits (0.95, 7.05, 14.79, 21.55 abs).

## Design system (from site/styles.css)

Ground/chrome/surface/raised layering, `#4a8ad6` accent, `#44a282`/`#e5566f`
pos/neg, per-platform hues (sc cyan, atas purple, bm amber, mw coral, ax magenta,
dc blue, jig green), 8/4 radii, dotted 18px background, Public Sans + JetBrains
Mono **glyphs rendered with system fallbacks** (Segoe UI / Cascadia/Consolas)
because the webfonts are not installed on the machine.

**Facts that must stay true:** $119.99 per platform, one-time payment, 7
platforms, authorized-reseller strap line. Monthly platform prices shown in S1
are placeholders — verify against each vendor before publishing. Claims are
deliberately limited to lifetime activation + free updates (no "works offline",
no "no keys").

## Where to tweak what

- **Timing / copy** — `SCENES` array + the scene functions (`sceneHook` … `sceneCta`).
- **Platform metadata** (name, hue, letters, seed, scene kind, sym, monthly) — `APPS`.
- **Terminal showcase** — `BODY_W/H`, `TERMINALS`, the per-app scene mapping.
- **Audio** — timing table `$mix` in `assemble.ps1`; synthesis in `sfx.py`.
- **Environment flips the whole renderer into still-image QC mode: `SMOKE=1`.**

## Hard-won pitfalls (read before editing)

1. `rr()` clamps radius to `min(r, w/2, h/2)` — a radius-999 pill on a small box
   used to explode into giant pinwheel/ellipse fills covering whole scenes.
2. `loadIco()` fetches asynchronously (ncanvas `loadImage`); it is always awaited
   from the main blocks — don't call `ico()` before that resolves.
3. Scene classes (`Heatmap`, `Footprint`, `Candles`, `Waves`) are constructed
   with `(options, w, h)` and carry a **bound** `this.ctx` — that is why
   showcase draws with `scene.draw()` directly while the same classes also
   support a raw `drawImpl(ctx,w,h)` / `g()` destructure pattern from the site.
4. `Waves.build()` reads `this.o.seed` — constructor must store `this.o = o`.
5. The render loop uses `t` (frame time) not wall-clock; every animation is an
   explicit function of `t` so output is deterministic and re-renderable.
6. Don't truncate the 25.0 s trim in `assemble.ps1` (`atrim=0:25.0`) — it
   guarantees TikTok's exact-duration requirement after AAC padding.

Full field guide for a fresh agent: [docs/REPLICATION.md](docs/REPLICATION.md).

## Snapshot of the source HTML/CSS/JS the styling is derived from

Copied verbatim into `src-reference/` so the renderer's references don't break
if the site or client build is upgraded later:

| File | Origin |
|---|---|
| `src-reference/site_index.html` | `C:\TradingPlatform\site\index.html` (real pricing, platform ids) |
| `src-reference/site_styles.css` | `C:\TradingPlatform\site\styles.css` (design tokens) |
| `src-reference/site_app.js` | `C:\TradingPlatform\site\app.js` (chart engines ported into render.js) |
| `src-reference/app_launcher.html` | `C:\TradingPlatform\client\build\Release\app.html` (launcher window styling) |

---

## Short non-linear cut (`render_short.js`)

**Output:** `out/tradebay_short.mp4`: 25.0 s, 1080×1920 @ 60 fps, −14.8 LUFS. 7 platforms, **$149.99** each.

```powershell
powershell -ExecutionPolicy Bypass -File extract_icons.ps1   # real app icons from the installed exes -> icons/
node make_dc_icon.js     # DeepCharts only ships a 32px icon; redraws the same mark as 256px vector
node render_short.js     # raw RGBA piped to ffmpeg -> out/tradebay_short_nosound.mp4 + out/timeline_short.json
# (music removed: assemble_short.js mixes SFX only; music_short.py is unused)
node assemble_short.js   # SFX only (no music) -> out/tradebay_short.mp4
# QC: $env:SMOKE="1"; node render_short.js  -> qc/rs_*.png (entry + mid frame of every shot)
```

- Story runs out of order: payoff first ("PAID ONCE.") -> rewind -> monthly-bill problem -> logo drop -> 7 platforms at 1.5 s each -> all 7 -> launcher -> install -> benefits -> price -> CTA.
- Icon sources: ATAS `Desktop\OFT.Platform.exe`, ATAS X `Desktop\OFT.PlatformX.exe`, Bookmap `Desktop\Bookmap.exe`, MotiveWave `Program Files (x86)\MotiveWave\MotiveWave.exe`, Sierra Chart `C:\SierraChart\SierraChart_64.exe`, Jigsaw `Program Files\Jigsaw Trading\daytradr64.exe`, DeepCharts vector redraw (see above). `engines.js` `tile()` draws these wherever a platform tile appears, including the launcher list.
- Motion: `spr(t, [response, damping])` is a damped-spring step response. Presets SNAP, BOUNCE, SETTLE, SOFT and SLAM drive every entrance; notifications drop in on BOUNCE and older ones spring down the stack.
- Transitions: `slide`/`slideU` pan both shots live on a SOFT spring, averaging 8 sub-samples per frame for real motion blur. Also `punch`, `fade`, `fromWhite`, `cut`, and one `flash` at the logo drop.
- Charts render at 2× (680 logical -> 1360 px) inside app windows, so their text stays sharp.

---

## "One Line" cut (`render_line.js`)

**Output:** `out/tradebay_line.mp4`: 22.0 s, 1080×1920 @ 60 fps, sound effects only.

```powershell
python sfx_line.py               # paper-rip sfx -> sfx/rip.wav
node render_line.js              # -> out/tradebay_line_nosound.mp4 + out/timeline_line.json (~15 min)
node assemble_short.js line      # SFX mix -> out/tradebay_line.mp4
# QC: $env:SMOKE="1"; $env:TIMES="5.9,7.4"; node render_line.js  -> qc/ln_*.png
```

- No hard cuts. A receipt prints and jams, tears, and leaves a PAID ONCE ticket. The camera dives through the "O" to the logo, which splits into 7 tiles that flip to the real app icons. The first tile grows into a window, then the camera glides across all 7 live app windows, linked by one green line. The line becomes the install bar, the bar morphs into a swinging $149.99 tag, the tag flips to PAY ONCE / TRADE FOREVER, and the camera pulls out to show it hanging from the Trade Bay logo.
- `drawWorld(g, t)` is a pure function of time. Every frame averages 5 samples across a 180° shutter, so all motion has real motion blur. Light film grain and a vignette are added on top.
- All beat times are constants at the top of the file (`JAM`, `TEAR`, `S_AT(i)`, `FILL0`, `MORPH`, `FLIP`, `PULL`…). The sound timeline is built from the same constants, so moving a beat keeps its sound in sync.
