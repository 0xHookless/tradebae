// Trade Bay — "Colour chapters" style, three 15s videos (taste-skill direction: colour-chapters, seed 1159058888).
// Each part is one flat full-bleed colour that rises from the bottom with a hard edge. One typeface (Hanken
// Grotesk 500/400), sentence case, two sizes, one left edge. Square corners, no gradients, glows or shadows.
// The product shows up as itself: real app icons and the live chart engines, cropped square.
// Usage: node render_chapters.js <once|steps|pick>          -> out/tradebay_<name>_nosound.mp4 + out/timeline_<name>.json
//        SMOKE=1 node render_chapters.js <name>              -> QC stills qc/ch_<name>_*.png
//        then: node assemble_short.js <name>                 -> out/tradebay_<name>.mp4
const E = require('./engines.js');
const { W, H, APPS, clamp01, lerp, ico, loadIco, setIco, LOGOS, tile, createCanvas, GlobalFonts, FF } = E;
const { loadImage } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');

const NAME = process.argv[2];
const FPS = 60, SMOKE = !!process.env.SMOKE, PRICE = '$149.99';
mkdirSync('out', { recursive: true }); mkdirSync('qc', { recursive: true });

/* ---------- tokens (dealt palette + type) ---------- */
GlobalFonts.registerFromPath('fonts/HankenGrotesk-400.ttf', 'Hanken');
GlobalFonts.registerFromPath('fonts/HankenGrotesk-500.ttf', 'Hanken');
const K = {
  slate: '#a6b3bc', sage: '#b7c8be', blush: '#d6c4b8', olive: '#2c3620',
  ink: '#1c1c1c', muted: '#38424a', cream: '#e3e2da',
};
const STEP = { slate: '#97a5af', sage: '#a5b9ad', blush: '#c9b4a6', olive: '#3a4630' }; // one tone step darker, for filled surfaces
const HEAD = s => `500 ${s}px Hanken`, BODY = s => `400 ${s}px Hanken`;
const X = 80, MAXW = 920, HEAD_MAX = 160, CAP = 46; // one left edge, two text sizes

/* ---------- motion: critically damped springs, no overshoot (calm) ---------- */
function spr(t, [response, damping]) {
  if (t <= 0) return 0;
  const w0 = 2 * Math.PI / response;
  if (damping >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + (damping * w0 / wd) * Math.sin(wd * t));
}
const RISE = [0.75, 1], CALM = [0.5, 1], PRESS = [0.25, 1];
const ease = (t, a, b) => { const x = clamp01((t - a) / (b - a)); return x * x * (3 - 2 * x); };

/* ---------- text ---------- */
function setType(g, font, fill) { g.font = font; g.fillStyle = fill; g.textAlign = 'left'; g.textBaseline = 'middle'; g.letterSpacing = '0px'; }
function headSize(g, lines) { // largest size <= HEAD_MAX where every line fits the measure
  let s = HEAD_MAX; g.font = HEAD(s); g.letterSpacing = `${-0.05 * s}px`;
  for (const l of lines) { const w = g.measureText(l).width; if (w > MAXW) s = Math.min(s, Math.floor(HEAD_MAX * MAXW / w)); }
  return s;
}
// rise-in entrance: 28px travel + fade, line by line 80ms apart
function heading(g, lines, y, ink, k, size = null) {
  const s = size || headSize(g, lines), lh = s * 0.92;
  lines.forEach((l, i) => {
    const kk = k - i * 0.08; if (kk <= 0) return;
    g.save(); g.globalAlpha = clamp01(kk / 0.2); setType(g, HEAD(s), ink); g.letterSpacing = `${-0.05 * s}px`;
    g.fillText(l, X - 0.04 * s, y + i * lh + 28 * (1 - spr(kk, CALM))); g.restore();
  });
  return y + (lines.length - 1) * lh + s * 0.5; // bottom of the block
}
function caption(g, s, y, ink, k, x = X, size = CAP) {
  if (k <= 0) return;
  g.save(); g.globalAlpha = clamp01(k / 0.2); setType(g, BODY(size), ink);
  g.fillText(s, x, y + 20 * (1 - spr(k, CALM))); g.restore();
}

