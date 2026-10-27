# Trade Bay promo videos: project guide

Everything you need to understand, re-render, edit and *keep smooth* the promo videos.

---

## 1. The videos

| File (in `out/`) | Script | Length | Style |
|---|---|---|---|
| `tradebay_line.mp4` (**current**) | `render_line.js` | 22 s | "One Line": no hard cuts, one camera, one green line |
| `tradebay_short.mp4` | `render_short.js` | 25 s | Fast cuts on a beat grid, slide transitions |
| `tradebay_18s.mp4` | (old, scripts since replaced) | 18 s | First short cut; 5 platforms, $119.99 (outdated) |
| `tradebay_tiktok.mp4` | `render.js` | 25 s | Original video; 7 platforms at $119.99, unverified monthly prices |

All are 1080×1920, 60 fps, H.264 + AAC, built for TikTok/Reels.

**Facts that must stay true:** 7 platforms (ATAS, ATAS X, Bookmap, MotiveWave, DeepCharts, Sierra Chart, Jigsaw), **$149.99 per platform, one time**. The website still says 5 platforms at $119.99. The site is outdated, not the videos.

---

## 2. How it works

There's no video editor. Every frame is drawn in code.

```
Node + @napi-rs/canvas ──draws each frame──► raw RGBA ──pipe──► ffmpeg (libx264) ──► *_nosound.mp4
        │                                                                              │
        └─ writes out/timeline_<name>.json (every sound + its time) ──► assemble_short.js ┘──► final .mp4
```

- **Frames:** a JS function draws frame `t` onto a 1080×1920 canvas. Raw pixels are piped straight into ffmpeg, with no PNG files in between.
- **Charts:** the live order-flow, heatmap, candle and wave charts are ported from the website (`site/app.js`) into `engines.js`. They are drawn at 2× resolution so their text stays sharp.
- **Sound:** sound effects are synthesized by Python scripts (stdlib only) into `sfx/*.wav`. `assemble_short.js` places each one at its time from the timeline JSON and mixes them into the video.
- **Icons:** real app icons are pulled from the installed exes into `icons/`.

### Files

| File | Job |
|---|---|
| `engines.js` | Shared module: colour tokens, chart engines, launcher window, `tile()` (draws real logos) |
| `render_line.js` | Current video. Edit this to change it. |
| `render_short.js` | 25 s fast-cut version |
| `assemble_short.js` | Mixes the sound effects onto a video: `node assemble_short.js <name>` |
| `sfx.py`, `sfx_line.py`, `music_short.py` | Sound synthesis (`music_short.py` is no longer used; videos are SFX-only) |
| `extract_icons.ps1` | Pulls 256 px icons from the app exes into `icons/` |
| `make_dc_icon.js` | Redraws the DeepCharts icon as a vector (its exe only contains a blurry 32 px icon) |
| `icons/`, `sfx/` | Generated assets |
| `qc/` | Preview stills for checking |

### Requirements
Node 24 (`npm install` gives `@napi-rs/canvas`), Python 3.11 (no packages), ffmpeg at
`C:\Users\hawdi\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe` (`winget install Gyan.FFmpeg`).

---

## 3. Make the current video

```powershell
cd C:\TradingPlatform\marketing\video
powershell -ExecutionPolicy Bypass -File extract_icons.ps1   # once: real app icons
node make_dc_icon.js                                         # once: sharp DeepCharts icon
python sfx.py; python sfx_line.py                            # once: sound effects
node render_line.js                                          # ~4 min -> out/tradebay_line_nosound.mp4
node assemble_short.js line                                  # -> out/tradebay_line.mp4
```

**Quick preview without rendering the whole video:**
```powershell
$env:SMOKE="1"; $env:TIMES="2.9,5.9,17.6,21.5"; node render_line.js   # stills -> qc/ln_*.png
```
In smoke mode the charts only advance on the frames you render, so their contents may differ slightly from the final video.

---

## 4. The "One Line" storyboard (render_line.js)

