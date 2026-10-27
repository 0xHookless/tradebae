// Trade Bay — 25s TikTok motion-graphics renderer (data-terminal style)
// Brand tokens, icons and per-platform canvas scenes taken from
// C:\TradingPlatform\site (index.html/app.js/styles.css) and installer/tradebay.ico
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('fs');

const W = 1080, H = 1920, FPS = 60, DUR = 25.0;
const FRAMES = Math.round(DUR * FPS);
const SMOKE = !!process.env.SMOKE;
const FF = process.env.FFMPEG || 'C:\\Users\\hawdi\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe';
mkdirSync('out', { recursive: true });
mkdirSync('qc', { recursive: true });

/* ================= data-terminal tokens (site/app.html) ================= */
const C = {
  ground: '#0e0e11', chrome: '#121215', surface: '#19191e', raised: '#25252b',
  hover: '#1e1e24', border: '#2d2d35', rule: '#232329', control: '#45454e',
  text: '#ffffff', soft: '#cacbd0', muted: '#9c9ea6',
  accent: '#4a8ad6', accentInk: '#7fb0ea',
  positive: '#44a282', posInk: '#5fc39c', negative: '#e5566f', warning: '#d9a441',
  pillPosBg: '#15302a', pillAccBg: '#172840',
  heat1: '#10233f', heat2: '#1d4f8e',
  hue: { sc: '#46c2d8', atas: '#9a7cf0', bm: '#e3a948', mw: '#ef8466', ax: '#d46fd0', dc: '#7fb0ea', jig: '#5fc39c' }
};

/* ================= easing ================= */
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const outExpo = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
const outCubic = t => 1 - Math.pow(1 - t, 3);
const inOutQuint = t => t < .5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
const inOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
const spring = (t, a = 6.5, w = 11) =>
  t <= 0 ? 0 : 1 - Math.exp(-a * t) * (Math.cos(w * t) + (a / w) * Math.sin(w * t));
const shake = t => t < 0 ? 0 : Math.exp(-9 * t) * Math.sin(55 * t);
const rnd = seed => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ================= fonts ================= */
function famOr(list) {
  const probe = createCanvas(10, 10).getContext('2d');
  for (const f of list) { probe.font = `100px ${f}`; if (probe.measureText('M').width > 1) return f; }
  return 'sans-serif';
}
const BODY_F = famOr(['"Public Sans"', '"Segoe UI"', 'Arial']);
const MONO_F = famOr(['"JetBrains Mono"', '"Cascadia Mono"', 'Consolas', '"Courier New"']);
const F_TITLE = s => `600 ${s}px ${BODY_F}, sans-serif`;
const F_MED = s => `500 ${s}px ${BODY_F}, sans-serif`;
const F_BODY = s => `400 ${s}px ${BODY_F}, sans-serif`;
const MONO = (s, w = 400) => `${w} ${s}px ${MONO_F}, monospace`;

/* ================= platform catalogue ================= */
const APPS = [
  { id: 'atas', name: 'ATAS', letters: 'AT', hue: C.hue.atas, sym: 'NQZ6', scene: 'footprint', seed: 23, view: 'Footprint \u00b7 bid \u00d7 ask at every price', m: '$80' },
  { id: 'ax', name: 'ATAS X', letters: 'AX', hue: C.hue.ax, sym: 'NQZ6', scene: 'footprint', variant: 'x', seed: 59, view: 'GPU footprint \u00b7 session profile', m: '$120' },
  { id: 'bm', name: 'Bookmap', letters: 'BM', hue: C.hue.bm, sym: 'ESZ6', scene: 'heatmap', seed: 5, view: 'Liquidity heatmap \u00b7 volume dots', m: '$79' },
  { id: 'mw', name: 'MotiveWave', letters: 'MW', hue: C.hue.mw, sym: 'CLZ6', scene: 'waves', seed: 41, view: 'Elliott waves \u00b7 Fibonacci', m: '$94' },
  { id: 'dc', name: 'DeepCharts', letters: 'DC', hue: C.hue.dc, sym: 'ESZ6', scene: 'candles', seed: 77, view: 'Historical depth \u00b7 analytics', m: '$99' },
  { id: 'sc', name: 'Sierra Chart', letters: 'SC', hue: C.hue.sc, sym: 'ESZ6', scene: 'candles', seed: 11, view: 'Candles \u00b7 SMA 20 \u00b7 trading DOM', m: '$36' },
  { id: 'jig', name: 'Jigsaw', letters: 'JG', hue: C.hue.jig, sym: 'ESZ6', scene: 'heatmap', dom: true, seed: 13, view: 'Depth \u00b7 ladder trading', m: '$119' }
];
const MO_TOTAL = APPS.reduce((s, a) => s + parseInt(a.m.slice(1)), 0); // 627