/* ---------- product pieces ---------- */
const EL = 680, DPR = 2, ENG = {};
for (const a of APPS) {
  const cv = createCanvas(EL * DPR, EL * DPR);
  const Maker = { footprint: E.Footprint, heatmap: E.Heatmap, candles: E.Candles, waves: E.Waves }[a.scene];
  const sc = new Maker({ seed: a.seed, sym: a.sym, hue: a.hue, dom: a.dom, variant: a.variant }, EL, EL);
  sc.ctx = cv.getContext('2d'); sc.w = EL; sc.h = EL;
  if (a.scene === 'footprint') { sc.per = 55; for (let k = 0; k < 55 * 5; k++) sc.step(); }
  ENG[a.id] = { cv, sc, last: -1 };
}
let FRAME = 0;
function chart(id) {
  const e = ENG[id];
  if (e.last !== FRAME) { e.sc.step(); e.sc.ctx.setTransform(DPR, 0, 0, DPR, 0, 0); e.sc.draw(); e.last = FRAME; }
  return e.cv;
}
const P = Object.fromEntries(APPS.map(a => [a.id, a]));
function appIcon(g, id, x, y, s) { const a = P[id]; tile(g, x, y, s, a.hue, a.letters, s * 0.3); }
function chartPanel(g, id, x, y, w, h, k) { // square crop of a live chart, rises in
  if (k <= 0) return;
  const src = EL * DPR, sh = src * Math.min(1, h / w);
  g.save(); g.globalAlpha = clamp01(k / 0.25); g.translate(0, 60 * (1 - spr(k, CALM)));
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.imageSmoothingQuality = 'high';
  g.drawImage(chart(id), 0, (src - sh) / 2, src, sh, x, y, w, h);
  g.restore();
}
function appRow(g, ids, y, ink, k) { // icons + names in one line, separated by space
  let x = X;
  ids.forEach((id, i) => {
    const kk = k - i * 0.08; if (kk <= 0) return;
    g.save(); g.globalAlpha = clamp01(kk / 0.2); g.translate(0, 20 * (1 - spr(kk, CALM)));
    appIcon(g, id, x, y - 36, 72); setType(g, BODY(CAP), ink); g.fillText(P[id].name, x + 96, y);
    g.restore();
    g.font = BODY(CAP); g.letterSpacing = '0px'; x += 96 + g.measureText(P[id].name).width + 64;
  });
}
function button(g, x, y, w, h, fill, ink, label, size, k, press = 1) {
  if (k <= 0) return;
  g.save(); g.globalAlpha = clamp01(k / 0.2); g.translate(x + w / 2, y + h / 2 + 24 * (1 - spr(k, CALM))); g.scale(press, press);
  g.fillStyle = fill; g.fillRect(-w / 2, -h / 2, w, h);
  setType(g, HEAD(size), ink); g.letterSpacing = `${-0.03 * size}px`; g.fillText(label, -w / 2 + size * 0.55, 2);
  g.restore();
}
function endCard(g, t, ink, lines, cap, btnFill, btnInk) {
  if (t > 0) { const s = spr(t, CALM); g.save(); g.globalAlpha = clamp01(t / 0.2); g.translate(0, 24 * (1 - s)); ico(g, X, 300, 170); g.restore(); }
  const b = heading(g, lines, 640, ink, t - 0.12);
  caption(g, cap, b + 70, ink, t - 0.3);
  button(g, X, 1240, 560, 150, btnFill, btnInk, 'Link in bio', 64, t - 0.45);
}