| Time | Beat | Moves into the next beat by |
|---|---|---|
| 0–2.5 | "It **never** stops." A receipt prints monthly renewals, speeds up, then jams | The paper tears |
| 2.5–3.3 | Halves fly apart; a **PAID ONCE.** ticket bounces up | The camera dives into the "O" |
| 3.3–4.4 | Zoom through the O's hole | The Trade Bay logo appears inside |
| 4.4–5.6 | Logo splits into 7 tiles that flip to the real app icons | The first tile grows into a window |
| 5.6–15.7 | The camera glides across 7 live app windows, stopping on each; a green line links them | The line leaves the last window |
| 15.7–17.1 | The line becomes the install bar, 0→100% | The bar morphs into a tag |
| 17.1–19.5 | A **$149.99** tag swings on a string, then flips to PAY ONCE / TRADE FOREVER | The camera pulls out |
| 19.5–22 | The tag hangs from the Trade Bay logo; "7 platforms · $149.99 each", **LINK IN BIO** | End |

All times are constants at the top of `render_line.js` (`JAM`, `TEAR`, `S_AT(i)`, `FILL0`, `MORPH`, `FLIP`, `PULL`…). The sound list is built from the same constants, so moving a beat moves its sound too.

---

## 5. How to make it smooth (the rules this project follows)

### Motion
1. **No linear motion.** Constant-speed movement looks robotic. Use springs for anything that arrives and eases for anything that drifts.
2. **Use real springs,** not keyframed bounces. `spr(t, [response, damping])` is the step response of a damped spring:
   - `response` = how long one wobble takes (smaller is faster)
   - `damping` below 1 bounces; 1 doesn't overshoot

   | Preset | Values | Use for |
   |---|---|---|
   | `SNAP` | 0.32, 0.8 | Text, small UI |
   | `BOUNCE` | 0.42, 0.5 | Icons, badges, notifications, price pills |
   | `SOFT` | 0.55, 0.95 | Window growth, morphs |
   | `CAM` | 0.75, 0.88 | Camera glides (tiny overshoot = feels handheld-premium) |
   | `CRIT` | 0.5, 1 | Flips (overshoot would flip back) |

   Use few presets and reuse them everywhere. Consistency reads as "professional".
3. **Stagger, don't sync.** In a group, start each item 35–80 ms after the previous one (tiles, rows, logo → name → price).
4. **Anticipation before big moves.** The zoom through the O starts very slowly, then accelerates (`inQuart`).
5. **Things that fall use gravity:** the falling receipt half accelerates (`x²`).

### Motion blur (the biggest "expensive look" win)
- Every frame is the **average of 5 sub-frames** spread across 1/120 s (a 180° film shutter). `drawWorld(g, t)` is a **pure function of time**, so it can be called at any `t`. Blur then appears automatically on anything moving fast and nowhere else.
- To blur more, increase `SHUT`. For more accuracy, increase `N`. Each extra sample adds render time.
- Rule for keeping blur correct: never store animation state between frames. Compute everything from `t`. (The chart engines are the only exception; they step once per frame.)

### Transitions
- **Match transitions beat cuts:** dive through a letter, an icon splitting into tiles, a tile growing into a window, a line becoming a bar, a bar becoming a tag. Each scene comes *out of* the previous one.
- **One continuous camera:** the app windows sit on one long strip and the camera glides along it. Nothing pops in from nowhere.
- **One visual thread:** the green line and the green price colour run through every scene.
- **Little or no flashing.** White flashes feel cheap; motion and blur carry the energy instead.

### Readability (TikTok)
- **Hold anything with text on screen for at least 1 s once settled.** Each app has about 1.5 s per slot.
- **Big heavy type** (Segoe UI Black, 100–260 px), short lines, at most about 4 words per message.
- **Safe zones:** keep key text between y ≈ 200 and 1600 and away from the right edge, where TikTok's buttons and caption sit.
- **Restrained palette:** dark background, white text, green for the line and price, red only for the problem (receipt, "never"), each app's own colour as a soft glow.

### Texture
Light film grain (overlay, 7%) and a vignette are added after the blur. They make the flat digital look feel filmed.

### Sound
- Every visible event has a sound: printer ticks, rip, whooshes on glides, pops on landings, a ding at 100%, a chime at the end.
- The sound effects only, no music. The mix is loudness-normalised to about −14 LUFS (TikTok standard) with a limiter. Adjust with `$env:GAIN="2.0"`.