function hexRgb(h) { h = h.replace('#', ''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mixHex(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
function rgba(hex, a) { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function hexM(a, b, t) { return mixHex(a, b, t); }

/* ================= Trade Bay .ico ================= */
let ICO_IMG = null;
function loadIco() {
  const buf = readFileSync('C:\\TradingPlatform\\installer\\tradebay.ico');
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = buf.readUInt32LE(e + 8), off = buf.readUInt32LE(e + 12);
    if (!best || size > best.size) best = { size, off };
  }
  ICO_IMG = loadImage(buf.subarray(best.off, best.off + best.size));
  return ICO_IMG;
}
function ico(ctx, x, y, s, glow = 0) {
  ctx.save();
  if (glow > 0) { ctx.shadowColor = 'rgba(74,138,214,0.45)'; ctx.shadowBlur = glow; }
  ctx.drawImage(ICO_IMG, x, y, s, s);
  ctx.restore();
}

/* ================= primitives ================= */
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function cam(ctx, { z = 1, x = 0, y = 0, r = 0 } = {}) {
  ctx.translate(W / 2 + x, H / 2 + y);
  if (r) ctx.rotate(r);
  ctx.scale(z, z);
  ctx.translate(-W / 2, -H / 2);
}
function txt(ctx, s, x, y, f, fill, align = 'center', base = 'middle') {
  ctx.font = f; ctx.fillStyle = fill; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillText(s, x, y);
}
function caption(ctx, s, a, y = 1560, size = 48, fill = C.soft) {
  if (a <= 0.01) return;
  ctx.save(); ctx.globalAlpha = a;
  ctx.translate(0, (1 - a) * 36);
  ctx.font = F_MED(size); ctx.fillStyle = fill;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 10;
  ctx.fillText(s, W / 2, y);
  ctx.restore();
}
function flash(ctx, a) { if (a > 0.01) { ctx.save(); ctx.globalAlpha = Math.min(1, a); ctx.fillStyle = '#fff'; ctx.fillRect(-60, -60, W + 120, H + 120); ctx.restore(); } }
function scopeMark(ctx, cx, cy, col) { // small green status dot
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.fillStyle = col; ctx.fill();
}
/* hue tile: color-mix(hue 16%, raised) like the site */
function tile(ctx, x, y, s, hue, letters, fs) {
  rr(ctx, x, y, s, s, 4);
  ctx.fillStyle = mixHex(hue, C.raised, 1 - 0.16); ctx.fill();
  txt(ctx, letters, x + s / 2, y + s / 2 + 1, MONO(fs, 500), hue);
}

/* ================= backdrop: dotted grid like the site footer ================= */
const backdropCanvas = (() => {
  const c = createCanvas(W + 40, H + 40), g0 = c.getContext('2d');
  g0.fillStyle = C.ground; g0.fillRect(0, 0, W + 40, H + 40);
  g0.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 9; y < H + 40; y += 18) for (let x = 9 + (y / 18 % 2) * 0; x < W + 40; x += 18) g0.fillRect(x, y, 1.4, 1.4);
  const v = g0.createRadialGradient(W / 2 + 20, H / 2, H * .26, W / 2 + 20, H / 2, H * .72);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g0.fillStyle = v; g0.fillRect(0, 0, W + 40, H + 40);
  return c;
})();
function backdrop(ctx, t) {
  const dx = (t * 22) % 18;
  ctx.drawImage(backdropCanvas, -18 - dx, -20);
}

/* =====================================================================
   PORTED: market simulation + scenes from C:\TradingPlatform\site\app.js
   ===================================================================== */
const SYMBOLS = { ESZ6: { start: 5872.25, tick: 0.25 }, NQZ6: { start: 20714.5, tick: 0.25 }, CLZ6: { start: 71.42, tick: 0.01 } };
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(i) { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
const posBar = rgba(C.positive, 0.32), negBar = rgba(C.negative, 0.32);
const posDot = rgba(C.positive, 0.85), negDot = rgba(C.negative, 0.85);
const gridLine = rgba(C.text, 0.05), profilePat = rgba(C.soft, 0.18);

class Market {
  constructor(seed, sym, lot = 1) {
    const s = SYMBOLS[sym];
    this.r = rng(seed); this.tick = s.tick; this.lot = lot;
    this.mid = Math.round(s.start / s.tick); this.start = this.mid;
    this.vel = 0; this.depth = 60; this.liq = new Map();
  }
  base(i) {
    const d = Math.abs(i - this.mid), h = hash(i);
    let b = 18 + h * 34;
    if (h > 0.92) b += 1700 * (h - 0.92);
    if (i % 20 === 0) b += 230; else if (i % 10 === 0) b += 90;
    return b * Math.min(1, 0.22 + d / 7);
  }
  step() {
    const r = this.r;
    this.vel = this.vel * 0.93 + (r() - 0.5) * 0.45 + (this.start - this.mid) * 0.0012;
    let move = 0;
    if (r() < 0.36) move = r() < 0.5 + Math.max(-0.4, Math.min(0.4, this.vel)) ? 1 : -1;
    this.mid += move;
    for (let i = this.mid - this.depth; i <= this.mid + this.depth; i++) {
      const tgt = this.base(i), cur = this.liq.has(i) ? this.liq.get(i) : tgt;
      let v = cur + (tgt - cur) * 0.06 + (r() - 0.5) * tgt * 0.2;
      if (Math.abs(i - this.mid) <= 1) v *= 0.75;
      this.liq.set(i, Math.max(0, v));
    }
    if (this.liq.size > this.depth * 6) for (const k of this.liq.keys()) if (Math.abs(k - this.mid) > this.depth * 2) this.liq.delete(k);
    const trades = [], n = Math.floor(r() * r() * 6) + (move ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const buy = r() < 0.5 + Math.max(-0.3, Math.min(0.3, this.vel));
      trades.push({ i: this.mid, buy, size: Math.max(1, Math.round(Math.exp(r() * r() * 4.2) * this.lot)) });
    }
    return trades;
  }
  fmt(i) { return (i * this.tick).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
}
function mfont(ctx, px, w = 400) { ctx.font = `${w} ${px}px ${MONO_F}, monospace`; }
function priceTag(ctx, x, y, w, text) {
  ctx.fillStyle = C.text; ctx.fillRect(x, y - 9, w, 18);
  ctx.fillStyle = C.ground; mfont(ctx, 10, 500); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y + 0.5);
}
function rowAxis(ctx, x, w, h, top, rows, rowH, y0, m) {
  ctx.fillStyle = C.ground; ctx.fillRect(x, 0, w, h);
  ctx.fillStyle = C.rule; ctx.fillRect(x, 0, 1, h);
  const every = Math.max(1, Math.ceil(26 / rowH));
  mfont(ctx, 10); ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r++) { const i = top - r; if (i % every === 0) ctx.fillText(m.fmt(i), x + 8, y0 + r * rowH + rowH / 2); }
  const yMid = y0 + (top - m.mid) * rowH + rowH / 2;
  priceTag(ctx, x + 1, yMid, w - 1, m.fmt(m.mid));
}
function drawDom(ctx, x0, w, h, m, grid) {
  const { rowH } = grid;
  const rows = grid.rows ?? Math.floor(h / rowH);
  const top = grid.top ?? m.mid + Math.floor(rows / 2);
  const y0 = grid.y0 ?? (h - rows * rowH) / 2;
  ctx.fillStyle = C.chrome; ctx.fillRect(x0, 0, w, h);
  ctx.fillStyle = C.rule; ctx.fillRect(x0, 0, 1, h);
  let max = 1;
  for (let r = 0; r < rows; r++) max = Math.max(max, m.liq.get(top - r) || 0);
  const priceW = grid.price ? 62 : 0, barX = x0 + priceW + 6, barW = w - priceW - 12;
  const text = rowH >= 12;
  mfont(ctx, 10); ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r++) {
    const i = top - r, y = y0 + r * rowH, size = m.liq.get(i) || 0;
    if (i === m.mid) { ctx.fillStyle = C.raised; ctx.fillRect(x0 + 1, y, w - 1, rowH); }
    else { ctx.fillStyle = i < m.mid ? posBar : negBar; ctx.fillRect(barX, y + 1.5, Math.max(1, size / max * barW), rowH - 3); }
    if (!text) continue;
    if (grid.price) { ctx.fillStyle = i === m.mid ? C.text : C.muted; ctx.textAlign = 'left'; ctx.fillText(m.fmt(i), x0 + 8, y + rowH / 2); }
    if (i !== m.mid) { ctx.fillStyle = C.soft; ctx.textAlign = 'right'; ctx.fillText(String(Math.round(size)), x0 + w - 8, y + rowH / 2); }
  }
}
const lutCache = new Map();
function makeLut(hue = C.accent) {
  if (lutCache.has(hue)) return lutCache.get(hue);
  const stops = [C.ground, C.heat1, mixHex(C.heat2, hue, 0.45), hue, mixHex(hue, '#ffffff', 0.72)].map(hexRgb);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f;
  }
  lutCache.set(hue, lut); return lut;
}
const lutColor = (lut, v) => { const i = ((Math.max(0, Math.min(1, v)) * 255) | 0) * 3; return `rgb(${lut[i]},${lut[i + 1]},${lut[i + 2]})`; };