/* ---------- the three videos ---------- */
const VIDEOS = {
  once: [
    { bg: K.blush, dur: 3.0, sfx: [...Array(8)].map((_, i) => ['tick', 0.55 + i * 0.16]), draw: (g, t) => {
      const b = heading(g, ['Still renting', 'your charts?'], 330, K.ink, t);
      caption(g, 'Pro platforms usually bill every month.', b + 70, K.ink, t - 0.25);
      ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September'].forEach((m, i) => { // the bill that never ends, off the bottom edge
        const k = t - 0.55 - i * 0.16, y = 860 + i * 120;
        caption(g, m, y, K.ink, k, X, 56); caption(g, 'Renewed', y, K.muted, k, 760, 56);
      });
    } },
    { bg: K.blush, tr: 'seam', dur: 3.5, sfx: [['boom', 0.35]], draw: (g, t) => { // olive rises to half; headline changes ink at the seam
      const seam = H - (H / 2) * spr(t, RISE);
      g.fillStyle = K.olive; g.fillRect(0, seam, W, H - seam + 200);
      const s = 200, lh = s * 0.92, y2 = H / 2 + 0.12 * s, y1 = y2 - lh;
      for (const [above, ink] of [[true, K.olive], [false, K.cream]]) {
        g.save(); g.beginPath(); above ? g.rect(0, -200, W, seam + 200) : g.rect(0, seam, W, H - seam + 200); g.clip();
        heading(g, ['Pay once.', 'Keep it.'], y1, ink, t - 0.25, s); g.restore();
      }
      caption(g, 'A lifetime licence for each platform.', 1440, K.cream, t - 0.9);
    } },
    { bg: K.sage, dur: 3.5, sfx: [['whoosh', 0], ...APPS.map((_, i) => ['tick', 0.55 + i * 0.12])], draw: (g, t) => {
      heading(g, ['Seven', 'platforms.'], 330, K.ink, t - 0.2);
      ['atas', 'ax', 'bm', 'mw', 'dc', 'sc', 'jig'].forEach((id, i) => {
        const k = t - 0.55 - i * 0.12, y = 720 + i * 118; if (k <= 0) return;
        g.save(); g.globalAlpha = clamp01(k / 0.2); g.translate(0, 20 * (1 - spr(k, CALM)));
        appIcon(g, id, X, y - 44, 88); setType(g, BODY(56), K.ink); g.fillText(P[id].name, X + 120, y); g.restore();
      });
    } },
    { bg: K.slate, dur: 3.0, sfx: [['whoosh', 0], ['pop', 0.6]], draw: (g, t) => {
      heading(g, ['One price.'], 330, K.ink, t - 0.2);
      const k = t - 0.45; if (k <= 0) return;
      const x = X, y = 500, w = MAXW, mainH = 400, stubH = 400; // upright ticket: main part, perforation, stub
      g.save(); g.globalAlpha = clamp01(k / 0.2); g.translate(0, 60 * (1 - spr(k, CALM)));
      g.fillStyle = K.cream; g.fillRect(x, y, w, mainH + stubH);
      g.fillStyle = K.slate;
      for (const cx of [x, x + w]) { g.beginPath(); g.arc(cx, y + mainH, 28, 0, 7); g.fill(); }
      for (let dx = x + 60; dx < x + w - 40; dx += 26) { g.beginPath(); g.arc(dx, y + mainH, 5, 0, 7); g.fill(); }
      setType(g, HEAD(96), K.ink); g.letterSpacing = '-4.8px'; g.fillText('Any platform', x + 56, y + 110);
      setType(g, BODY(42), K.ink); g.fillText('Lifetime licence', x + 56, y + 280); g.fillText('Kept current by the launcher', x + 56, y + 336);
      setType(g, HEAD(176), K.ink); g.letterSpacing = '-8.8px'; g.textAlign = 'center'; g.fillText(PRICE, x + w / 2, y + mainH + 150);
      g.fillStyle = K.olive; g.fillRect(x + 56, y + mainH + 270, w - 112, 90);
      setType(g, HEAD(44), K.cream); g.textAlign = 'center'; g.fillText('One time. No renewal.', x + w / 2, y + mainH + 316);
      g.restore();
    } },
    { bg: K.olive, dur: 2.0, sfx: [['whoosh', 0], ['chime', 0.4]], draw: (g, t) =>
      endCard(g, t - 0.2, K.cream, ['Trade Bay.'], `7 platforms, ${PRICE} each.`, K.cream, K.olive) },
  ],
  steps: [
    { bg: K.blush, dur: 3.0, sfx: [['pop', 1.6], ['notif', 1.75]], draw: (g, t) => {
      const b = heading(g, ['Buy once.'], 330, K.ink, t);
      caption(g, 'Your licence key arrives by email.', b + 70, K.ink, t - 0.25);
      const paid = t >= 1.7, press = 1 - 0.04 * Math.sin(Math.PI * clamp01((t - 1.6) / 0.2));
      button(g, X, 720, 1260, 400, paid ? K.olive : K.ink, K.cream, paid ? `Paid ${PRICE}` : 'Add to cart', 130, t - 0.45, press);
    } },
    { bg: K.sage, dur: 3.0, sfx: [['whoosh', 0], ['tick', 2.25], ['pop', 2.3]], draw: (g, t) => {
      const b = heading(g, ['Install the', 'launcher.'], 330, K.ink, t - 0.2);
      caption(g, 'One small Windows installer.', b + 70, K.ink, t - 0.45);
      const p = ease(t, 0.8, 2.25), k = t - 0.6;
      caption(g, `${Math.round(p * 100)}%`, 760, K.ink, k, X, 150);
      if (k > 0) {
        g.save(); g.globalAlpha = clamp01(k / 0.2); g.translate(0, 24 * (1 - spr(k, CALM)));
        g.fillStyle = STEP.sage; g.fillRect(X, 900, 1400, 240);
        g.fillStyle = p >= 1 ? K.olive : K.ink; g.fillRect(X, 900, 1400 * p, 240); g.restore();
      }
    } },
    { bg: K.slate, dur: 3.0, sfx: [['whoosh', 0], ...[...'TB-7F3K-Q9LM'].map((_, i) => ['tick', 0.75 + i * 0.09])], draw: (g, t) => {
      const b = heading(g, ['Paste', 'your key.'], 330, K.ink, t - 0.2);
      caption(g, 'The platforms you bought unlock.', b + 70, K.ink, t - 0.45);
      const k = t - 0.55; if (k <= 0) return;
      const key = 'TB-7F3K-Q9LM', n = Math.max(0, Math.min(key.length, Math.floor((t - 0.75) / 0.09) + 1));
      g.save(); g.globalAlpha = clamp01(k / 0.2); g.translate(0, 24 * (1 - spr(k, CALM)));
      g.fillStyle = K.cream; g.fillRect(X, 740, 1400, 300);
      setType(g, HEAD(130), K.ink); g.letterSpacing = '-3px'; const typed = t > 0.75 ? key.slice(0, n) : '';
      g.fillText(typed, X + 70, 892); const cw = g.measureText(typed).width;
      if (Math.floor(t * 2.5) % 2 === 0 || n < key.length) { g.fillStyle = K.olive; g.fillRect(X + 80 + cw, 820, 10, 144); }
      g.restore();
    } },
    { bg: K.olive, dur: 3.5, sfx: [['whoosh', 0], ['pop', 1.2], ['whoosh', 1.3]], draw: (g, t) => {
      heading(g, ['Launch.'], 330, K.cream, t - 0.2);
      const press = 1 - 0.06 * Math.sin(Math.PI * clamp01((t - 1.15) / 0.2));
      button(g, X, 470, 520, 200, K.cream, K.olive, 'Run', 110, t - 0.45, press);
      chartPanel(g, 'bm', X, 760, MAXW, 800, t - 1.3);
    } },
    { bg: K.blush, dur: 2.5, sfx: [['whoosh', 0], ['chime', 0.4]], draw: (g, t) =>
      endCard(g, t - 0.2, K.ink, ['Trade Bay.'], `7 platforms, ${PRICE} each.`, K.olive, K.cream) },
  ],
  pick: [
    { bg: K.slate, dur: 2.0, sfx: [], draw: (g, t) => {
      const b = heading(g, ['Pick your', 'platform.'], 330, K.ink, t);
      caption(g, 'Seven pro platforms. One licence each.', b + 70, K.ink, t - 0.25);
    } },
    ...[['Order flow.', ['atas', 'ax'], 'atas', K.blush], ['Liquidity.', ['bm', 'jig'], 'bm', K.sage],
      ['Speed and code.', ['sc', 'dc'], 'sc', K.slate], ['Waves and Fib.', ['mw'], 'mw', K.blush]]
      .map(([h, ids, chartId, bg]) => ({ bg, dur: 2.75, sfx: [['whoosh', 0], ['pop', 0.5]], draw: (g, t) => {
        heading(g, [h], 330, K.ink, t - 0.2);
        appRow(g, ids, 500, K.ink, t - 0.4);
        chartPanel(g, chartId, X, 620, MAXW, 920, t - 0.55);
      } })),
    { bg: K.olive, dur: 2.0, sfx: [['whoosh', 0], ['chime', 0.4]], draw: (g, t) =>
      endCard(g, t - 0.2, K.cream, [`${PRICE} each,`, 'paid once.'], 'Trade Bay. 7 pro trading platforms.', K.cream, K.olive) },
  ],
};
const CH = VIDEOS[NAME];
if (!CH) { console.error('usage: node render_chapters.js <once|steps|pick>'); process.exit(1); }
const starts = []; let DUR = 0; for (const c of CH) { starts.push(DUR); DUR += c.dur; }
const FRAMES = Math.round(DUR * FPS);