---

## 6. Checking quality before posting

```powershell
# exact length, codecs
ffprobe -v error -show_entries format=duration:stream=codec_name -of compact out/tradebay_line.mp4
# loudness (target about -14 LUFS, peak below -1 dB)
ffmpeg -i out/tradebay_line.mp4 -af ebur128=peak=true -f null -
# black or frozen frames (should print nothing)
ffmpeg -i out/tradebay_line.mp4 -an -vf "blackdetect=d=0.05:pix_th=0.06,freezedetect=n=0.001:d=0.3" -f null -
```
Then **watch it on a phone with sound**. Automated checks can't judge feel.

---

## 7. Common edits

| Want to… | Do this |
|---|---|
| Change the price | `PRICE` at the top of `render_line.js` |
| Reorder apps | `ORDER` array (the first entry is the tile that grows into the first window) |
| Give apps more or less screen time | Change `1.5` in `S_AT`, then shift `TRACK…PILL` and `DUR` by the same total |
| Swap a logo | Replace `icons/<id>.png` (256×256 PNG with transparency) |
| Change the wording | Search the text in `render_line.js`; keep it short |
| Make an animation bouncier | Lower the damping (second number) of its spring preset |

---

## 8. Pitfalls already hit (don't repeat)

- **Missing glyphs:** the fonts lack ◀ ▶, so they render as empty boxes. Draw arrows as shapes.
- **`rr()` radius** is clamped to half the box. Without the clamp, large radii draw giant blobs.
- **Icons load asynchronously:** `loadIco()` and the logo `loadImage` must be awaited before the first frame.
- **Chart engines** need `sc.ctx` assigned and the 2× transform set before each `draw()`. `chart(id)` handles this.
- **Clear old QC stills** (`qc/`) before reviewing, or you'll compare against stale frames.
- **DeepCharts** only ships a 32 px icon. Keep the vector redraw unless a real high-res logo is provided.
- **Claims:** the receipt names no vendor and shows no amount. Don't add "works offline" or competitor monthly prices without verifying them.

---

## 9. "Colour chapters" style (render_chapters.js): three 15 s videos

A newer style, dealt by the taste-skill plugin (direction *colour-chapters*, seed 1159058888), replacing the dark dotted look.

| Video | Command | Message |
|---|---|---|
| `tradebay_once.mp4` | `node render_chapters.js once` | Still renting → Pay once. Keep it. → Seven platforms → $149.99 ticket → Link in bio |
| `tradebay_steps.mp4` | `node render_chapters.js steps` | Buy once → Install the launcher → Paste your key → Launch → Link in bio |
| `tradebay_pick.mp4` | `node render_chapters.js pick` | Pick your platform → Order flow / Liquidity / Speed and code / Waves and Fib → $149.99 each |

Then `node assemble_short.js <name>` adds the sound effects. Preview stills: `$env:SMOKE="1"; node render_chapters.js once`.

**Style rules**
- Each part is one flat, full-screen colour: slate `#a6b3bc`, sage `#b7c8be`, blush `#d6c4b8`, olive `#2c3620` (cream `#e3e2da` text on olive). The next colour rises from the bottom with a hard straight edge.
- One typeface, Hanken Grotesk (`fonts/`): 500 for headings at up to 160 px, letter spacing −0.05em, leading 0.92; 400 for captions at 46 px. Sentence case. Every heading starts at x = 80.
- Square corners. No gradients, glows, shadows, outlines, monospace, counters or all-caps labels.
- The product appears as itself: real app icons, live charts cut square, and huge controls (a button, progress bar or key field) cropped by the frame edge.
- Calm motion: critically damped springs only (no overshoot); text rises 28 px and fades in, one line 80 ms after the next; 5-sample motion blur.
- Every part lasts 2–3.5 s with 6 words or fewer per heading.
- Each video is a list of chapters (`bg`, `dur`, `sfx`, `draw`) in `VIDEOS` inside `render_chapters.js`. Edit the wording and timing there.

---