class Heatmap {
  constructor(o, w, h) {
    this.o = o; this.hue = o.hue; this.lut = makeLut(o.hue);
    this.m = new Market(o.seed, o.sym); this.cols = []; this.maxCols = 260;
    this.off = createCanvas(1, 1); this.offCtx = this.off.getContext('2d');
    this.center = this.m.mid; this.reveal = 1;
    for (let k = 0; k < this.maxCols; k++) this.step();
    this.resize(w, h);
  }
  resize(w, h) { this.w = w; this.h = h; }
  step() {
    const tr = this.m.step(), n = this.m.depth * 2 + 1, low = this.m.mid - this.m.depth, data = new Float32Array(n);
    for (let k = 0; k < n; k++) data[k] = this.m.liq.get(low + k) || 0;
    let buy = 0, sell = 0; for (const t of tr) t.buy ? buy += t.size : sell += t.size;
    this.cols.push({ low, data, mid: this.m.mid, buy, sell });
    if (this.cols.length > this.maxCols) this.cols.shift();
  }
  tick() { this.step(); this.draw(); }
  draw() {
    const { ctx, w, h, m } = this.g();
    ctx.fillStyle = C.ground; ctx.fillRect(0, 0, w, h);
    const axisW = 66, domW = this.o.dom && w > 560 ? Math.min(140, w * 0.2) : 0;
    const plotW = w - axisW - domW;
    const rowH = Math.max(8, Math.min(14, h / 36)), rows = Math.ceil(h / rowH) + 1;
    const margin = Math.floor(rows * 0.25), off = m.mid - this.center;
    if (Math.abs(off) > rows / 2 - margin) this.center += Math.round(off - Math.sign(off) * (rows / 2 - margin));
    const top = Math.round(this.center) + Math.floor(rows / 2), y0 = (h - rows * rowH) / 2;
    const yOf = i => y0 + (top - i) * rowH + rowH / 2;
    const nCols = Math.max(2, Math.min(this.cols.length, Math.floor(plotW / 3.2)));
    const colW = plotW / nCols, start = this.cols.length - nCols;
    if (this.off.width !== nCols || this.off.height !== rows) { this.off = createCanvas(nCols, rows); this.offCtx = this.off.getContext('2d'); this.img = this.offCtx.createImageData(nCols, rows); }
    const px = this.img.data, lut = this.lut;
    for (let c = 0; c < nCols; c++) {
      const col = this.cols[start + c];
      for (let r = 0; r < rows; r++) {
        const k = top - r - col.low;
        let v = k >= 0 && k < col.data.length ? col.data[k] / 220 : 0;
        v = v >= 1 ? 1 : Math.pow(v, 0.8);
        const li = ((v * 255) | 0) * 3, p = (r * nCols + c) * 4;
        px[p] = lut[li]; px[p + 1] = lut[li + 1]; px[p + 2] = lut[li + 2]; px[p + 3] = 255;
      }
    }
    this.offCtx.putImageData(this.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.off, 0, 0, nCols, rows, -colW / 2, y0, plotW + colW, rows * rowH);
    ctx.beginPath();
    for (let c = 0; c < nCols; c++) { const x = c * colW + colW / 2, y = yOf(this.cols[start + c].mid); c ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = C.text; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = C.ground;
    for (let c = 0; c < nCols; c++) {
      const col = this.cols[start + c], vol = col.buy + col.sell;
      if (!vol) continue;
      const rad = Math.min(rowH * 1.8, 1.8 + Math.sqrt(vol) * 1.15);
      ctx.beginPath(); ctx.arc(c * colW + colW / 2, yOf(col.mid), rad, 0, Math.PI * 2);
      ctx.fillStyle = col.buy >= col.sell ? posDot : negDot; ctx.fill(); ctx.stroke();
    }
    rowAxis(ctx, plotW, axisW, h, top, rows, rowH, y0, m);
    if (domW) drawDom(ctx, plotW + axisW, domW, h, m, { rowH, rows, top, y0 });
  }
  g() { return this; }
}
// heatmap/candles/footprint draw against a bound context — bind via closure wrapper below
function bindScene(scene, cv) { const ctx = cv.getContext('2d'); scene.ctx = ctx; scene.w = cv.width; scene.h = cv.height; return scene; }

class Footprint {
  constructor(o, w, h) {
    this.x = o.variant === 'x'; this.hue = o.hue; this.lut = makeLut(o.hue);
    this.m = new Market(o.seed, o.sym, 3); this.candles = []; this.per = this.x ? 34 : 30; this.n = 0;
    this.profile = new Map(); this.center = this.m.mid; this.newCandle();
    for (let k = 0; k < this.per * 9 + 12; k++) this.step();
    this.resize(w, h);
  }
  resize(w, h) { this.w = w; this.h = h; }
  newCandle() { const p = this.m.mid; this.candles.push({ o: p, h: p, l: p, c: p, cells: new Map(), delta: 0, vol: 0 }); if (this.candles.length > 14) this.candles.shift(); }
  step() { /* verbatim from site */ }
  tick() { this.step(); this.draw(); }
  draw() { this.drawImpl(this.ctx, this.w, this.h); }
  drawImpl(ctx, w, h) {
    const m = this.m, small = w < 560;
    ctx.fillStyle = C.ground; ctx.fillRect(0, 0, w, h);
    const axisW = 66, profW = this.x && !small ? 96 : 0, deltaH = 44;
    const plotW = w - axisW - profW, plotH = h - deltaH;
    const rowH = small ? 16 : 19, rows = Math.floor(plotH / rowH);
    const margin = Math.floor(rows * 0.28), off = m.mid - this.center;
    if (Math.abs(off) > rows / 2 - margin) this.center = Math.round(this.center + off - Math.sign(off) * (rows / 2 - margin));
    const top = this.center + Math.floor(rows / 2), y0 = (plotH - rows * rowH) / 2;
    const yOf = i => y0 + (top - i) * rowH;
    ctx.fillStyle = gridLine;
    for (let r = 0; r <= rows; r++) if ((top - r) % 4 === 0) ctx.fillRect(0, y0 + r * rowH, plotW, 1);
    const colW = small ? 92 : this.x ? 112 : 124;
    const n = Math.min(this.candles.length, Math.max(1, Math.floor(plotW / colW)));
    const vis = this.candles.slice(-n), x0 = plotW - n * colW;
    let maxCell = 1; for (const cd of vis) for (const c of cd.cells.values()) maxCell = Math.max(maxCell, c.a + c.b);
    const fs = small ? 9.5 : 10.5;
    vis.forEach((cd, k) => {
      const x = x0 + k * colW;
      const up = cd.c >= cd.o, col = up ? C.positive : C.negative;
      ctx.fillStyle = col;
      ctx.fillRect(x + 7, yOf(cd.h), 1, yOf(cd.l) - yOf(cd.h) + rowH);
      ctx.fillRect(x + 5, yOf(Math.max(cd.o, cd.c)), 5, Math.abs(cd.c - cd.o) * rowH + rowH);
      const cx = x + 15, cw = colW - 22, mid = cx + cw / 2;
      let poc = null, pocV = 0;
      for (const [i, c] of cd.cells) {
        const y = yOf(i); if (y < -rowH || y > plotH) continue;
        const tot = c.a + c.b; if (tot > pocV) { pocV = tot; poc = i; }
        ctx.fillStyle = lutColor(this.lut, 0.12 + 0.46 * tot / maxCell); ctx.fillRect(cx, y + 1, cw, rowH - 2);
        mfont(ctx, fs); ctx.textBaseline = 'middle';
        const bidHeavy = c.b > c.a * 2.5 && c.b > 6, askHeavy = c.a > c.b * 2.5 && c.a > 6;
        ctx.textAlign = 'right'; ctx.fillStyle = bidHeavy ? C.negative : C.soft; ctx.fillText(c.b, mid - 6, y + rowH / 2 + 0.5);
        ctx.textAlign = 'center'; ctx.fillStyle = C.muted; ctx.fillText('\u00d7', mid, y + rowH / 2 + 0.5);
        ctx.textAlign = 'left'; ctx.fillStyle = askHeavy ? C.positive : C.soft; ctx.fillText(c.a, mid + 6, y + rowH / 2 + 0.5);
      }
      if (poc !== null) { ctx.strokeStyle = C.text; ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, yOf(poc) + 1.5, cw - 1, rowH - 3); }
      mfont(ctx, 10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = cd.delta >= 0 ? C.positive : C.negative;
      ctx.fillText(`\u0394 ${cd.delta > 0 ? '+' : ''}${cd.delta}`, mid, plotH + 15);
      ctx.fillStyle = C.muted; ctx.fillText(`Vol ${cd.vol}`, mid, plotH + 31);
    });
    ctx.fillStyle = C.rule; ctx.fillRect(0, plotH, plotW + profW, 1);
    if (profW) {
      const px = plotW; let maxP = 1, pocI = null;
      for (let r = 0; r < rows; r++) { const v = this.profile.get(top - r) || 0; if (v > maxP) { maxP = v; pocI = top - r; } }
      ctx.fillStyle = C.chrome; ctx.fillRect(px, 0, profW, h);
      for (let r = 0; r < rows; r++) {
        const i = top - r, v = this.profile.get(i) || 0; if (!v) continue;
        ctx.fillStyle = i === pocI ? this.hue : profilePat;
        ctx.fillRect(px + 6, y0 + r * rowH + 2, (profW - 14) * v / maxP, rowH - 4);
      }
      mfont(ctx, 10); ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.fillText('Session', px + 6, plotH + 15);
    }
    rowAxis(ctx, plotW + profW, axisW, h, top, rows, rowH, y0, m);
  }
}
Object.defineProperty(Footprint.prototype, 'step', {
  value: function () {
    const tr = this.m.step(), cd = this.candles[this.candles.length - 1], p = this.m.mid;
    cd.h = Math.max(cd.h, p); cd.l = Math.min(cd.l, p); cd.c = p;
    for (const t of tr) {
      let cell = cd.cells.get(t.i); if (!cell) cd.cells.set(t.i, cell = { b: 0, a: 0 });
      if (t.buy) { cell.a += t.size; cd.delta += t.size; } else { cell.b += t.size; cd.delta -= t.size; }
      cd.vol += t.size; this.profile.set(t.i, (this.profile.get(t.i) || 0) + t.size);
    }
    if (++this.n % this.per === 0) this.newCandle();
  }
});

class Candles {
  constructor(o, w, h) {
    this.hue = o.hue; this.m = new Market(o.seed, o.sym); this.per = 7; this.n = 0; this.candles = []; this.newCandle();
    for (let k = 0; k < this.per * 130; k++) this.step();
    this.resize(w, h);
  }
  resize(w, h) { this.w = w; this.h = h; }
  newCandle() { const p = this.m.mid; this.candles.push({ o: p, h: p, l: p, c: p, v: 0 }); if (this.candles.length > 200) this.candles.shift(); }
  step() { /* verbatim */ }
  tick() { this.step(); this.draw(); }
  draw() { this.drawImpl(this.ctx, this.w, this.h); }
  drawImpl(ctx, w, h) {
    const m = this.m, small = w < 560;
    ctx.fillStyle = C.ground; ctx.fillRect(0, 0, w, h);
    const axisW = 66, domW = small ? 0 : Math.min(170, w * 0.24);
    const plotW = w - axisW - domW, volH = Math.round(h * 0.17), padT = 16, priceH = h - volH - padT - 10;
    const step = small ? 9 : 11, bw = step - 3;
    const n = Math.min(this.candles.length, Math.floor((plotW - 12) / step)), vis = this.candles.slice(-n);
    let lo = Infinity, hi = -Infinity, maxV = 1;
    for (const c of vis) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); maxV = Math.max(maxV, c.v); }
    lo -= 3; hi += 3;
    if (this.lo === undefined) { this.lo = lo; this.hi = hi; }
    this.lo += (lo - this.lo) * 0.25; this.hi += (hi - this.hi) * 0.25;
    const y = i => padT + (this.hi - i) / (this.hi - this.lo) * priceH;
    const span = this.hi - this.lo, gstep = Math.max(1, Math.ceil(span / 5 / 4) * 4);
    mfont(ctx, 10); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let i = Math.ceil(this.lo / gstep) * gstep; i <= this.hi; i += gstep) {
      ctx.fillStyle = gridLine; ctx.fillRect(0, Math.round(y(i)), plotW, 1);
      ctx.fillStyle = C.muted; ctx.fillText(m.fmt(i), plotW + 8, y(i));
    }
    const xOf = k => plotW - 12 - (n - k) * step;
    vis.forEach((c, k) => {
      const x = xOf(k), up = c.c >= c.o;
      ctx.fillStyle = up ? C.positive : C.negative;
      ctx.fillRect(x + Math.floor(bw / 2), y(c.h), 1, Math.max(1, y(c.l) - y(c.h)));
      ctx.fillRect(x, y(Math.max(c.o, c.c)), bw, Math.max(1, Math.abs(y(c.o) - y(c.c))));
      const vh = c.v / maxV * (volH - 6);
      ctx.fillStyle = k === n - 1 ? (up ? posBar : negBar) : profilePat;
      ctx.fillRect(x, h - vh - 4, bw, vh);
    });
    ctx.beginPath(); let started = false;
    for (let k = 19; k < n; k++) {
      let s = 0; for (let j = k - 19; j <= k; j++) s += vis[j].c;
      const px = xOf(k) + bw / 2, py = y(s / 20);
      started ? ctx.lineTo(px, py) : (ctx.moveTo(px, py), started = true);
    }
    ctx.strokeStyle = this.hue; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = C.rule; ctx.fillRect(0, h - volH - 6, plotW, 1);
    const ly = y(m.mid);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = rgba(C.text, 0.5); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Math.round(ly) + 0.5); ctx.lineTo(plotW, Math.round(ly) + 0.5); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.rule; ctx.fillRect(plotW, 0, 1, h);
    priceTag(ctx, plotW + 1, ly, axisW - 1, m.fmt(m.mid));
    if (domW) drawDom(ctx, plotW + axisW, domW, h, m, { rowH: 17, price: true });
  }
}
Object.defineProperty(Candles.prototype, 'step', {
  value: function () {
    const tr = this.m.step(), cd = this.candles[this.candles.length - 1], p = this.m.mid;
    cd.h = Math.max(cd.h, p); cd.l = Math.min(cd.l, p); cd.c = p; for (const t of tr) cd.v += t.size;
    if (++this.n % this.per === 0) this.newCandle();
  }
});

