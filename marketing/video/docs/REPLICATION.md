# REPLICATION GUIDE — how to (re)build the TradeBay TikTok video from scratch

Target audience: an AI agent (or human) with **no prior context**. Everything
needed to reproduce, modify, or re-render the video is in this file.

Final artifact: `C:\TradingPlatform\marketing\video\out\tradebay_tiktok.mp4`
(25.000 s, 1080×1920, 60 fps, H.264 yuv420p CRF 18, AAC 192 kbps +faststart).

---

## 0. Toolchain facts

| Requirement | Value used |
|---|---|
| Node.js | v24.12.0, CommonJS. Only dep: `@napi-rs/canvas` (prebuilt, no native compilation) |
| Python | 3.11.3 — **stdlib only**, no pip packages |
| ffmpeg | winget `Gyan.FFmpeg`; binary at `C:\Users\hawdi\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe` |
| ffprobe | same folder |
| Shell | Windows PowerShell 5.1 — no `&&`; use `cmd1; if ($?) { cmd2 }` |

npm setup (already done, reproduce if folder is fresh):

```powershell
Set-Location C:\TradingPlatform\marketing\video
npm init -y
npm install @napi-rs/canvas
```

## 1. Source-of-truth files this video is derived from

Snapshots are kept in `../src-reference/` (written into `REPLICATION.md §1` just as paths below so the doc stays valid even before snapshot exists).

Read these before touching `render.js` — the video is a faithful derivative:

Snapshots are kept in `../src-reference/`:

- `src-reference\site_styles.css` (= `C:\TradingPlatform\site\styles.css`) — design tokens. Copy values, don't invent.
- `src-reference\site_index.html` (= `C:\TradingPlatform\site\index.html`) — REAL pricing `$119.99` per platform
  (site `CONFIG.price`), platform ids (`atas, ax, bm, mw, dc, sc, jig`).
- `src-reference\site_app.js` (= `C:\TradingPlatform\site\app.js`) — the live chart engines
- `src-reference\app_launcher.html` (= `C:\TradingPlatform\client\build\Release\app.html`) — launcher window styling

(`Market`, `Heatmap`, `Footprint`, `Candles`, `Waves`) and the terminal-frame
chrome (40px bar, hue tile + letters, symlink, $119.99, foot with view
caption). The showcase scene in the video ports these engines **verbatim**.
The launcher window styling drives the product scene.
- `C:\TradingPlatform\installer\tradebay.ico` — brand icon. It is an ICO whose
  entries are all **PNG payloads**; parse with `render.js`'s `loadIco()` (read
  the 6- + 16-byte directory entries, take the largest payload, `loadImage`
  that byte range). Never hand-draw a fake logo tile — the real icon must appear.
- `C:\TradingPlatform\.taste-skill\direction.json` — "data terminal" taste:
  mostly muted surfaces + white/typography, spend accent budget on data colors.

## 2. Content constraints (non-negotiable)

- Price: **$119.99 per platform, one-time**. 7 platforms: ATAS, ATAS X,
  Bookmap, MotiveWave, DeepCharts, Sierra Chart, Jigsaw.
- Hook number: `$627+` = sum of *placeholder* monthly prices (80+120+79+94+99+36+119).
  These monthly figures are NOT verified — a human must confirm before publishing.
- Allowable claims: lifetime activation, free/signed updates, authorized
  reseller. **Removed claims:** "works offline", "no keys".
- 25.0 s exactly, 1080×1920 (TikTok).

## 3. Architecture of render.js (single ~1200-line file)

Section order inside the file (top→bottom):

1. **Env/consts** — `W=1080 H=1920 FPS=60 DUR=25.0`, `SMOKE` flag, `FF` path.
2. **Tokens `C`** — colors from styles.css (see §4).
3. **Math/helpers** — `clamp01 lerp seg outExpo outCubic inOutQuint inOutSine
   spring shake rnd`, font stacks (`famOr` probes installed families: Public
   Sans → Segoe UI; JetBrains/Cascadia Mono → Consolas).
