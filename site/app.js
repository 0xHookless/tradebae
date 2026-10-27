/* Trade Bay home site: live market illustrations, platform showcase, cart. No dependencies. */
(() => {
'use strict';

const CONFIG = {
  checkoutUrl: '/checkout',   // receives ?items=sc,atas,...
  price: 119.99,              // base price per platform, USD
};

const PLATFORMS = [
  { id: 'sc', name: 'Sierra Chart', mono: 'SC', version: '2689', sym: 'ESZ6', scene: 'candles', seed: 11,
    view: 'Candles, SMA 20 and trading DOM',
    tagline: 'Fast, lean charting and trading, built in C++.',
    bestFor: 'Speed and custom code',
    features: [['Numbers bars', 'Volume at price inside every bar.'], ['Trading DOM', 'Ladder trading with live market depth.'], ['ACSIL', 'Write your own studies and systems in C++.'], ['Light on hardware', 'Runs smoothly on modest machines.']] },
  { id: 'atas', name: 'ATAS', mono: 'AT', version: '6.4.12', sym: 'NQZ6', scene: 'footprint', seed: 23,
    view: 'Footprint · bid × ask at every price',
    tagline: 'Order flow analysis, cluster by cluster.',
    bestFor: 'Order flow traders',
    features: [['Footprint charts', 'Bid and ask volume at every price.'], ['Smart DOM and Smart Tape', 'Depth and prints, filtered so you can read them.'], ['Big Trades', 'Spot large participants as they hit the tape.'], ['Market Replay', 'Practise on recorded sessions.']] },
  { id: 'bm', name: 'Bookmap', mono: 'BM', version: '7.6.0', sym: 'ESZ6', scene: 'heatmap', seed: 5,
    view: 'Liquidity heatmap with volume dots',
    tagline: "See the order book's history as a heatmap.",
    bestFor: 'Reading liquidity',
    features: [['Heatmap', 'Every resting order over time, at full depth.'], ['Volume dots', 'Each trade sized and coloured by aggressor.'], ['Add-ons and API', 'Extend it with indicators and tools.'], ['Replay', 'Play back recorded sessions tick by tick.']] },
  { id: 'mw', name: 'MotiveWave', mono: 'MW', version: '7.0.9', sym: 'CLZ6', scene: 'waves', seed: 41,
    view: 'Elliott wave count with Fibonacci retracement',
    tagline: 'Charting and wave analysis, with strategy testing.',
    bestFor: 'Wave and Fibonacci traders',
    features: [['Elliott Wave tools', 'Label and project impulse and corrective waves.'], ['Fibonacci and Gann', 'Retracements, extensions, fans and grids.'], ['Strategy testing', 'Backtest and optimise rule-based strategies.'], ['Java SDK', 'Build your own studies and strategies.']] },
  { id: 'ax', name: 'ATAS X', mono: 'AX', version: '1.2.3', sym: 'NQZ6', scene: 'footprint', variant: 'x', seed: 59,
    view: 'GPU footprint with session volume profile',
    tagline: 'The next ATAS build, on a GPU renderer.',
    bestFor: 'Busy, fast sessions',
    features: [['GPU rendering', 'Footprints stay smooth through the open.'], ['Session profile', 'Volume by price beside the clusters.'], ['Familiar workflow', 'The ATAS way of reading order flow.'], ['Side by side', 'Runs alongside ATAS from the same launcher.']] },
];
const SYMBOLS = { ESZ6: { start: 5872.25, tick: 0.25 }, NQZ6: { start: 20714.5, tick: 0.25 }, CLZ6: { start: 71.42, tick: 0.01 } };
const byId = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ================= Tokens ================= */
const css = getComputedStyle(document.documentElement);
const C = {};
function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
['ground', 'chrome', 'surface', 'raised', 'border', 'rule', 'control', 'text', 'soft', 'muted', 'accent', 'accent-ink', 'positive', 'negative', 'heat-1', 'heat-2', 'heat-3', 'heat-4']
  .forEach(k => { C[k] = css.getPropertyValue('--' + k).trim(); });
C.mono = css.getPropertyValue('--mono').trim();
C.hue = Object.fromEntries(['sc', 'atas', 'bm', 'mw', 'ax'].map(id => [id, css.getPropertyValue('--hue-' + id).trim()]));
C.posBar = rgba(C.positive, 0.32); C.negBar = rgba(C.negative, 0.32);
C.posDot = rgba(C.positive, 0.85); C.negDot = rgba(C.negative, 0.85);
C.gridLine = rgba(C.text, 0.05); C.profile = rgba(C.soft, 0.18);

function mixHex(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
/* Heat ramp: thin liquidity stays navy, walls of size glow in the platform's hue. */
const lutCache = new Map();
function makeLut(hue = C.accent) {
  if (lutCache.has(hue)) return lutCache.get(hue);
  const stops = [C.ground, C['heat-1'], mixHex(C['heat-2'], hue, 0.45), hue, mixHex(hue, '#ffffff', 0.72)].map(hexToRgb);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f;
  }
  lutCache.set(hue, lut);
  return lut;
}
const lutColor = (lut, v) => { const i = (Math.max(0, Math.min(1, v)) * 255 | 0) * 3; return `rgb(${lut[i]},${lut[i + 1]},${lut[i + 2]})`; };

/* ================= Market simulation ================= */
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(i) { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }

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

/* ================= Drawing helpers ================= */
function font(ctx, px, weight = 400) { ctx.font = `${weight} ${px}px ${C.mono}`; }

function priceTag(ctx, x, y, w, text) {
  ctx.fillStyle = C.text; ctx.fillRect(x, y - 9, w, 18);
  ctx.fillStyle = C.ground; font(ctx, 10, 500); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y + 0.5);
}

function rowAxis(ctx, x, w, h, top, rows, rowH, y0, m) {
  ctx.fillStyle = C.ground; ctx.fillRect(x, 0, w, h);
  ctx.fillStyle = C.rule; ctx.fillRect(x, 0, 1, h);
  const every = Math.max(1, Math.ceil(26 / rowH));
  font(ctx, 10); ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
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
  font(ctx, 10); ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r++) {
    const i = top - r, y = y0 + r * rowH, size = m.liq.get(i) || 0;
    if (i === m.mid) { ctx.fillStyle = C.raised; ctx.fillRect(x0 + 1, y, w - 1, rowH); }
    else { ctx.fillStyle = i < m.mid ? C.posBar : C.negBar; ctx.fillRect(barX, y + 1.5, Math.max(1, size / max * barW), rowH - 3); }
    if (!text) continue;
    if (grid.price) { ctx.fillStyle = i === m.mid ? C.text : C.muted; ctx.textAlign = 'left'; ctx.fillText(m.fmt(i), x0 + 8, y + rowH / 2); }
    if (i !== m.mid) { ctx.fillStyle = C.soft; ctx.textAlign = 'right'; ctx.fillText(String(Math.round(size)), x0 + w - 8, y + rowH / 2); }
  }
}