/* ---------- compositor: next colour rises from the bottom with a hard edge ---------- */
// content drifts up 36px across its chapter (eased) so no frame ever sits completely still
function drawC(g, c, lt) { g.save(); g.translate(0, -36 * ease(lt, 0, c.dur + 0.9)); c.draw(g, lt); g.restore(); }
function drawWorld(g, T) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  let i = 0; while (i < CH.length - 1 && T >= starts[i + 1]) i++;
  const c = CH[i], lt = T - starts[i];
  if (i > 0 && lt < 0.9) {
    const p = CH[i - 1];
    g.fillStyle = p.bg; g.fillRect(0, 0, W, H);
    if (c.tr === 'seam') { // previous words lift away; the chapter draws its own half field
      const a = 1 - ease(lt, 0, 0.3);
      if (a > 0) { g.save(); g.globalAlpha = a; g.translate(0, -50 * (1 - a)); drawC(g, p, p.dur + lt); g.restore(); }
      drawC(g, c, lt); return;
    }
    drawC(g, p, p.dur + lt);
    const edge = H * (1 - spr(lt, RISE));
    g.save(); g.translate(0, edge); g.beginPath(); g.rect(0, 0, W, H); g.clip();
    g.fillStyle = c.bg; g.fillRect(0, 0, W, H); drawC(g, c, lt); g.restore();
    return;
  }
  g.fillStyle = c.bg; g.fillRect(0, 0, W, H);
  drawC(g, c, lt);
}