4. **APPS registry** — 7 entries `{ id, name, hue, letters, m: '$80/mo'…,
   scene: 'footprint'|'heatmap'|'candles'|'waves', seed, sym, dom, variant, view }`.
   `MO_TOTAL` derived from `m`.
5. **Ico loader** — `loadIco()` (async, awaited) + `ico(ctx,x,y,s,glow)`.
6. **Primitives** — `rr` (rounded rect, **radius clamped**), `cam` (zoom/pan
   via transform), `txt`, `caption` (bottom captions w/ shadow), `flash`,
   `scopeMark` (green dot), `tile` (hue-letter chip).
7. **backdrop** — prerendered dotted 18px canvas, slow horizontal drift.
8. **Ported engines** — `SYMBOLS` (ESZ6/NQZ6/CLZ6 anchor prices),
   `rng/hash`, `Market` (order-flow sim), `mfont/priceTag/rowAxis/drawDom`,
   `makeLut` (hue→heat ramp), `Heatmap`, `Footprint`, `Candles`, `Waves`.
   These classes manage their own stepping; construct with `(o, w, h)` and
   bind `scene.ctx`/`scene.w/h` afterwards.
9. **SCENE timing** — `SCENES` array (see §5), `starts[]`, `XFADE=0.34`.
10. **Scene functions** `sceneHook … sceneCta` — each returns `(t, ctx) => {}`
    drawing in scene-local time `t`.
11. **Frame pipeline** — `renderSceneInto(octx,t)`, `renderFrame(t)`
    (crossfade + dip + flashes), `renderFrameMain`, `sceneAt`.
12. **Main** — `SMOKE` branch writes 24 stills; else spawns ffmpeg with
    `-f image2pipe -framerate 60 -i pipe:0 … libx264 -crf 18 -tune animation`
    and pushes 1500 PNGs with backpressure handling
    (`if (ff.stdin.writableNeedDrain) await once('drain')`).

### 4. Token table (hex, from styles.css)

```
ground #0e0e11  chrome #121215  surface #19191e  raised #25252b
border #2d2d35  rule  #232329  text #ffffff    soft #cacbd0
muted  #9c9ea6  accent #4a8ad6  positive #44a282 negative #e5566f
warning #d9a441 posInk #5fc39c pillPosBg/pillAccBg/accentInk = site values
heat-1 #10233f  heat-2 #1d4f8e
hues:  sc #46c2d8  atas #9a7cf0  bm #e3a948  mw #ef8466  ax #d46fd0
       dc #7fb0ea  jig #5fc39c
```

### 5. Timeline + SFX sync table (authoritative)

Scene starts (ms): 0, 2800, 5600, 8000, 10800, 15000, 21400, 23000. Durations
2.8/2.8/2.4/2.8/4.2/6.4/1.6/2.0. Crossfade 0.34 s (dip-to-black peak 0.22 alpha).

SFX mix (`assemble.ps1 $mix`, `V` volumes: tick .65 whoosh .5 riser .75 boom .95 pop .85 chime .6):

```
whoosh 0      riser 0      boom 950        # hook impact @ abs 0.95
whoosh 2800                                  # chips entry
tick 3080+140i (i=0..6)  pop 4400            # 7 chips + $627 total chip
whoosh 5600   riser 6200   boom 7050        # implosion impact @ 5.6+1.45
whoosh 8000   chime 8300                   # reveal panel + icon spring
whoosh 10800                                 # launcher window
tick 11700+200i (i=0..6)                     # lib-list selection cycle
riser 13100  pop 14350                       # install progress -> RUN ready
pop 14750     boom 14800                     # RUN click flash @ 14.75/14.8
pop 15000+914k (k=0..6)                      # each showcase terminal
boom 21550 21950 22350                       # three proof stamps
whoosh 23000  chime 23150                    # CTA
```