class Waves {
  constructor(o, w, h) {
    this.o = o; this.hue = o.hue; this.loop = 0; this.build(); this.shown = Math.floor(this.N * 0.55);
    this.resize(w, h);
  }
  resize(w, h) { this.w = w; this.h = h; }
  build() { /* verbatim */ }
  step() {
    if (this.shown < this.N) this.shown++;
    else if (++this.hold > 40) { this.loop++; this.build(); this.shown = Math.floor(this.N * 0.3); }
  }
  tick() { this.step(); this.draw(); }
  draw() { this.drawImpl(this.ctx, this.w, this.h); }
  drawImpl(ctx, w, h) {
    const small = w < 560;
    ctx.fillStyle = C.ground; ctx.fillRect(0, 0, w, h);
    const axisW = 66, plotW = w - axisW, padT = 34, padB = 26, ph = h - padT - padB;
    const y = v => padT + (1.06 - v) / 1.14 * ph, cw = (plotW - 16) / this.N, x = k => 8 + k * cw + cw / 2;
    const price = v => (this.base + v * this.range).toFixed(2);
    mfont(ctx, 10); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= 1.001; v += 0.25) { ctx.fillStyle = gridLine; ctx.fillRect(0, Math.round(y(v)), plotW, 1); ctx.fillStyle = C.muted; ctx.fillText(price(v), plotW + 8, y(v)); }
    ctx.fillStyle = C.rule; ctx.fillRect(plotW, 0, 1, h);
    const P = this.pivots, p5 = P[5];
    if (this.shown > p5.k) {
      const fibs = [0, 0.236, 0.382, 0.5, 0.618, 1];
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      fibs.forEach(f => {
        const v = p5.v - f * (p5.v - P[0].v), yy = Math.round(y(v)) + 0.5;
        ctx.strokeStyle = f === 0.618 ? rgba(this.hue, 0.85) : rgba(C.text, 0.18);
        ctx.beginPath(); ctx.moveTo(x(p5.k), yy); ctx.lineTo(plotW, yy); ctx.stroke();
        if (!small || f === 0.618 || f === 0.382) { ctx.fillStyle = f === 0.618 ? this.hue : C.muted; ctx.textAlign = 'right'; ctx.fillText(`${(f * 100).toFixed(1)}%  ${price(v)}`, plotW - 6, yy - 8); }
      });
      ctx.setLineDash([]);
    }
    const bw = Math.max(2, cw * 0.62);
    for (let k = 0; k < this.shown; k++) {
      const b = this.bars[k], up = b.c >= b.o, bx = x(k);
      ctx.fillStyle = up ? C.positive : C.negative;
      ctx.fillRect(Math.round(bx), y(b.h), 1, Math.max(1, y(b.l) - y(b.h)));
      ctx.fillRect(bx - bw / 2, y(Math.max(b.o, b.c)), bw, Math.max(1, Math.abs(y(b.o) - y(b.c))));
    }
    const seen = P.filter(p => p.k < this.shown);
    ctx.beginPath(); seen.forEach((p, i) => i ? ctx.lineTo(x(p.k), y(p.v)) : ctx.moveTo(x(p.k), y(p.v)));
    ctx.strokeStyle = this.hue; ctx.lineWidth = 1.5; ctx.stroke();
    seen.forEach((p, i) => {
      if (!p.l) return;
      const high = i % 2 === 1, ly = y(p.v) + (high ? -18 : 18);
      ctx.beginPath(); ctx.arc(x(p.k), ly, 9, 0, Math.PI * 2);
      ctx.fillStyle = C.ground; ctx.fill(); ctx.strokeStyle = this.hue; ctx.lineWidth = 1; ctx.stroke();
      mfont(ctx, 10, 500); ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.fillText(p.l, x(p.k), ly + 0.5);
    });
    mfont(ctx, 10); ctx.textAlign = 'left'; ctx.fillStyle = C.muted;
    ctx.fillText('Impulse 1\u20135 \u00b7 Correction A\u2013B\u2013C \u00b7 Fib 0 \u2192 5', 10, 16);
  }
}
Object.defineProperty(Waves.prototype, 'build', {
  value: function () {
    const r = rng(this.o.seed + this.loop * 101), N = this.N = 104;
    const P = this.pivots = [[0, 0, ''], [0.13, 0.36, '1'], [0.22, 0.17, '2'], [0.47, 0.86, '3'], [0.57, 0.63, '4'], [0.72, 1, '5'], [0.81, 0.7, 'A'], [0.87, 0.83, 'B'], [1, 0.45, 'C']]
      .map(([t, v, l], k) => ({ k: Math.round(t * (N - 1)), v: k ? v + (r() - 0.5) * 0.05 : v, l }));
    const path = [];
    for (let k = 0; k < N; k++) {
      let s = 0; while (s < P.length - 2 && k > P[s + 1].k) s++;
      const a = P[s], b = P[s + 1], f = (k - a.k) / Math.max(1, b.k - a.k), e = f * f * (3 - 2 * f);
      path.push(a.v + (b.v - a.v) * e);
    }
    this.bars = path.map((v, k) => {
      const o = k ? path[k - 1] + (r() - 0.5) * 0.02 : v, c = v + (r() - 0.5) * 0.025;
      const isPivot = P.some(p => p.k === k);
      return { o, c, h: Math.max(o, c) + (isPivot ? 0.006 : r() * 0.025), l: Math.min(o, c) - (isPivot ? 0.006 : r() * 0.025) };
    });
    this.base = 66.8; this.range = 7.4; this.hold = 0;
  }
});

const SCENE_MAKERS = { heatmap: Heatmap, footprint: Footprint, candles: Candles, waves: Waves };

/* ================= scene timing ================= */
const SCENES = [
  { name: 'hook', dur: 2.8, draw: sceneHook },
  { name: 'chips', dur: 2.8, draw: sceneChips },
  { name: 'implode', dur: 2.4, draw: sceneImplode },
  { name: 'reveal', dur: 2.8, draw: sceneReveal },
  { name: 'product', dur: 4.2, draw: sceneProduct },
  { name: 'showcase', dur: 6.4, draw: sceneShowcase },
  { name: 'proof', dur: 1.6, draw: sceneProof },
  { name: 'cta', dur: 2.0, draw: sceneCta }
];
const starts = []; let _a = 0;
for (const s of SCENES) { starts.push(_a); _a += s.dur; }
const XFADE = 0.34;

/* ============ S0 HOOK — data-terminal restyle ============ */
function sceneHook() {
  return (t, ctx) => {
    const z = lerp(0.96, 1.0, outExpo(seg(t, 0, 1.0))) * lerp(1.0, 1.04, inOutQuint(seg(t, 1.1, 2.8)));
    const im = t - 0.95;
    cam(ctx, { z, x: shake(im) * 14, y: shake(im * 1.13 - 0.02) * 9 });
    backdrop(ctx, t);

    ctx.save(); ctx.globalAlpha = outExpo(seg(t, 0.05, 0.45));
    txt(ctx, 'MONTHLY COST OF TRADING TOOLS', W / 2, 615, MONO(40, 500), C.muted);
    ctx.restore();

    const lock = seg(t, 0.55, 0.95);
    const pop = spring(seg(t, 0.95, 1.4));
    const spin = 1 + (1 - outExpo(lock)) * 0.05;
    const big = lock >= 1 ? `$${MO_TOTAL}+` : `$${Math.floor(210 + rnd(Math.floor(t * 36)) * 420)}`;
    ctx.save(); ctx.translate(W / 2, 880); ctx.scale(spin * pop, spin * pop);
    ctx.font = MONO(190, 500);
    ctx.fillStyle = lock >= 1 ? C.text : C.soft;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(big, 0, 0);
    ctx.restore();

    // 1px accent underline — the data-terminal selection line
    const ulW = W * 0.34, ul = outExpo(seg(t, 0.95, 1.35));
    ctx.fillStyle = C.accent;
    ctx.fillRect(W / 2 - ulW * ul / 2, 1000, ulW * ul, 2);

    ctx.globalAlpha = outExpo(seg(t, 1.0, 1.3));
    txt(ctx, '/ month, for tools you never own', W / 2, 1058, F_MED(44), C.muted);
    ctx.globalAlpha = 1;

    const yr = spring(seg(t, 1.4, 1.95));
    if (yr > 0.02) {
      ctx.save(); ctx.globalAlpha = clamp01(yr);
      ctx.translate(W / 2, 1210); ctx.scale(yr, yr);
      rr(ctx, -350, -56, 700, 112, 8);
      ctx.fillStyle = C.surface; ctx.fill();
      ctx.fillRect(-350, -56, 3, 112); // accent 1px(3px tag) left line, negative tone
      ctx.fillStyle = C.negative; ctx.fillRect(-350, -56, 3, 112);
      txt(ctx, `that\u2019s $${(MO_TOTAL * 12 / 1000).toFixed(1)}k a year`, 0, 2, MONO(46, 500), C.negative);
      ctx.restore();
    }
    caption(ctx, 'You\u2019re renting software. Every month.', outExpo(seg(t, 1.2, 1.65)));
    if (t > 2.48) { const k = clamp01((t - 2.48) / 0.32); ctx.translate(0, -outCubic(k) * 130); }
  };
}