## 10. Dark explainers with a Discord close (render_dark.js): two 20 s videos

| Video | Command | Story |
|---|---|---|
| `tradebay_math.mp4` | `node render_dark.js math` | $2,400 counter → monthly-bill line vs one $149.99 line, "You keep $2,250" → the green line becomes the launcher → 7 installs → price → Discord |
| `tradebay_pov.mp4` | `node render_dark.js pov` | A cursor does it live: key email → copy → launcher opens → paste → 7 locks open → Install all → Bookmap opens full screen → price → Discord |

Then `$env:GAIN="2.6"; node assemble_short.js <name>` (about −14 LUFS).

- Flat near-black background, Hanken Grotesk, green = kept/done, red = spent, Discord blue only on the join button.
- Every phase hands an object to the next and starts about 0.25 s before the previous one ends; captions lift out as the next one rises in.
- **Before posting:** `DISCORD` at the top of `render_dark.js` holds the reasons to join. They are unconfirmed placeholders; replace them with what the server really offers. The $100/month in `math` is labelled "Example price".
- `ffmpeg blackdetect` reports "black" on these because the background is near-black. That's expected, not an error.

---

## 11. "Free" videos (render_free.js): two 18 s videos

| Video | Command | Story |
|---|---|---|
| `tradebay_free_dont.mp4` | `node render_free.js dont` | A Buy $149.99 button runs from the cursor, folds and falls → live ATAS X footprint → 6 more platforms → Discord |
| `tradebay_free_cart.mp4` | `node render_free.js cart` | 7-platform cart totals $1,049.93 → a FREE stamp on each row rolls it to $0.00 → ATAS X live → "Software unlocked $1,049.93 / You paid $0.00" → Discord |

Then `GAIN=2.6 node assemble_short.js free_<name>`.

- The videos never state the condition. Both end on "Want it free? Find out how in our Discord." Don't add a flat "it's free" claim without that line.
- The live ATAS X chart is the site's footprint engine (`engines.js`) with taller candles.
- Discord reasons: the first message ("Here's how to get it free.") is new; the other two are the confirmed placeholders.

---

## 12. Fast TikTok-safe videos (render_fast.js): three 15 s videos

| Video | Command | Idea |
|---|---|---|
| `tradebay_fast_door.mp4` | `node render_fast.js door` | Price → icon ring → each app's icon floods the screen in its colour and becomes its live chart (match cuts, 0.94 s each) → chart grid → Discord |
| `tradebay_fast_shatter.mp4` | `node render_fast.js shatter` | $149.99 cracks and shatters into candles that become live ATAS X → push-ins → card flip to the other 6 → Discord (free pitch) |
| `tradebay_fast_domino.mp4` | `node render_fast.js domino` | Cards tip like dominoes with a tracking camera, each lighting up with its platform → blue ripple → Discord |

Then `GAIN=2.6 node assemble_short.js fast_<name>`.

**Rules built in**
- TikTok safe zone: text and buttons stay inside x 70–920, y 230–1400. Preview stills (`SMOKE=1`) tint the unsafe areas red.
- At most 6 things on screen at once, with one caption of 5 words or fewer. The Discord ending is 3 messages + button + caption.
- The shatter video never states the condition; it says "Want it free?" and the first Discord message says "Find out how to get it free."

---

## 13. 3D video (render_3d.js): "Inside the control room", 16 s

`node render_3d.js` then `GAIN=2.6 node assemble_short.js 3d` -> `out/tradebay_3d.mp4`.

- A small software 3D engine on the 2D canvas: camera (yaw/pitch/roll), perspective projection, textured quads drawn as clipped affine triangles (`quad3`), slab thickness on panels, a mirrored floor reflection, depth-cue dust, and extruded text/logo built from stacked depth layers (`extrude`).
- The camera sits in a ring of 7 live-chart panels and turns to each (1.1 s each), pushing in, with the others dimmed.
- Story: extruded $149.99 -> panels fly out and the camera spins -> tour -> panels collapse into a 3D logo + price -> Discord.
- Keep text inside the TikTok safe zone (x 70-920, y 230-1400); anything 3D must be sized for its distance (screen size = size x 1150 / distance).