/* ================= Scenes ================= */
class Scene {
  constructor(cv, o) {
    this.cv = cv; this.ctx = cv.getContext('2d'); this.o = o; this.w = 0; this.h = 0; this.acc = 0; this.visible = false; this.dirty = true; this.rate = 10;
    this.hue = o.hue || C.accent; this.lut = makeLut(this.hue);
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.cv.clientWidth; this.h = this.cv.clientHeight;
    this.cv.width = Math.max(1, Math.round(this.w * dpr)); this.cv.height = Math.max(1, Math.round(this.h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.dirty = true;
  }
  tick(dt) {
    this.acc += dt;
    const every = 1000 / this.rate; let n = 0;
    while (this.acc >= every && n < 4) { this.acc -= every; this.step(); n++; }
    if (n === 4) this.acc = 0;
    if (n || this.dirty) { this.draw(); this.dirty = false; }
  }
  render() { if (this.w > 0 && this.h > 0) { this.draw(); this.dirty = false; } }
  settle() {}
}

/* Bookmap-style liquidity heatmap with volume dots, optional DOM */
class Heatmap extends Scene {
  constructor(cv, o) {
    super(cv, o); this.rate = 14;
    this.m = new Market(o.seed, o.sym); this.cols = []; this.maxCols = 260;
    this.off = document.createElement('canvas'); this.offCtx = this.off.getContext('2d');
    this.center = this.m.mid; this.reveal = o.intro && !reduceMotion.matches ? 0 : 1;
    for (let k = 0; k < this.maxCols; k++) this.step();
  }
  step() {
    const tr = this.m.step(), n = this.m.depth * 2 + 1, low = this.m.mid - this.m.depth, data = new Float32Array(n);
    for (let k = 0; k < n; k++) data[k] = this.m.liq.get(low + k) || 0;
    let buy = 0, sell = 0; for (const t of tr) t.buy ? buy += t.size : sell += t.size;
    this.cols.push({ low, data, mid: this.m.mid, buy, sell });
    if (this.cols.length > this.maxCols) this.cols.shift();
    this.o.onStep?.(this.m);
  }
  tick(dt) { if (this.reveal < 1) { this.reveal = Math.min(1, this.reveal + dt / 900); this.dirty = true; } super.tick(dt); }
  settle() { this.reveal = 1; }
  draw() {
    const { ctx, w, h, m } = this;
    ctx.fillStyle = C.ground; ctx.fillRect(0, 0, w, h);
    const axisW = 66, domW = this.o.dom && w > 560 ? Math.min(140, w * 0.2) : 0;
    const plotW = w - axisW - domW;
    const rowH = Math.max(8, Math.min(14, h / 36)), rows = Math.ceil(h / rowH) + 1;
    const margin = Math.floor(rows * 0.25), off = m.mid - this.center;
    if (Math.abs(off) > rows / 2 - margin) this.center += off - Math.sign(off) * (rows / 2 - margin);
    this.center = Math.round(this.center);
    const top = this.center + Math.floor(rows / 2), y0 = (h - rows * rowH) / 2;
    const yOf = i => y0 + (top - i) * rowH + rowH / 2;

    const nCols = Math.max(2, Math.min(this.cols.length, Math.floor(plotW / 3.2)));
    const colW = plotW / nCols, start = this.cols.length - nCols;
    if (this.off.width !== nCols || this.off.height !== rows) { this.off.width = nCols; this.off.height = rows; this.img = this.offCtx.createImageData(nCols, rows); }
    const px = this.img.data, lut = this.lut;
    for (let c = 0; c < nCols; c++) {
      const col = this.cols[start + c];
      for (let r = 0; r < rows; r++) {
        const k = top - r - col.low;
        let v = k >= 0 && k < col.data.length ? col.data[k] / 220 : 0;
        v = v >= 1 ? 1 : Math.pow(v, 0.8);
        const li = (v * 255 | 0) * 3, p = (r * nCols + c) * 4;
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
      ctx.fillStyle = col.buy >= col.sell ? C.posDot : C.negDot; ctx.fill(); ctx.stroke();
    }
    if (this.reveal < 1) {
      const e = 1 - Math.pow(1 - this.reveal, 3);
      ctx.fillStyle = C.ground; ctx.fillRect(plotW * e, 0, plotW * (1 - e) + 2, h);
    }
    rowAxis(ctx, plotW, axisW, h, top, rows, rowH, y0, m);
    if (domW) drawDom(ctx, plotW + axisW, domW, h, m, { rowH, rows, top, y0 });
  }
}

/* ATAS-style footprint: bid × ask per price, delta, optional session profile (ATAS X) */
class Footprint extends Scene {
  constructor(cv, o) {
    super(cv, o); this.x = o.variant === 'x'; this.rate = this.x ? 16 : 10;
    this.m = new Market(o.seed, o.sym, 3); this.candles = []; this.per = this.x ? 34 : 30; this.n = 0;
    this.profile = new Map(); this.center = this.m.mid; this.newCandle();
    for (let k = 0; k < this.per * 9 + 12; k++) this.step();
  }
  newCandle() { const p = this.m.mid; this.candles.push({ o: p, h: p, l: p, c: p, cells: new Map(), delta: 0, vol: 0 }); if (this.candles.length > 14) this.candles.shift(); }
  step() {
    const tr = this.m.step(), cd = this.candles[this.candles.length - 1], p = this.m.mid;
    cd.h = Math.max(cd.h, p); cd.l = Math.min(cd.l, p); cd.c = p;
    for (const t of tr) {
      let cell = cd.cells.get(t.i); if (!cell) cd.cells.set(t.i, cell = { b: 0, a: 0 });
      if (t.buy) { cell.a += t.size; cd.delta += t.size; } else { cell.b += t.size; cd.delta -= t.size; }
      cd.vol += t.size; this.profile.set(t.i, (this.profile.get(t.i) || 0) + t.size);
    }
    if (++this.n % this.per === 0) this.newCandle();
  }
  draw() {
    const { ctx, w, h, m } = this, small = w < 560;
    ctx.fillStyle = C.ground; ctx.fillRect(0, 0, w, h);
    const axisW = 66, profW = this.x && !small ? 96 : 0, deltaH = 44;
    const plotW = w - axisW - profW, plotH = h - deltaH;
    const rowH = small ? 16 : 19, rows = Math.floor(plotH / rowH);
    const margin = Math.floor(rows * 0.28), off = m.mid - this.center;
    if (Math.abs(off) > rows / 2 - margin) this.center = Math.round(this.center + off - Math.sign(off) * (rows / 2 - margin));
    const top = this.center + Math.floor(rows / 2), y0 = (plotH - rows * rowH) / 2;
    const yOf = i => y0 + (top - i) * rowH;

    ctx.fillStyle = C.gridLine;
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
        font(ctx, fs); ctx.textBaseline = 'middle';
        const bidHeavy = c.b > c.a * 2.5 && c.b > 6, askHeavy = c.a > c.b * 2.5 && c.a > 6;
        ctx.textAlign = 'right'; ctx.fillStyle = bidHeavy ? C.negative : C.soft; ctx.fillText(c.b, mid - 6, y + rowH / 2 + 0.5);
        ctx.textAlign = 'center'; ctx.fillStyle = C.muted; ctx.fillText('×', mid, y + rowH / 2 + 0.5);
        ctx.textAlign = 'left'; ctx.fillStyle = askHeavy ? C.positive : C.soft; ctx.fillText(c.a, mid + 6, y + rowH / 2 + 0.5);
      }
      if (poc !== null) { ctx.strokeStyle = C.text; ctx.lineWidth = 1; ctx.strokeRect(cx + 0.5, yOf(poc) + 1.5, cw - 1, rowH - 3); }
      font(ctx, 10); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = cd.delta >= 0 ? C.positive : C.negative;
      ctx.fillText(`Δ ${cd.delta > 0 ? '+' : ''}${cd.delta}`, mid, plotH + 15);
      ctx.fillStyle = C.muted; ctx.fillText(`Vol ${cd.vol}`, mid, plotH + 31);
    });
    ctx.fillStyle = C.rule; ctx.fillRect(0, plotH, plotW + profW, 1);

    if (profW) {
      const px = plotW; let maxP = 1, pocI = null;
      for (let r = 0; r < rows; r++) { const v = this.profile.get(top - r) || 0; if (v > maxP) { maxP = v; pocI = top - r; } }
      ctx.fillStyle = C.chrome; ctx.fillRect(px, 0, profW, h);
      for (let r = 0; r < rows; r++) {
        const i = top - r, v = this.profile.get(i) || 0; if (!v) continue;
        ctx.fillStyle = i === pocI ? this.hue : C.profile;
        ctx.fillRect(px + 6, y0 + r * rowH + 2, (profW - 14) * v / maxP, rowH - 4);
      }
      font(ctx, 10); ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.fillText('Session', px + 6, plotH + 15);
    }
    rowAxis(ctx, plotW + profW, axisW, h, top, rows, rowH, y0, m);
  }
}