/* ============ S1 CHIPS — 7 platforms ============ */
function sceneChips() {
  const CW = 900, CH = 108;
  return (t, ctx) => {
    const z = lerp(1.12, 1.0, outExpo(seg(t, 0, 0.7))) * lerp(1.0, 1.05, inOutQuint(seg(t, 2.0, 2.8)));
    let sx = 0, sy = 0;
    APPS.forEach((_, i) => { const k = shake((t - (0.28 + i * 0.14)) * 1.05); sx += k * 4; sy += k * 3; });
    cam(ctx, { z, x: sx, y: sy });
    backdrop(ctx, t);

    txt(ctx, 'EVERY PLATFORM. EVERY MONTH.', W / 2, 335, F_TITLE(46), C.soft);

    APPS.forEach((p, i) => {
      const cols = 2, col = i % cols, rowi = Math.floor(i / cols);
      const at = 0.28 + i * 0.14;
      const ent = outExpo(seg(t, at, at + 0.5));
      const sq = spring(Math.max(0, t - at) * 1.2);
      if (sq <= 0.02) return;
      const cw2 = (CW - 20) / 2;
      const x = W / 2 - CW / 2 + col * (cw2 + 20), y = 470 + rowi * 132;
      ctx.save();
      ctx.globalAlpha = clamp01((t - at) / 0.14);
      ctx.translate(lerp(1150 - x, 0, ent) + x, y);
      ctx.rotate(lerp(0.08, 0, ent));
      ctx.scale(lerp(1.1, 1, sq), lerp(1.1, 1, sq));
      rr(ctx, 0, 0, cw2, CH, 8);
      ctx.fillStyle = C.surface; ctx.fill();
      ctx.strokeStyle = C.border; ctx.lineWidth = 1.5; ctx.stroke();
      tile(ctx, 22, (CH - 40) / 2, 40, p.hue, p.letters, 13);
      txt(ctx, p.name, 82, CH / 2, F_MED(38), C.text, 'left');
      ctx.font = MONO(40, 500);
      const pw = ctx.measureText(p.m).width;
      txt(ctx, p.m, cw2 - 24 - pw, CH / 2 + 1, MONO(40, 500), C.soft, 'left');
      txt(ctx, '/mo', cw2 - 20, CH / 2 + 2, MONO(24), C.muted, 'right');
      ctx.restore();
    });

    const tot = spring(seg(t, 1.6, 2.15));
    if (tot > 0.02) {
      ctx.save(); ctx.globalAlpha = clamp01(tot);
      ctx.translate(W / 2, 1460 + (1 - tot) * 40); ctx.scale(tot, tot);
      rr(ctx, -330, -52, 660, 104, 8);
      ctx.fillStyle = C.surface; ctx.fill();
      ctx.strokeStyle = rgba(C.negative, 0.55); ctx.lineWidth = 1.5; ctx.stroke();
      txt(ctx, `$${MO_TOTAL} / MO IN RENT`, 0, 2, MONO(46, 500), C.negative);
      ctx.restore();
    }
    if (t > 2.5) { const k = clamp01((t - 2.5) / 0.3); ctx.translate(0, -outCubic(k) * 130); }
  };
}

/* ============ S2 IMPLODE ============ */
function sceneImplode() {
  const CX = W / 2, CY = 880;
  return (t, ctx) => {
    const impact = t - 1.45;
    let z = lerp(1.1, 1.0, outExpo(seg(t, 0, 0.7)));
    z += impact > 0 ? shake(impact) * 0.025 : 0;
    cam(ctx, { z, x: impact > 0 ? shake(impact) * 16 : 0, y: impact > 0 ? shake(impact * 1.11) * 11 : 0 });
    backdrop(ctx, t);

    const prog = clamp01((t - 0.5) / 0.9);
    if (prog < 1) {
      APPS.forEach((p, i) => {
        ctx.save();
        ctx.globalAlpha = 1 - prog * prog;
        const col = i % 2, rowi = Math.floor(i / 2);
        const bx = W / 2 - 435 + col * 470, by = 470 + rowi * 132;
        const x = lerp(bx, CX - 470 + (rnd(i) - 0.5) * 70, prog);
        const y = lerp(by, CY - 60 + (rnd(i + 9) - 0.5) * 70, prog);
        const sc = lerp(1, 0.25, prog);
        ctx.translate(x, y); ctx.scale(sc * 2, sc * 2);
        rr(ctx, 0, 0, 435, 96, 8);
        ctx.fillStyle = C.surface; ctx.fill();
        ctx.strokeStyle = C.border; ctx.lineWidth = 1.5; ctx.stroke();
        tile(ctx, 18, 28, 40, p.hue, p.letters, 13);
        txt(ctx, p.name, 74, 48, F_MED(34), C.text, 'left');
        txt(ctx, p.m, 390, 49, MONO(34, 500), C.soft, 'right');
        ctx.restore();
      });
    }

    const badgeIn = spring(seg(t, 1.32, 1.95));
    if (badgeIn > 0.02) {
      ctx.save(); ctx.translate(CX, CY); ctx.scale(badgeIn, badgeIn);
      const g = ctx.createRadialGradient(0, 0, 80, 0, 0, 350);
      g.addColorStop(0, rgba(C.accent, 0.16)); g.addColorStop(1, rgba(C.accent, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 350, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, 300, 0, 7);
      ctx.fillStyle = C.surface; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = rgba(C.accent, 0.9); ctx.stroke();
      txt(ctx, '1', 0, -84, MONO(225, 500), C.text);
      txt(ctx, 'PAYMENT', 0, 92, F_TITLE(58), C.posInk);
      txt(ctx, 'lifetime license \u00b7 no renewal', 0, 186, MONO(38), C.muted);
      ctx.restore();
    }
    for (let k = 0; k < 2; k++) {
      const rt = impact / (0.55 + k * 0.35) - k * 0.06;
      if (rt > 0 && rt < 1) {
        ctx.save(); ctx.globalAlpha = (1 - rt) * 0.7;
        ctx.beginPath(); ctx.arc(CX, CY, 300 + rt * 480, 0, 7);
        ctx.lineWidth = 4 * (1 - rt); ctx.strokeStyle = C.accent; ctx.stroke();
        ctx.restore();
      }
    }
    caption(ctx, 'one payment. yours for good.', outExpo(seg(t, 1.7, 2.1)));
  };
}

/* ============ S3 REVEAL — brand panel with the real .ico ============ */
function sceneReveal() {
  return (t, ctx) => {
    const z = lerp(1.13, 0.99, outExpo(seg(t, 0, 0.9))) * lerp(1.0, 1.045, inOutQuint(seg(t, 1.8, 2.8)));
    cam(ctx, { z, y: lerp(140, 0, outExpo(seg(t, 0, 0.65))) });
    backdrop(ctx, t);

    // brand panel (site .brand-panel)
    const panelIn = outExpo(seg(t, 0.05, 0.55));
    ctx.save();
    ctx.globalAlpha = panelIn;
    ctx.translate(0, (1 - panelIn) * 60);
    const PW = 880, PH = 1030, PX = (W - PW) / 2, PY = 330;
    rr(ctx, PX, PY, PW, PH, 14);
    ctx.fillStyle = C.surface; ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1.5; ctx.stroke();
    // dotted interior + soft aurora hint (blue field like the site hero)
    ctx.save(); rr(ctx, PX, PY, PW, PH, 14); ctx.clip();
    const g = ctx.createRadialGradient(W / 2, PY + PH * 0.42, 60, W / 2, PY + PH * 0.45, PH * 0.75);
    g.addColorStop(0, 'rgba(31,109,255,0.22)'); g.addColorStop(0.5, 'rgba(10,60,140,0.10)'); g.addColorStop(1, 'rgba(2,8,24,0)');
    const gT = t;
    ctx.fillStyle = g;
    ctx.translate(W / 2, PY + PH * 0.42); ctx.rotate(gT * 0.12); ctx.translate(-2000, -2000);
    ctx.fillRect(-2000, -2000, 4000, 4000);
    ctx.setTransform(ctx.getTransform().a ? ctx.getTransform() : ctx.getTransform());
    // undo rotation hack: redraw base
    ctx.restore();
    // dot pattern
    ctx.save(); rr(ctx, PX, PY, PW, PH, 14); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let y = PY + 12; y < PY + PH; y += 18) for (let x = PX + 12; x < PX + PW; x += 18) ctx.fillRect(x, y, 1.4, 1.4);
    ctx.restore();

    const markS = spring(seg(t, 0.25, 0.95));
    if (markS > 0.02) {
      ctx.save(); ctx.translate(W / 2, PY + 330); ctx.scale(markS, markS);
      ctx.rotate(lerp(-0.06, 0, outExpo(seg(t, 0.25, 0.8))));
      ico(ctx, -115, -115, 230, 46);
      ctx.restore();
    }

    const wmA = outExpo(seg(t, 0.6, 1.0));
    ctx.save(); ctx.globalAlpha = wmA; ctx.translate(0, (1 - wmA) * 40);
    txt(ctx, 'TradeBay', W / 2, PY + 600, F_TITLE(120), C.text);
    ctx.restore();

    const subA = outExpo(seg(t, 0.95, 1.35));
    ctx.save(); ctx.globalAlpha = subA; ctx.translate(0, (1 - subA) * 34);
    ctx.fillStyle = C.accent; ctx.fillRect(W / 2 - 210, PY + 675, 420 * subA, 2);
    txt(ctx, '$119.99 per platform \u00b7 one payment', W / 2, PY + 745, MONO(46, 500), C.accentInk);
    ctx.restore();

    // 7 platform mini-tiles
    const tilesA = outExpo(seg(t, 1.45, 1.9));
    ctx.save(); ctx.globalAlpha = tilesA; ctx.translate(0, (1 - tilesA) * 26);
    APPS.forEach((p, i) => {
      const s = 64, gap = 14, total = APPS.length * s + 6 * gap;
      const x = W / 2 - total / 2 + i * (s + gap);
      tile(ctx, x, PY + 830, s, p.hue, p.letters, 16);
    });
    ctx.restore();

    // status line (footer style)
    const stA = outExpo(seg(t, 1.85, 2.25));
    ctx.save(); ctx.globalAlpha = stA;
    scopeMark(ctx, W / 2 - 108, PY + 950, C.positive);
    txt(ctx, 'license.tradebay.io', W / 2 + 6, PY + 950, MONO(38), C.muted);
    ctx.restore();

    ctx.restore();
    if (t > 2.5) { const k = clamp01((t - 2.5) / 0.3); ctx.translate(0, -outCubic(k) * 130); }
  };
}