In-canvas flashes (render.js `renderFrameMain`): white flash 0.55 at t=0.95,
0.6 at implode +1.45, 0.55 at product 14.75→15.0 boundary, plus per-scene-end
entries. Keep flashes/sfx table in sync if you move scenes.

### 6. Terminal showcase internals (S5)

- `BODY_W=1000, BODY_H=560` body canvas per app, preallocated once (7 canvases).
- Frame: 40px bar (chrome) + body + ~30px foot, 1.5px hue-colored border,
  hue tile + name + sym left, `$119.99` (posInk) right, foot: `view` left,
  `illustration` right.
- Per-terminal timings: `per = 6.4/7 ≈ 0.9143 s`; local fade in/out `a =
  min(1, lt/0.1, (per-lt)/0.1)`; body composited over ground; caption line
  `NAME — view` at y=1500; `1 / 7` counter at y=1660.
- Engines keep stepping every frame even across app switches — state is
  continuous because each of the 7 top-level `TERMINALS[i].scene` steps only
  while its app is on screen.

### 7. Reproduction from a cold start, exact order

```powershell
Set-Location C:\TradingPlatform\marketing\video
python sfx.py                                  # regenerate sfx/*.wav if missing
$env:SMOKE="1"; node render.js                 # expect "SMOKE done", 24 qc PNGs
# visually QC every qc/*.png (timestamps overlap-proof: delete qc first)
Remove-Item qc\*.png
node render.js                                 # "VIDEO RENDER OK" -> video_nosound.mp4
powershell -ExecutionPolicy Bypass -File assemble.ps1   # "MUX OK" -> tradebay_tiktok.mp4
ffprobe -v error -show_entries format=duration,size out\tradebay_tiktok.mp4
```

Success criteria: duration exactly 25.0, two streams (h264/hw irrelevant +
aac), size ~5 MB, no black frames at scene boundaries, ico renders in reveal
(t≈9.2) and CTA (t≈24+), launcher free of giant white/colored shapes.

### 8. Debug protocol (learned the hard way)

- Bug class 1: **arcTo radius > box half-size** → giant pinwheel/ellipse fills.
  Anywhere a pill/button uses radius ≥ box dimension, clamp (already fixed in
  `rr`). Symptoms: white blobs, green stars mid-window.
- Bug class 2: **async icon** — `ico()` used before `await loadIco()` →
  `drawImage` TypeError "not of type CanvasElement".
- Bug class 3: **missing ctx binding on engine classes** — `Waves.build()` uses
  `this.o.seed`; constructor must store `this.o`. `Heatmap` destructures
  `{ctx,w,h}` from `this` (`g()` returns `this`), so `scene.ctx` assignment
  post-construction is load-bearing for all engines.
- Bug class 4: **stale QC** — old stills share filenames across render-script
  versions. Always `Remove-Item qc\*.png` before smoke.
- Bug class 5: **overlapping status text** — launcher statusbar and lib-pane
  footer both drawing at `y+h-13`; keep one owner for each horizontal band.
- Determinism: all randomness seeded via `rng(seed)`/`hash(i)` with per-app
  fixed seeds (23, 59, 5, 41, 77, 11, 13) — a rebuild reproduces pixels.

### 9. If you must regenerate SFX from scratch

Pure-stdlib synth in `sfx.py` writes 44.1 kHz 16-bit mono WAVs: `riser` (sine
sweep + noise floor), `boom` (body sine drop + sub thump + noise crack tail),
`whoosh` (band-passed noise swell), `tick` (5 ms click), `pop` (fixed click w/
pitch drop), `chime` (two-partial bell). Envelope formulas live inline; keep
generation O(n)-time (precompute `env[i]`, no per-sample Math.pow chains —
previous quadratic-env-in-loop version was 100x slower).