/* Sierra Chart-style candles, SMA and a trading DOM */
class Candles extends Scene {
  constructor(cv, o) {
    super(cv, o); this.rate = 10;
    this.m = new Market(o.seed, o.sym); this.per = 7; this.n = 0; this.candles = []; this.newCandle();
    for (let k = 0; k < this.per * 130; k++) this.step();
  }
  newCandle() { const p = this.m.mid; this.candles.push({ o: p, h: p, l: p, c: p, v: 0 }); if (this.candles.length > 200) this.candles.shift(); }
  step() {
    const tr = this.m.step(), cd = this.candles[this.candles.length - 1], p = this.m.mid;
    cd.h = Math.max(cd.h, p); cd.l = Math.min(cd.l, p); cd.c = p; for (const t of tr) cd.v += t.size;
    if (++this.n % this.per === 0) this.newCandle();
  }
  draw() {
    const { ctx, w, h, m } = this, small = w < 560;
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
    font(ctx, 10); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let i = Math.ceil(this.lo / gstep) * gstep; i <= this.hi; i += gstep) {
      ctx.fillStyle = C.gridLine; ctx.fillRect(0, Math.round(y(i)), plotW, 1);
      ctx.fillStyle = C.muted; ctx.fillText(m.fmt(i), plotW + 8, y(i));
    }
    const xOf = k => plotW - 12 - (n - k) * step;
    vis.forEach((c, k) => {
      const x = xOf(k), up = c.c >= c.o;
      ctx.fillStyle = up ? C.positive : C.negative;
      ctx.fillRect(x + Math.floor(bw / 2), y(c.h), 1, Math.max(1, y(c.l) - y(c.h)));
      ctx.fillRect(x, y(Math.max(c.o, c.c)), bw, Math.max(1, Math.abs(y(c.o) - y(c.c))));
      const vh = c.v / maxV * (volH - 6);
      ctx.fillStyle = k === n - 1 ? (up ? C.posBar : C.negBar) : C.profile;
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

/* MotiveWave-style Elliott count with Fibonacci retracement, drawn bar by bar */
class Waves extends Scene {
  constructor(cv, o) {
    super(cv, o); this.rate = 14; this.loop = 0; this.build();
    this.shown = o.intro === false || reduceMotion.matches ? this.N : Math.floor(this.N * 0.55);
  }
  build() {
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
  settle() { this.shown = this.N; }
  step() {
    if (this.shown < this.N) this.shown++;
    else if (++this.hold > 40) { this.loop++; this.build(); this.shown = Math.floor(this.N * 0.3); }
  }
  draw() {
    const { ctx, w, h } = this, small = w < 560;
    ctx.fillStyle = C.ground; ctx.fillRect(0, 0, w, h);
    const axisW = 66, plotW = w - axisW, padT = 34, padB = 26, ph = h - padT - padB;
    const y = v => padT + (1.06 - v) / 1.14 * ph, cw = (plotW - 16) / this.N, x = k => 8 + k * cw + cw / 2;
    const price = v => (this.base + v * this.range).toFixed(2);

    font(ctx, 10); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= 1.001; v += 0.25) { ctx.fillStyle = C.gridLine; ctx.fillRect(0, Math.round(y(v)), plotW, 1); ctx.fillStyle = C.muted; ctx.fillText(price(v), plotW + 8, y(v)); }
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
      font(ctx, 10, 500); ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.fillText(p.l, x(p.k), ly + 0.5);
    });
    font(ctx, 10); ctx.textAlign = 'left'; ctx.fillStyle = C.muted;
    ctx.fillText('Impulse 1–5 · Correction A–B–C · Fib 0 → 5', 10, 16);
  }
}

const SCENES = { heatmap: Heatmap, footprint: Footprint, candles: Candles, waves: Waves };

/* ================= Scene runner ================= */
const live = new Map(); // canvas -> scene
const ro = new ResizeObserver(entries => { for (const e of entries) { const s = live.get(e.target); if (s) { s.resize(); s.render(); } } });
const io = new IntersectionObserver(entries => { for (const e of entries) { const s = live.get(e.target); if (s) s.visible = e.isIntersecting; } }, { rootMargin: '80px' });

function mount(canvas, type, opts) {
  const prev = live.get(canvas); if (prev) { ro.unobserve(canvas); io.unobserve(canvas); }
  const s = new SCENES[type](canvas, opts);
  if (reduceMotion.matches) s.settle();
  live.set(canvas, s); s.resize(); s.render(); ro.observe(canvas); io.observe(canvas);
  return s;
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(100, now - last); last = now;
  if (!reduceMotion.matches && !document.hidden) for (const s of live.values()) if (s.visible) s.tick(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
reduceMotion.addEventListener('change', () => { for (const s of live.values()) { s.settle(); s.render(); } });
document.fonts?.ready.then(() => { for (const s of live.values()) s.render(); });

/* Hero */
const heroCanvas = $('[data-scene="heatmap"][data-ticker="hero"]');
if (heroCanvas) {
  const pxEl = $('[data-hero-price]'), chEl = $('[data-hero-chg]'); let lastT = 0;
  mount(heroCanvas, 'heatmap', {
    seed: 7, sym: 'ESZ6', dom: true, hue: C.hue.bm, intro: document.documentElement.classList.contains('motion'),
    onStep(m) {
      const now = performance.now(); if (now - lastT < 250) return; lastT = now;
      const d = (m.mid - m.start) * m.tick;
      pxEl.textContent = m.fmt(m.mid);
      chEl.textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
      chEl.className = 'terminal__chg mono ' + (d >= 0 ? 'is-up' : 'is-down');
    },
  });
}

/* ================= Cart ================= */
const KEY = 'tradebay.cart';
let cart = new Set();
try { cart = new Set((JSON.parse(localStorage.getItem(KEY)) || []).filter(id => byId[id])); } catch { /* fresh cart */ }
const cartDlg = $('[data-cart]');
const toastEl = $('[data-toast]');
let toastTimer;

function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('is-on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2200); }
function save() { try { localStorage.setItem(KEY, JSON.stringify([...cart])); } catch { /* private mode */ } }

function renderCart() {
  const n = cart.size;
  $('[data-cart-count]').textContent = n;
  $('[data-open-cart]').setAttribute('aria-label', `Open cart, ${n} item${n === 1 ? '' : 's'}`);
  $('[data-cart-items]').innerHTML = [...cart].map(id => {
    const p = byId[id];
    return `<li class="cart__item"><span class="tab__tile">${p.mono}</span><span>${p.name}<small>Lifetime licence · v${p.version}</small></span><span class="mono">${money(CONFIG.price)}</span><button class="cart__remove" type="button" data-remove="${id}" aria-label="Remove ${p.name}">Remove</button></li>`;
  }).join('');
  $('[data-cart-total]').textContent = money(n * CONFIG.price);
  cartDlg.classList.toggle('is-empty', n === 0);
  $$('[data-add]').forEach(b => setAddState(b, cart.has(b.dataset.add)));
  const cur = $('[data-add-current]'); if (cur) setAddState(cur, cart.has(cur.dataset.id));
  const all = $('[data-add-all]'); if (all) { const full = n === PLATFORMS.length; all.textContent = full ? 'View cart' : 'Add all'; all.classList.toggle('is-added', full); }
}
function setAddState(btn, inCart) {
  btn.classList.toggle('is-added', inCart);
  btn.textContent = inCart ? (btn.dataset.added || 'In cart · View') : (btn.dataset.label || 'Add to cart');
}
function add(id) {
  if (cart.has(id)) { openCart(); return; }
  cart.add(id); save(); renderCart(); bump(); toast(`${byId[id].name} added to cart`);
}
function bump() { const b = $('[data-open-cart]'); b.classList.remove('is-bumped'); void b.offsetWidth; b.classList.add('is-bumped'); }
function openCart() { if (!cartDlg.open) cartDlg.showModal(); }
function closeCart() { if (cartDlg.open) cartDlg.close(); }

document.addEventListener('click', e => {
  const t = e.target.closest('button, a'); if (!t) return;
  if (t.matches('[data-open-cart]')) openCart();
  else if (t.matches('[data-close-cart]')) closeCart();
  else if (t.matches('[data-add]')) add(t.dataset.add);
  else if (t.matches('[data-add-current]')) add(t.dataset.id);
  else if (t.matches('[data-add-all]')) {
    if (cart.size === PLATFORMS.length) { openCart(); return; }
    PLATFORMS.forEach(p => cart.add(p.id)); save(); renderCart(); bump(); toast('All five platforms added');
  }
  else if (t.matches('[data-remove]')) { cart.delete(t.dataset.remove); save(); renderCart(); }
  else if (t.matches('[data-checkout]')) {
    if (!cart.size) return;
    location.href = `${CONFIG.checkoutUrl}?items=${encodeURIComponent([...cart].join(','))}`;
  }
  else if (t.matches('[data-pick]')) select(t.dataset.pick, false);
});
cartDlg.addEventListener('click', e => { // click on the backdrop closes
  if (e.target !== cartDlg) return;
  const r = cartDlg.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeCart();
});

/* ================= Pricing ledger ================= */
$('[data-ledger]').innerHTML = PLATFORMS.map(p => `
  <div class="ledger__row" role="row">
    <span role="cell" class="ledger__name"><span class="tab__tile">${p.mono}</span>${p.name}</span>
    <span role="cell" class="ledger__ver mono">v${p.version}</span>
    <span role="cell" class="ledger__lic">Lifetime</span>
    <span role="cell" class="ledger__amt mono">${money(CONFIG.price)}</span>
    <span role="cell"><button class="btn btn--ghost btn--sm" type="button" data-add="${p.id}" data-label="Add" data-added="In cart" aria-label="Add ${p.name} to cart">Add</button></span>
  </div>`).join('');
$('[data-all-price]').textContent = money(CONFIG.price * PLATFORMS.length);

/* ================= Showcase tabs ================= */
const showcase = $('.showcase'), tabsEl = $('[data-tabs]'), panel = $('[data-panel]'), showCanvas = $('[data-showcase]'), detail = $('.detail');
tabsEl.innerHTML = PLATFORMS.map((p, k) => `
  <button class="tab" role="tab" id="tab-${p.id}" aria-controls="platform-panel" aria-selected="${k === 0}" tabindex="${k === 0 ? 0 : -1}" data-tab="${p.id}" style="--tab-hue: var(--hue-${p.id})">
    <span class="tab__tile">${p.mono}</span>
    <span class="tab__name">${p.name}<small>${p.bestFor}</small></span>
    <span class="tab__price">${money(CONFIG.price)}</span>
  </button>`).join('');
panel.id = 'platform-panel';
let current = null;

function select(id, focus) {
  if (id === current) return;
  const p = byId[id]; current = id;
  $$('.tab', tabsEl).forEach(t => { const on = t.dataset.tab === id; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
  panel.setAttribute('aria-labelledby', `tab-${id}`);
  showcase.style.setProperty('--hue', C.hue[id]);
  $$('[data-pick]').forEach(c => c.setAttribute('aria-pressed', c.dataset.pick === id));
  const vals = { ...p, verLabel: `v${p.version}`, price: money(CONFIG.price) };
  $$('[data-p]', panel).forEach(el => {
    const k = el.dataset.p;
    if (k === 'features') el.innerHTML = p.features.map(([t, d]) => `<li><b>${t}</b>${d}</li>`).join('');
    else el.textContent = vals[k];
  });
  const cur = $('[data-add-current]'); cur.dataset.id = id; cur.dataset.label = `Add ${p.name} · ${money(CONFIG.price)}`;
  setAddState(cur, cart.has(id));
  detail.classList.remove('is-swapping'); void detail.offsetWidth; detail.classList.add('is-swapping');
  const swap = () => { mount(showCanvas, p.scene, { seed: p.seed, sym: p.sym, variant: p.variant, hue: C.hue[id], intro: true }); showCanvas.style.opacity = 1; };
  if (reduceMotion.matches || !live.has(showCanvas)) swap();
  else { showCanvas.style.opacity = 0; setTimeout(swap, 150); }
}
showCanvas.style.transition = 'opacity 150ms ease-out';
tabsEl.addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) select(t.dataset.tab, false); });
tabsEl.addEventListener('keydown', e => {
  const ids = PLATFORMS.map(p => p.id), i = ids.indexOf(current);
  const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault(); select(ids[(next + ids.length) % ids.length], true);
});
select(PLATFORMS[0].id, false);
renderCart();

/* ================= Hero wall + scroll scene ================= */
$$('[data-wall-scene]').forEach(cv => {
  const p = byId[cv.dataset.wallScene];
  mount(cv, p.scene, { seed: p.seed + 100, sym: p.sym, variant: p.variant, hue: C.hue[p.id], intro: false });
});

const hero = $('[data-hero]'), stage = $('[data-stage]'), heroCopy = $('[data-hero-copy]'), caption = $('[data-wall-caption]');
const slots = $$('[data-wall-slot]').sort((a, b) => a.dataset.wallSlot - b.dataset.wallSlot);
const sceneMQ = matchMedia('(min-width: 1081px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)');
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const ease = t => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;
let geo = null, sceneQueued = false;

function layoutScene() {
  const on = sceneMQ.matches;
  hero.classList.toggle('is-scene', on);
  [heroCopy, caption, ...slots].forEach(el => { el.style.transform = ''; el.style.opacity = ''; el.style.width = ''; el.style.visibility = ''; });
  geo = null;
  if (!on) return;
  const st = stage.getBoundingClientRect(), r = slots[0].getBoundingClientRect();
  const W = st.width, H = st.height;
  const pw = Math.min(W * 0.25, 380), big = pw * 1.32;
  geo = {
    W, H, pw,
    nat: { x: r.left + r.width / 2 - st.left, y: r.top + r.height / 2 - st.top, w: r.width },
    big, dx: Math.min(W * 0.29, big / 2 + pw / 2 + 60), dy: H * 0.22,
  };
  slots.slice(1).forEach(el => { el.style.width = `${pw}px`; });
  sceneQueued = false;
  renderScene();
}

function renderScene() {
  sceneQueued = false;
  if (!geo) return;
  const { W, H, nat, big, dx, dy } = geo;
  const span = hero.offsetHeight - stage.offsetHeight;
  const p = clamp01(-hero.getBoundingClientRect().top / Math.max(1, span));
  const e1 = ease(clamp01(p / 0.38));           // copy leaves, heatmap pulls back and tilts
  const e3 = ease(clamp01((p - 0.7) / 0.26));   // wall flattens
  const tilt = e1 * (1 - e3), rx = 16 * tilt, ry = -20 * tilt;

  heroCopy.style.opacity = 1 - e1;
  heroCopy.style.transform = `translate3d(${-60 * e1}px, ${-30 * e1}px, 0)`;
  heroCopy.style.visibility = e1 > 0.98 ? 'hidden' : '';

  const s0 = lerp(1, big / nat.w, e1);
  const tx = (W / 2 - nat.x) * e1, ty = (H / 2 - 12 - nat.y) * e1;
  if (p > 0) {
    slots[0].style.animation = 'none'; // a running load animation would hold transform; the scene owns it from here
    slots[0].style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s0}) rotateX(${rx}deg) rotateY(${ry}deg)`;
  } else slots[0].style.transform = '';

  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  slots.slice(1).forEach((el, i) => {
    const e2 = ease(clamp01((p - 0.14 - i * 0.07) / 0.36));
    const [sx, sy] = corners[i];
    const x = sx * dx * lerp(0.35, 1, e2) * (1 + 0.04 * e3), y = sy * dy * lerp(0.35, 1, e2) - 12;
    const z = lerp(-1700, -160, e2) * (1 - e3);
    el.style.opacity = e2;
    el.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg)`;
  });
  caption.style.opacity = e3;
  caption.style.transform = `translateY(${(1 - e3) * 12}px)`;
}

function queueScene() { if (geo && !sceneQueued) { sceneQueued = true; requestAnimationFrame(renderScene); } }
addEventListener('scroll', queueScene, { passive: true });
let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layoutScene, 120); });
sceneMQ.addEventListener('change', layoutScene);
slots[0].addEventListener('animationend', layoutScene, { once: true });
layoutScene();
document.fonts?.ready.then(layoutScene);

/* ================= Chrome ================= */
const nav = $('.nav');
const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true }); onScroll();

const wm = $('[data-wordmark]');
if (wm && !reduceMotion.matches) {
  const wio = new IntersectionObserver(([e]) => { if (e.isIntersecting) { wm.classList.add('is-drawing'); wio.disconnect(); } }, { threshold: 0.4 });
  wio.observe(wm);
}
})();