/* ============ S4 PRODUCT — launcher styled on client app ============ */
function sceneProduct() {
  const WW = 1050, WH = 700, WX = (W - WW) / 2, WY = 470;
  return (t, ctx) => {
    const selIdx = Math.min(6, Math.floor(Math.max(0, (t - 0.9) / 0.2)));
    const barT = clamp01((t - 2.3) / 1.25);
    const launched = t >= 3.95;
    if (launched) return; // covered by crossfade to showcase

    const kick = t > 2.05 && t < 2.4 ? shake((t - 2.05) * 1.2) * 6 : 0;
    const z = lerp(0.93, 1.0, outExpo(seg(t, 0, 0.9))) * lerp(1.0, 1.03, inOutQuint(seg(t, 1.0, 4.0)));
    cam(ctx, { z, y: kick });
    backdrop(ctx, t);

    const winIn = spring(seg(t, 0.05, 0.9));
    if (winIn > 0.02) {
      ctx.save();
      ctx.translate(W / 2, WY + WH / 2);
      ctx.rotate(lerp(-0.045, 0, outExpo(seg(t, 0.05, 0.6))));
      ctx.scale(winIn, winIn);
      ctx.translate(-W / 2, -(WY + WH / 2));
      drawLauncher(ctx, WX, WY, WW, WH, selIdx, barT, t);
      ctx.restore();
    }
    caption(ctx, barT <= 0 ? 'one launcher installs all of it' : barT < 1 ? 'signed \u00b7 verified \u00b7 current' : 'ready', outExpo(seg(t, 0.85, 1.25)), 1470, 50);
  };
}