/* ---------- frame: 5-sample motion blur ---------- */
const N = 5, SHUT = 1 / 120;
const out = createCanvas(W, H), o = out.getContext('2d');
const TMP = createCanvas(W, H), tg = TMP.getContext('2d');
function renderFrame(f) {
  FRAME = f;
  for (let k = 0; k < N; k++) { drawWorld(tg, Math.max(0, f / FPS - SHUT * k / (N - 1))); o.globalAlpha = 1 / (k + 1); o.drawImage(TMP, 0, 0); }
  o.globalAlpha = 1;
}

const events = [];
CH.forEach((c, i) => c.sfx.forEach(([n, a]) => events.push([n, +(starts[i] + a).toFixed(3)])));
writeFileSync(`out/timeline_${NAME}.json`, JSON.stringify({ dur: DUR, events }, null, 1));

(async () => {
  setIco(await loadIco());
  for (const a of APPS) LOGOS[a.letters] = await loadImage(`icons/${a.id}.png`);
  console.log(`${NAME}: ${CH.length} chapters, ${DUR}s, ${FRAMES} frames, ${events.length} sfx`);
  if (SMOKE) {
    const want = new Set(); starts.forEach((s, i) => { want.add(Math.round((s + 0.35) * FPS)); want.add(Math.round((s + CH[i].dur - 0.1) * FPS)); });
    for (const f of [...want].sort((a, b) => a - b)) {
      renderFrame(f); writeFileSync(`qc/ch_${NAME}_${String(f).padStart(4, '0')}.png`, out.toBuffer('image/png'));
    }
    console.log('SMOKE done', want.size, 'stills'); return;
  }
  const ff = spawn(FF, ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', `out/tradebay_${NAME}_nosound.mp4`],
  { stdio: ['pipe', 'inherit', 'pipe'] });
  let tail = ''; ff.stderr.on('data', d => { tail = (tail + d).slice(-3000); });
  const done = new Promise(res => ff.on('exit', res));
  for (let f = 0; f < FRAMES; f++) {
    renderFrame(f);
    const px = o.getImageData(0, 0, W, H).data;
    if (!ff.stdin.write(Buffer.from(px.buffer, px.byteOffset, px.byteLength))) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  const code = await done;
  if (code === 0) console.log('VIDEO RENDER OK'); else { console.error('ffmpeg exit', code, tail); process.exit(1); }
})();