function drawLauncher(ctx, x, y, w, h, selIdx, barT, t) {
  // window shell: chrome + 1px border + 40px titlebar + 26px statusbar (app.html)
  rr(ctx, x, y, w, h, 10);
  ctx.fillStyle = C.ground; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = C.border; ctx.stroke();
  ctx.save(); rr(ctx, x, y, w, h, 10); ctx.clip();

  // titlebar
  ctx.fillStyle = C.chrome; ctx.fillRect(x, y, w, 40);
  ctx.fillStyle = C.rule; ctx.fillRect(x, y + 40, w, 1);
  ico(ctx, x + 16, y + 9, 22);
  txt(ctx, 'Trade Bay', x + 48, y + 20, F_MED(15), C.text, 'left');
  txt(ctx, '/ Library', x + 132, y + 20, F_BODY(13), C.muted, 'left');
  // license pill (licensed state)
  const lpw = 150;
  rr(ctx, x + w - lpw - 14, y + 5, lpw, 30, 999);
  ctx.strokeStyle = C.control; ctx.lineWidth = 1; ctx.stroke();
  scopeMark(ctx, x + w - lpw + 6, y + 20, C.positive);
  txt(ctx, 'Licensed', x + w - lpw / 2 + 8, y + 20, F_MED(12), C.soft);

  // icon rail (56px)
  const railW = 56;
  ctx.fillStyle = C.chrome; ctx.fillRect(x, y + 41, railW, h - 41);
  ctx.fillStyle = C.border; ctx.fillRect(x + railW - 1, y + 41, 1, h - 41);
  const icons = ['grid', 'chart', 'cart', 'shield', 'gear'];
  icons.forEach((ic, i) => {
    const cy = y + 41 + 22 + i * 44;
    drawRailIcon(ctx, ic, x + railW / 2 - 10, cy - 10, i === 0);
    if (i === 0) { ctx.fillStyle = C.accent; ctx.fillRect(x + railW - 1, cy - 14, 1.5, 28); }
    if (i === 2) { ctx.beginPath(); ctx.arc(x + railW - 8, cy - 9, 3, 0, 7); ctx.fillStyle = C.accent; ctx.fill(); }
  });

  // statusbar
  ctx.fillStyle = C.chrome; ctx.fillRect(x, y + h - 26, w, 26);
  ctx.fillStyle = C.rule; ctx.fillRect(x, y + h - 26, w, 1);
  scopeMark(ctx, x + 22, y + h - 13, C.positive);
  txt(ctx, 'license server online', x + 34, y + h - 13, F_BODY(11), C.muted, 'left');
  txt(ctx, '7 platforms \u00b7 all verified', x + w - 16, y + h - 13, MONO(11), C.muted, 'right');

  // library: list + detail
  const sx = x + railW, sw = 300;
  ctx.fillStyle = C.rule; ctx.fillRect(sx + sw, y + 67, 1, h - 93);
  txt(ctx, 'Platforms', sx + 20, y + 96, F_BODY(18), C.muted, 'left');
  txt(ctx, '7', sx + sw - 20, y + 96, MONO(12), C.muted, 'right');
  APPS.forEach((p, i) => {
    const iy = y + 118 + i * 52;
    const on = i === selIdx;
    if (on && barT > 0) { // mini progress line (site .lib-item .mini)
      ctx.fillStyle = C.raised; ctx.fillRect(sx + 56, iy + 44, sw - 76, 2);
      ctx.fillStyle = C.accent; ctx.fillRect(sx + 56, iy + 44, (sw - 76) * barT, 2);
    }
    if (on) {
      ctx.fillStyle = C.raised; ctx.fillRect(sx, iy, sw - 1, 52);
      ctx.fillStyle = C.accent; ctx.fillRect(sx, iy + 10, 1.5, 32);
    } else if (t > 0.6) { ctx.globalAlpha = 0.94; }
    tile(ctx, sx + 16, iy + 12, 28, p.hue, p.letters, 9);
    txt(ctx, p.name, sx + 56, iy + 22, F_MED(14.5), C.text, 'left');
    ctx.fillStyle = barT >= 1 && on ? C.posInk : (on ? C.accentInk : C.muted);
    txt(ctx, on ? (barT >= 1 ? 'ready' : barT > 0 ? `${Math.round(outCubic(barT) * 100)}%` : 'latest') : 'ready', sx + sw - 20, iy + 22, F_BODY(11.5), ctx.fillStyle, 'right');
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = C.rule; ctx.fillRect(sx, y + h - 26 - 1, sw, 1);

  // detail pane
  const p = APPS[selIdx];
  const dx = sx + sw + 32, dw = w - railW - sw - 44;
  tile(ctx, dx, y + 88, 56, p.hue, p.letters, 17);
  txt(ctx, p.name, dx + 72, y + 104, F_TITLE(25), C.text, 'left');
  txt(ctx, `v${({ sc: '2689', atas: '6.4.1', ax: '1.2.3', bm: '7.6.0', mw: '8.4.0', dc: '5.2.0', jig: '2.4.0' })[p.id] || 'latest'}`, dx + 72, y + 128, MONO(12), C.muted, 'left');
  // pills row
  let px2 = dx;
  const pill = (str, bg, ink, fs = 12, pad = 10) => {
    ctx.font = F_MED(fs);
    const pw = ctx.measureText(str).width + pad * 2;
    rr(ctx, px2, y + 148, pw, 22, 4); ctx.fillStyle = bg; ctx.fill();
    txt(ctx, str, px2 + pw / 2, y + 159.5, F_MED(fs), ink);
    px2 += pw + 8;
  };
  pill('lifetime license', C.pillPosBg, C.posInk);
  pill('signed manifest', C.pillAccBg, C.accentInk);
  pill('windows 10/11', C.raised, 'rgba(189,189,192,1)');
  txt(ctx, p.view, dx, y + 205, F_BODY(14), C.soft, 'left');

  // actions
  if (barT <= 0) {
    const pressed = t > 2.08 && t < 2.22 ? 0.96 : 1;
    ctx.save(); ctx.translate(dx + 78, y + 268); ctx.scale(pressed, pressed); ctx.translate(-(dx + 78), -(y + 268));
    rr(ctx, dx, y + 238, 156, 44, 999); ctx.fillStyle = '#fff'; ctx.fill();
    txt(ctx, 'INSTALL', dx + 78, y + 261, F_MED(14), '#0e0e11');
    ctx.restore();
  } else {
    // progress-card (app.html .progress-card)
    const cardY = y + 238;
    rr(ctx, dx, cardY, dw, 92, 8); ctx.fillStyle = C.surface; ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.stroke();
    const done = barT >= 1;
    txt(ctx, done ? `${p.name} installed` : `Downloading ${p.name}`, dx + 18, cardY + 26, F_MED(14), C.text, 'left');
    txt(ctx, `${Math.round(outCubic(barT) * 100)}%`, dx + dw - 18, cardY + 26, MONO(17, 500), C.text, 'right');
    ctx.fillStyle = C.raised; ctx.fillRect(dx + 18, cardY + 44, dw - 36, 4);
    if (!done) { ctx.fillStyle = C.accent; ctx.fillRect(dx + 18, cardY + 44, (dw - 36) * outCubic(barT), 4); }
    else { ctx.fillStyle = C.positive; ctx.fillRect(dx + 18, cardY + 44, dw - 36, 4); }
    txt(ctx, done ? 'signature verified \u00b7 sha-256' : 'sha-256 \u00b7 manifest signature', dx + 18, cardY + 72, MONO(11), C.muted, 'left');
    // RUN button (btn-run)
    const runS = spring(Math.max(0, t - 3.55));
    if (runS > 0.02) {
      ctx.save(); ctx.translate(dx + dw - 90, cardY + 46); ctx.scale(runS, runS);
      rr(ctx, -72, -26, 144, 52, 999); ctx.fillStyle = C.pillPosBg; ctx.fill();
      ctx.strokeStyle = rgba(C.posInk, 0.8); ctx.lineWidth = 1; ctx.stroke();
      txt(ctx, 'RUN', 0, 1, F_TITLE(16), C.posInk);
      ctx.restore();
    }
  }
  // stats strip
  const nums = [['files', '1,284'], ['size', '312 MB'], ['build', 'latest'], ['release', '2026.10'], ['state', barT >= 1 ? 'READY' : 'IDLE']];
  nums.forEach((kv, i) => {
    const col = Math.floor(i / 3), rowi2 = i % 3;
    const bx = dx + col * (dw / 2 + 4), byy = y + 480 + rowi2 * 58;
    const bw2 = dw / 2 - 8;
    rr(ctx, bx, byy, bw2, 50, 8); ctx.fillStyle = C.surface; ctx.fill();
    txt(ctx, kv[0].toUpperCase(), bx + 16, byy + 17, F_BODY(10), C.muted, 'left');
    txt(ctx, kv[1], bx + 16, byy + 37, MONO(16, 500), C.text, 'left');
  });

  ctx.restore();
}
function drawRailIcon(ctx, kind, x, y, on) {
  ctx.save();
  ctx.strokeStyle = on ? C.text : C.muted; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  const s = 20;
  if (kind === 'grid') { ctx.strokeRect(x + 1, y + 1, 7, 7); ctx.strokeRect(x + 11, y + 1, 7, 7); ctx.strokeRect(x + 1, y + 11, 7, 7); ctx.strokeRect(x + 11, y + 11, 7, 7); }
  if (kind === 'chart') { ctx.strokeRect(x + 1, y + 1, 18, 18); ctx.beginPath(); ctx.moveTo(x + 1, y + 13); ctx.lineTo(x + 7, y + 9); ctx.lineTo(x + 11, y + 12); ctx.lineTo(x + 19, y + 4); ctx.stroke(); }
  if (kind === 'cart') { ctx.beginPath(); ctx.moveTo(x + 1, y + 3); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x + 6, y + 13); ctx.lineTo(x + 17, y + 13); ctx.lineTo(x + 19, y + 6); ctx.lineTo(x + 5, y + 6); ctx.stroke(); }
  if (kind === 'shield') { ctx.beginPath(); ctx.moveTo(x + 10, y + 1); ctx.lineTo(x + 18, y + 4); ctx.lineTo(x + 18, y + 10); ctx.lineTo(x + 10, y + 19); ctx.lineTo(x + 2, y + 10); ctx.lineTo(x + 2, y + 4); ctx.closePath(); ctx.stroke(); }
  if (kind === 'gear') { ctx.beginPath(); ctx.arc(x + 10, y + 10, 5, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(x + 10, y + 10, 1.6, 0, 7); ctx.stroke(); }
  ctx.restore();
}

/* ============ S5 SHOWCASE — every app, site animations ============ */
const BODY_W = 1000, BODY_H = 560;
const TERMINALS = APPS.map(p => {
  const cv = createCanvas(BODY_W, BODY_H);
  const maker = { footprint: Footprint, heatmap: Heatmap, candles: Candles, waves: Waves }[p.scene];
  const sc = new maker({ seed: p.seed, sym: p.sym, hue: p.hue, dom: p.dom, variant: p.variant }, BODY_W, BODY_H);
  sc.ctx = cv.getContext('2d'); sc.w = BODY_W; sc.h = BODY_H;
  return { p, cv, scene: sc };
});
function sceneShowcase() {
  const FW = BODY_W, FH = BODY_H;
  const FX = (W - FW) / 2, FY = 510;
  const per = 6.4 / APPS.length;
  return (t, ctx) => {
    const z = lerp(0.95, 1.0, outExpo(seg(t, 0, 0.8))) * lerp(1.0, 1.03, inOutQuint(seg(t, 2.0, 6.4)));
    cam(ctx, { z, y: -110 });
    backdrop(ctx, t);

    const idx = Math.min(6, Math.floor(t / per));
    const lt = t - idx * per;
    const app = TERMINALS[idx].p;
    // step + draw the site scene at 60fps (bound ctx)
    const T = TERMINALS[idx], scene = T.scene;
    scene.step();
    scene.draw.call(scene); // ctx bound in constructor

    // composite body canvas with edge crossfade
    const a = Math.min(1, lt / 0.1, (per - lt) / 0.1);
    ctx.save();
    ctx.globalAlpha = a;
    // terminal frame (site .terminal)
    rr(ctx, FX, FY, FW, FH + 40 + 30, 8);
    ctx.fillStyle = C.ground; ctx.fill();
    // bar
    ctx.fillStyle = C.chrome; ctx.fillRect(FX + 1, FY + 1, FW - 2, 40);
    tile(ctx, FX + 16, FY + 9, 22, app.hue, app.letters, 9);
    txt(ctx, app.name, FX + 50, FY + 21, F_MED(14), C.text, 'left');
    txt(ctx, app.sym, FX + 150, FY + 21, MONO(12), C.muted, 'left');
    txt(ctx, '$119.99', FX + FW - 18, FY + 21, MONO(13, 500), C.posInk, 'right');
    ctx.fillStyle = C.rule; ctx.fillRect(FX + 1, FY + 41, FW - 2, 1);
    // body
    ctx.drawImage(T.cv, FX + 1, FY + 42);
    // foot
    ctx.fillStyle = C.rule; ctx.fillRect(FX + 1, FY + 42 + FH, FW - 2, 1);
    txt(ctx, app.view, FX + 18, FY + 57 + FH, MONO(12), C.muted, 'left');
    txt(ctx, 'illustration', FX + FW - 18, FY + 57 + FH, MONO(12), C.muted, 'right');
    // 1px accent frame hover line
    ctx.strokeStyle = rgba(app.hue, 0.55); ctx.lineWidth = 1.5;
    rr(ctx, FX + 0.5, FY + 0.5, FW - 1, FH + 69, 8); ctx.stroke();
    ctx.restore();

    caption(ctx, app.name + ' \u2014 ' + app.view, outExpo(seg(lt, 0.12, 0.3)) * clamp01((per - lt) / 0.18), 1500, 46, C.soft);
    txtPlace(ctx, idx);
  };
}
function txtPlace(ctx, idx) {
  txt(ctx, `${idx + 1} / 7`, W / 2, 1660, MONO(30, 500), C.faintCol || 'rgba(156,158,166,0.7)');
}

/* ============ S6 PROOF ============ */
function sceneProof() {
  const items = [['LIFETIME ACTIVATION', 'no renewal \u00b7 ever'], ['FREE UPDATES', 'signed \u00b7 verified builds'], ['$119.99 EACH', '7 platforms \u00b7 one payment']];
  return (t, ctx) => {
    let z = lerp(1.06, 1.0, outExpo(seg(t, 0, 0.5)));
    let sx = 0, sy = 0;
    items.forEach((_, i) => { const k = shake((t - (0.15 + i * 0.4)) * 1.2); sx += k * 7; sy += k * 4; });
    cam(ctx, { z, x: sx, y: sy });
    backdrop(ctx, t);
    items.forEach((s, i) => {
      const at = 0.15 + i * 0.4, y = 640 + i * 250;
      const pp = spring(Math.max(0, (t - at)) * 1.1);
      if (pp <= 0.02) return;
      ctx.save(); ctx.globalAlpha = clamp01((t - at) / 0.15);
      ctx.translate(W / 2, y); ctx.scale(pp, pp);
      const w2 = 880;
      rr(ctx, -w2 / 2, -78, w2, 156, 8);
      ctx.fillStyle = C.surface; ctx.fill();
      ctx.strokeStyle = C.border; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = C.positive; ctx.fillRect(-w2 / 2, -78, 2.5, 156);
      txt(ctx, s[0], 20, -18, F_TITLE(48), C.text);
      txt(ctx, s[1], 20, 42, MONO(30), C.muted, 'left');
      // check
      ctx.beginPath(); ctx.arc(-w2 / 2 + 80, -2, 34, 0, 7);
      ctx.fillStyle = C.pillPosBg; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = C.posInk; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-w2 / 2 + 64, -2); ctx.lineTo(-w2 / 2 + 76, 10); ctx.lineTo(-w2 / 2 + 96, -14); ctx.stroke();
      ctx.restore();
    });
  };
}

/* ============ S7 CTA ============ */
function sceneCta() {
  return (t, ctx) => {
    const z = lerp(0.98, 1.025, inOutQuint(seg(t, 0, 2.0)));
    cam(ctx, { z });
    backdrop(ctx, t);
    const in1 = spring(seg(t, 0.02, 0.5));
    if (in1 > 0.02) {
      ctx.save(); ctx.translate(W / 2, 830); ctx.scale(in1, in1);
      txt(ctx, 'PAY ONCE.', 0, 0, F_TITLE(122), C.text);
      ctx.restore();
    }
    const in2 = spring(seg(t, 0.28, 0.8));
    if (in2 > 0.02) {
      ctx.save(); ctx.translate(W / 2, 985); ctx.scale(in2, in2);
      let size = 122;
      ctx.font = F_TITLE(size);
      const wTxt = ctx.measureText('TRADE FOREVER.').width;
      if (wTxt > 1000) size = Math.floor(size * 1000 / wTxt);
      txt(ctx, 'TRADE FOREVER.', 0, 0, F_TITLE(size), C.posInk);
      ctx.restore();
    }
    const in3 = outExpo(seg(t, 0.6, 1.0));
    if (in3 > 0.02) {
      ctx.save(); ctx.globalAlpha = in3; ctx.translate(0, (1 - in3) * 30);
      const strap = 'license.tradebay.io \u00b7 authorized reseller';
      ctx.font = MONO(38);
      const swd = ctx.measureText(strap).width, sx0 = W / 2 - swd / 2;
      scopeMark(ctx, sx0 - 30, 1140, C.positive);
      txt(ctx, strap, sx0, 1140, MONO(38), C.muted, 'left');
      ctx.restore();
    }
    const in4 = spring(seg(t, 0.85, 1.4));
    if (in4 > 0.02) {
      ctx.save(); ctx.translate(W / 2, 1330); ctx.scale(in4, in4);
      ico(ctx, -52, -52, 104, 40);
      ctx.restore();
    }
  };
}

/* ================= frame pipeline with crossfades ================= */
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const sA = createCanvas(W, H), sB = createCanvas(W, H);
const cA = sA.getContext('2d'), cB = sB.getContext('2d');

function renderSceneInto(octx, t) {
  let si = 0;
  for (let i = SCENES.length - 1; i >= 0; i--) { if (t >= starts[i] - 1e-9) { si = i; break; } }
  const lt = t - starts[si];
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.globalAlpha = 1;
  octx.fillStyle = C.ground; octx.fillRect(0, 0, W, H);
  SCENES[si].draw()(lt, octx);
  octx.setTransform(1, 0, 0, 1, 0, 0);
  return { si, lt };
}

function renderFrame(t) {
  const siInf = sceneAt(t);
  const lt = t - starts[siInf];

  let fl = lt < 0.04 ? (1 - lt / 0.04) * 0.18 : 0;
  let dip = 0, fade = null;

  const inX = siInf > 0 && lt < XFADE;
  if (inX) {
    const prevEnd = starts[siInf] - XFADE + lt; // prev scene time continued
    const { si: siPrev } = renderSceneInto(cA, prevEnd);
    const tt = inOutSine(lt / XFADE);
    dip = Math.sin(Math.PI * (lt / XFADE)) * 0.22;
    renderFrameMain(tt, prevEnd);
  } else {
    renderFrameMain(1, null);
  }
  flash(ctx, fl);
  if (dip > 0.01) { ctx.save(); ctx.globalAlpha = dip; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}
function sceneAt(t) {
  for (let i = SCENES.length - 1; i >= 0; i--) if (t >= starts[i] - 1e-9) return i;
  return 0;
}
function renderFrameMain(fadeIn, prevDrawn) {
  // draw current scene on canvas, then blend prev over? we keep: prev rendered to sA; current to canvas
  // current scene
  const t = curT; renderSceneInto(cB, t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(sB, 0, 0);
  if (fadeIn < 1) {
    ctx.save(); ctx.globalAlpha = fadeIn; ctx.drawImage(sA, 0, 0); ctx.restore();
  } else {
    ctx.globalAlpha = 1;
  }
  // impact flashes inside scenes
  const lt = t - starts[sceneAt(t)];
  let fl2 = 0;
  if (curT < 0.04) fl2 = (1 - curT / 0.04) * 0.18;
  const si = sceneAt(t);
  if (si === 0 && Math.abs(t - 0.95) < 0.04) fl2 = Math.max(fl2, (1 - Math.abs(t - 0.95) / 0.04) * 0.55);
  if (si === 2 && Math.abs(t - 1.45) < 0.05 && (t - 1.45) >= 0) fl2 = Math.max(fl2, (1 - Math.abs(t - 1.45) / 0.05) * 0.6);
  if (si === 4 && Math.abs(t - (starts[4] + 3.95)) < 0.04) fl2 = Math.max(fl2, (1 - Math.abs(t - (starts[4] + 3.95)) / 0.04) * 0.55);
  flash(ctx, fl2);
}
let curT = 0;

if (SMOKE) {
  (async () => {
    ICO_IMG = await loadIco();
    const hits = [0.6, 1.4, 2.9, 3.6, 5.2, 6.6, 7.6, 8.3, 9.2, 11.2, 12.4, 14.4, 15.2, 15.8, 16.6, 17.5, 18.4, 19.3, 20.2, 21.0, 21.5, 22.4, 23.3, 24.6];
  for (const tt of hits) {
    curT = tt;
    const siInf = sceneAt(tt);
    const lt = tt - starts[siInf];
    const inX = siInf > 0 && lt < XFADE;
    if (inX) {
      renderSceneInto(cA, starts[siInf] - XFADE + lt);
      renderSceneInto(cB, tt);
      const tt2 = inOutSine(lt / XFADE);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
      ctx.drawImage(sB, 0, 0);
      ctx.save(); ctx.globalAlpha = tt2; ctx.drawImage(sA, 0, 0); ctx.restore();
      const dip = Math.sin(Math.PI * (lt / XFADE)) * 0.22;
      ctx.save(); ctx.globalAlpha = dip; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.restore();
    } else {
      renderFrame(tt);
    }
    writeFileSync(`qc/f${String(Math.round(tt * 100)).padStart(4, '0')}_s${siInf}_t${lt.toFixed(2)}.png`, canvas.toBuffer('image/png'));
  }
  console.log('SMOKE done');
  })();
} else {
  (async () => {
    ICO_IMG = await loadIco();
    const ff = spawn(FF, [
    '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-tune', 'animation', '-pix_fmt', 'yuv420p',
    'out/video_nosound.mp4'
  ], { stdio: ['pipe', 'inherit', 'pipe'] });
  let stderrTail = '';
  ff.stderr.on('data', d => { stderrTail = (stderrTail + d).slice(-3000); });
  ff.on('exit', code => {
    if (code === 0) { console.log('VIDEO RENDER OK'); process.exit(0); }
    console.error('ffmpeg exit', code, '\n', stderrTail); process.exit(1);
  });
  (async () => {
    for (let i = 0; i < FRAMES; i++) {
      curT = i / FPS;
      renderFrame(curT);
      const buf = canvas.toBuffer('image/png');
      await new Promise(res => ff.stdin.write(buf, res));
      if (ff.stdin.writableNeedDrain) await new Promise(res => ff.stdin.once('drain', res));
      if (i % 200 === 0) console.log(`frame ${i}/${FRAMES} (${curT.toFixed(1)}s)`);
    }
    ff.stdin.end();
  })();
  })();
}
