// Trade Bay — three fast 15s videos built for TikTok's UI. Rules baked in:
//  * Safe zone: all text/buttons inside x 70-920, y 230-1400 (top bar, right buttons, caption area stay clear).
//  * Max 6 things on screen at once; one caption (<=5 words) at a time.
//  door   : price -> icon ring -> icon floods the screen in its colour -> that app's live chart (match cuts) -> grid -> Discord
//  shatter: $149.99 cracks, shatters into candles that become the live ATAS X chart -> push-ins -> card flip -> Discord
//  domino : cards tip over like dominoes, camera tracking; each lights up with its platform -> blue ripple -> Discord
// Usage: node render_fast.js <door|shatter|domino> [SMOKE=1 TIMES=..]   then  GAIN=2.6 node assemble_short.js fast_<name>
const E = require('./engines.js');
const { W, H, APPS, clamp01, lerp, rr, ico, loadIco, setIco, LOGOS, tile, rnd, createCanvas, GlobalFonts, FF } = E;
const { loadImage } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');

const NAME = process.argv[2];
if (!['door', 'shatter', 'domino'].includes(NAME)) { console.error('usage: node render_fast.js <door|shatter|domino>'); process.exit(1); }
const OUTN = `fast_${NAME}`, FPS = 60, DUR = 15, FRAMES = DUR * FPS, SMOKE = !!process.env.SMOKE, PRICE = '$149.99';
const CX = 495; // centre of the safe column (x 70-920)
// Reasons to join: the confirmed placeholders, plus the free hook where the video is the free pitch.
const MSGS = NAME === 'shatter' ? ['Find out how to get it free.', 'Setup help, live.', 'Updates first.'] : ['Not sure which to pick? Ask.', 'Setup help, live.', 'Updates first.'];
mkdirSync('out', { recursive: true }); mkdirSync('qc', { recursive: true });

GlobalFonts.registerFromPath('fonts/HankenGrotesk-400.ttf', 'Hanken');
GlobalFonts.registerFromPath('fonts/HankenGrotesk-500.ttf', 'Hanken');
const K = { bg: '#0b0b0e', surf: '#17171c', raise: '#1f1f25', text: '#f2f2f0', muted: '#9a9ca4', green: '#5fc39c', red: '#e5566f', discord: '#5865F2' };
const F5 = s => `500 ${s}px Hanken`, F4 = s => `400 ${s}px Hanken`;

/* ---------- motion ---------- */
function spr(t, [response, damping]) {
  if (t <= 0) return 0;
  const w0 = 2 * Math.PI / response;
  if (damping >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + (damping * w0 / wd) * Math.sin(wd * t));
}
const CALM = [0.5, 1], POP = [0.42, 0.6], SOFT = [0.6, 0.95], SLAM = [0.3, 0.6], DROP = [0.5, 0.55];
const smooth = x => x * x * (3 - 2 * x), outCubic = x => 1 - Math.pow(1 - x, 3), inCubic = x => x * x * x;
const inOut = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const ease = (t, a, b, f = smooth) => f(clamp01((t - a) / (b - a)));

/* ---------- drawing helpers ---------- */
const R = (g, x, y, w, h, r) => { if (w < 1 || h < 1) { g.beginPath(); return; } rr(g, x, y, w, h, Math.max(0, r)); };
function T(g, s, x, y, font, fill, align = 'left', ls = 0) { g.font = font; g.fillStyle = fill; g.textAlign = align; g.textBaseline = 'middle'; g.letterSpacing = `${ls}px`; g.fillText(s, x, y); g.letterSpacing = '0px'; }
function wrap(g, s, font, maxW) {
  g.font = font; g.letterSpacing = '0px'; const out = []; let line = '';
  for (const w of s.split(' ')) { const t2 = line ? line + ' ' + w : w; if (g.measureText(t2).width > maxW && line) { out.push(line); line = w; } else line = t2; }
  return [...out, line];
}
function fitSize(g, s, size, maxW) { g.font = F5(size); g.letterSpacing = '0px'; const w = g.measureText(s).width; return w > maxW ? Math.floor(size * maxW / w) : size; }
function fadeIn(g, k, dy = 28) { g.globalAlpha *= clamp01(k / 0.2); g.translate(0, dy * (1 - spr(k, CALM))); }
function captions(g, t, CAPS) { // one caption at a time, centred in the safe column, y 300
  for (const [a, b, s, col = K.text] of CAPS) {
    const k = t - a, o = t - (b - 0.12); if (k <= 0 || o > 0.3) continue;
    g.save(); fadeIn(g, k, 30);
    if (o > 0) { const e = ease(o, 0, 0.28); g.globalAlpha *= 1 - e; g.translate(0, -36 * e); }
    const sz = fitSize(g, s, 74, 850);
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 18; T(g, s, CX, 300, F5(sz), col, 'center', -sz * 0.02); g.restore();
  }
}
const ORD = ['ax', 'atas', 'bm', 'mw', 'dc', 'sc', 'jig'], A = Object.fromEntries(APPS.map(a => [a.id, a]));
function appIcon(g, a, x, y, s) { tile(g, x, y, s, a.hue, a.letters, s * 0.3); }
function view(g, img, cx, cy, zz, dx, dy, dw, dh) { // draw a window onto the chart: centre (cx,cy) in source px, zoom zz
  const sh = img.height / zz, sw = Math.min(img.width, sh * dw / dh), sh2 = sw * dh / dw;
  const sx = Math.max(0, Math.min(img.width - sw, cx - sw / 2)), sy = Math.max(0, Math.min(img.height - sh2, cy - sh2 / 2));
  g.drawImage(img, sx, sy, sw, sh2, dx, dy, dw, dh);
}
function shadeV(g, y0, y1, a0, a1) { const l = g.createLinearGradient(0, y0, 0, y1); l.addColorStop(0, `rgba(11,11,14,${a0})`); l.addColorStop(1, `rgba(11,11,14,${a1})`); g.fillStyle = l; g.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0)); }

/* ---------- live charts ---------- */
const EL = 680, DPR = 2, ENG = {};
for (const a of APPS) {
  const cv = createCanvas(EL * DPR, EL * DPR);
  const Maker = { footprint: E.Footprint, heatmap: E.Heatmap, candles: E.Candles, waves: E.Waves }[a.scene];
  const sc = new Maker({ seed: a.seed, sym: a.sym, hue: a.hue, dom: a.dom, variant: a.variant }, EL, EL);
  sc.ctx = cv.getContext('2d'); sc.w = EL; sc.h = EL;
  if (a.id === 'ax') { sc.per = 55; for (let k = 0; k < 275; k++) sc.step(); }
  ENG[a.id] = { cv, sc, last: -1 };
}
let FRAME = 0;
function chart(id) { const e = ENG[id]; if (e.last !== FRAME) { e.sc.step(); e.sc.ctx.setTransform(DPR, 0, 0, DPR, 0, 0); e.sc.draw(); e.last = FRAME; } return e.cv; }

/* ---------- Discord ending: 3 messages + button (+ the caption) = 5 things ---------- */
function chat(g, t, a0, onBlue = false) {
  const ink = onBlue ? '#fff' : K.text, sub = onBlue ? 'rgba(255,255,255,0.7)' : K.muted;
  let y = 460;
  MSGS.forEach((m, i) => {
    const k = t - (a0 + 0.3 + i * 0.6), lines = wrap(g, m, F4(46), 700);
    if (k > 0) {
      g.save(); fadeIn(g, k, 40);
      g.save(); g.beginPath(); g.arc(70 + 40, y + 40, 40, 0, 7); g.clip(); ico(g, 70, y, 80); g.restore();
      T(g, 'Trade Bay', 180, y + 16, F5(40), ink); g.font = F5(40); T(g, 'Today', 200 + g.measureText('Trade Bay').width, y + 18, F4(30), sub);
      lines.forEach((l, j) => T(g, l, 180, y + 72 + j * 56, F4(46), ink));
      g.restore();
    }
    y += 100 + lines.length * 56;
  });
  const k = t - (a0 + 2.2); if (k <= 0) return;
  const s = spr(k, POP) * (1 + 0.025 * Math.sin(Math.max(0, k - 0.6) * Math.PI * 2.4));
  g.save(); g.translate(CX, 1250); g.scale(s, s);
  R(g, -425, -70, 850, 140, 24); g.fillStyle = onBlue ? '#fff' : K.discord; g.fill();
  T(g, 'Join the Discord. Link in bio.', 0, 2, F5(46), onBlue ? K.discord : '#fff', 'center'); g.restore();
}

/* ================= door ================= */
const LX = 125, LY = 1200, FR = 2300, S2 = 2.6, SD = 6.6 / 7, sS = i => S2 + SD * i;
function ringPos(i, t) { const an = (-90 + i * 360 / 7) * Math.PI / 180 + 2 * Math.PI * 1.1 * ease(t, 1.2, 2.2, outCubic), r = 300 * spr(t - 1.25 - 0.03 * i, POP); return [CX + Math.cos(an) * r, 815 + Math.sin(an) * r]; }
function doorWorld(g, t) {
  if (t < 1.45) { // price slam
    const s = (1.4 - 0.4 * spr(t - 0.05, SLAM)) * (1 - ease(t, 1.2, 1.45, inCubic));
    if (s > 0.01) { g.save(); g.globalAlpha = clamp01((t - 0.05) / 0.05); g.translate(CX, 815); g.scale(s, s); T(g, PRICE, 0, 0, F5(200), K.text, 'center', -9); g.restore(); }
  }
  if (t >= 1.2 && t < 2.62) { // ring of icons; ATAS X flies to the lockup corner
    ORD.forEach((id, i) => {
      let [x, y] = ringPos(i, t), s = 130; const e = ease(t, 2.0, 2.38);
      if (i === 0) { x = lerp(x, LX, e); y = lerp(y, LY, e); s = lerp(130, 110, e); } else s *= 1 - e;
      if (s > 2) appIcon(g, A[id], x - s / 2, y - s / 2, s);
    });
  }
  if (t >= S2 && t < 9.25) {
    const i = Math.min(6, Math.floor((t - S2) / SD)), a = A[ORD[i]], lt = t - sS(i);
    g.save(); const z = 1 + 0.07 * lt / SD; g.translate(540, 960); g.scale(z, z); g.translate(-540, -960);
    view(g, chart(a.id), 680, 700, 1, 0, 0, W, H); g.restore();
    shadeV(g, 1000, 1400, 0, 0.8); shadeV(g, 0, 380, 0.55, 0);
    appIcon(g, a, LX - 55, LY - 55, 110);
    g.save(); const k = lt - 0.15; g.globalAlpha = clamp01(k / 0.15); g.translate(-60 * (1 - spr(k, CALM)), 0);
    g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 16; T(g, a.name, 200, LY + 3, F5(fitSize(g, a.name, 84, 700)), K.text); g.restore();
  }
  if (t >= 9.2 && t < 11.45) { // all seven live charts + the price, then they collapse
    const cl = ease(t, 11.1, 11.4, inCubic);
    for (let k = 0; k < 8; k++) {
      const c = k % 2, r = Math.floor(k / 2), x = 70 + c * 430, y = 370 + r * 260, w = 410, h = 240;
      const kk = t - (k === 7 ? 9.9 : 9.25 + 0.07 * k); if (kk <= 0) continue;
      const s = (k === 7 ? 1 : spr(kk, POP)) * (1 - cl), ox = lerp(x + w / 2, CX, cl), oy = lerp(y + h / 2, 815, cl) + (k === 7 ? -(1 - spr(kk, DROP)) * 700 : 0);
      if (s < 0.02) continue;
      g.save(); g.translate(ox, oy); g.scale(s, s); g.translate(-w / 2, -h / 2);
      R(g, 0, 0, w, h, 18);
      if (k === 7) { g.fillStyle = K.green; g.fill(); T(g, PRICE, w / 2, h / 2 + 2, F5(66), K.bg, 'center', -2); }
      else { g.save(); g.clip(); view(g, chart(ORD[k]), 680, 680, 1, 0, 0, w, h); g.restore(); g.lineWidth = 3; g.strokeStyle = A[ORD[k]].hue; R(g, 0, 0, w, h, 18); g.stroke(); }
      g.restore();
    }
  }
  // match-cut floods: the next app's colour grows out of its icon, swallows the frame, then recedes to reveal its chart
  for (let i = 0; i < 7; i++) {
    const s = sS(i); let r = 0;
    if (t >= s - 0.22 && t < s) r = FR * ease(t, s - 0.22, s); else if (t >= s && t < s + 0.22) r = FR * (1 - ease(t, s, s + 0.22));
    if (r <= 1) continue;
    g.beginPath(); g.arc(LX, LY, r, 0, 7); g.fillStyle = A[ORD[i]].hue; g.fill();
    const sc = clamp01(r / 150) * (1 + 0.35 * Math.sin(Math.PI * clamp01(r / FR * 3)));
    g.save(); g.translate(LX, LY); g.scale(sc, sc); appIcon(g, A[ORD[i]], -55, -55, 110); g.restore();
  }
  if (t >= 11.4) chat(g, t, 11.4);
}
const DOOR = {
  caps: [[0, 2.0, '7 pro platforms.'], [S2, S2 + 1.0, 'Lifetime licence.'], [sS(6), sS(6) + 1.0, 'Lifetime licence.'], [9.3, 11.4, 'Paid once.'], [11.4, 15.5, 'Questions? Ask on Discord.']],
  world: doorWorld,
  sfx: () => [['boom', 0.05], ['whoosh', 1.2], ...ORD.map((_, i) => ['tick', 1.3 + 0.05 * i]), ...ORD.flatMap((_, i) => [['whoosh', sS(i) - 0.22], ['pop', sS(i)]]),
    ...ORD.map((_, i) => ['tick', 9.3 + 0.07 * i]), ['boom', 9.95], ['whoosh', 11.1], ...MSGS.map((_, i) => ['notif', 11.7 + i * 0.6]), ['pop', 13.6], ['chime', 13.65]],
};

/* ================= shatter ================= */
const bm = createCanvas(900, 320), bmg = bm.getContext('2d');
bmg.fillStyle = K.text; bmg.font = F5(200); bmg.textAlign = 'center'; bmg.textBaseline = 'middle'; bmg.letterSpacing = '-9px'; bmg.fillText(PRICE, 450, 160);
const PX0 = CX - 450, PY0 = 655, CW_ = 75, CH_ = 80, COLS = 12, ROWS = 4, TS = 1.5;
const CRACK = [[300, 640], [385, 725], [350, 795], [445, 855], [405, 935], [500, 990]];
const BARS = (() => { let y = 1050; return [...Array(14)].map((_, k) => { const o = y, c = y - 20 - (rnd(k * 3.1 + 1) - 0.42) * 130; y = c; return { o, c }; }); })();
function ax2view(t) { // push-in keyframes on the live ATAS X footprint: [zoom, cx, cy]
  const a = [1, 680, 680], b = [1.5, 560, 700], c = [2.0, 1090, 820], p = spr(t - 4.2, [0.5, 0.9]), q = spr(t - 5.3, [0.5, 0.9]);
  return [0, 1, 2].map(j => a[j] + (b[j] - a[j]) * p + (c[j] - b[j]) * q);
}
function shatterWorld(g, t) {
  if (t < TS) { // slam + crack
    const s = 1.4 - 0.4 * spr(t - 0.05, SLAM), shk = t > 1.3 ? (Math.random() - 0.5) * 0 : 0;
    g.save(); g.globalAlpha = clamp01((t - 0.05) / 0.05); g.translate(CX, 815); g.scale(s, s); g.translate(-CX, -815); g.drawImage(bm, PX0, PY0); g.restore();
    const f = ease(t, 0.55, 1.3); if (f > 0) {
      g.save(); g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); g.moveTo(...CRACK[0]);
      const n = (CRACK.length - 1) * f, full = Math.floor(n);
      for (let k = 1; k <= full; k++) g.lineTo(...CRACK[k]);
      if (full < CRACK.length - 1) { const [x0, y0] = CRACK[full], [x1, y1] = CRACK[full + 1], e = n - full; g.lineTo(lerp(x0, x1, e), lerp(y0, y1, e)); }
      g.stroke(); g.restore();
    }
  }
  // live chart rises behind the candles
  const ca = ease(t, 2.9, 3.5) * (t < 7.5 ? 1 : 0);
  if (ca > 0 && t < 7.5) {
    const [zz, cx, cy] = ax2view(t), s = 1 + 0.25 * (1 - spr(t - 2.9, SOFT));
    g.save(); g.globalAlpha = ca; g.translate(540, 960); g.scale(s, s); g.translate(-540, -960); view(g, chart('ax'), cx, cy, zz, 0, 0, W, H); g.restore();
    if (t > 3.5) { shadeV(g, 0, 440, 0.7, 0); }
  }
  // shards fly and fall
  const tau = t - TS;
  if (tau > 0 && tau < 1.5) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const sd = r * 13 + c * 1.7, cx0 = PX0 + c * CW_ + CW_ / 2, cy0 = PY0 + r * CH_ + CH_ / 2;
    const vx = (c - 5.5) * 95 + (rnd(sd) - 0.5) * 300, vy = -350 - rnd(sd + 5) * 650, w = (rnd(sd + 9) - 0.5) * 14;
    const x = cx0 + vx * tau, y = cy0 + vy * tau + 0.5 * 3400 * tau * tau;
    g.save(); g.globalAlpha = 1 - ease(tau, 0.9, 1.5); g.translate(x, y); g.rotate(w * tau); g.drawImage(bm, c * CW_, r * CH_, CW_, CH_, -CW_ / 2, -CH_ / 2, CW_, CH_); g.restore();
  }
  // candles pop up where the shards land, then dissolve into the live chart
  if (t > 1.8 && t < 3.6) BARS.forEach((b, k) => {
    const kk = t - (1.8 + 0.06 * k), s = spr(kk, POP); if (s <= 0.01) return;
    const x = 70 + 30 + k * 60.7, up = b.c < b.o, top = Math.min(b.o, b.c), hh = Math.max(34, Math.abs(b.o - b.c)), mid = top + hh / 2;
    g.save(); g.globalAlpha = 1 - ease(t, 3.1, 3.5); g.translate(x, mid); g.scale(1, s); g.fillStyle = up ? K.green : K.red;
    g.fillRect(-2, -hh / 2 - 38, 4, hh + 76); g.fillRect(-20, -hh / 2, 40, hh); g.restore();
  });
  if (t >= 3.5 && t < 7.5) { // name tag
    const k = t - 3.6; g.save(); fadeIn(g, k, 24); appIcon(g, A.ax, 70, 262, 84); T(g, 'ATAS X', 175, 306, F5(68), K.text); g.restore();
  }
  if (t >= 7.5 && t < 9.9) { // chart folds into a card showing the other six
    const p = spr(t - 7.5, SOFT), th = Math.PI * Math.min(1, p), w = lerp(W, 700, p), h = lerp(H, 900, p), cxm = lerp(540, CX, p), cym = lerp(960, 815, p), sx = Math.max(0.001, Math.abs(Math.cos(th)));
    g.save(); g.translate(cxm, cym); g.scale(sx, 1); R(g, -w / 2, -h / 2, w, h, lerp(0, 44, p));
    if (th < Math.PI / 2) { g.save(); g.clip(); const [zz, cx, cy] = ax2view(9); view(g, chart('ax'), cx, cy, zz, -w / 2, -h / 2, w, h); g.restore(); }
    else { g.fillStyle = K.surf; g.fill(); g.lineWidth = 3; g.strokeStyle = K.raise; R(g, -w / 2, -h / 2, w, h, 44); g.stroke(); }
    g.restore();
    if (th >= Math.PI / 2) ORD.slice(1).forEach((id, j) => {
      const k = t - (8.45 + 0.08 * j), s = spr(k, POP); if (s <= 0.01) return;
      const x = CX + (j % 3 - 1) * 200, y = 815 + (Math.floor(j / 3) - 0.5) * 230;
      g.save(); g.translate(x, y); g.scale(s, s); appIcon(g, A[id], -75, -75, 150); g.restore();
    });
  }
  if (t >= 9.8) chat(g, t, 9.8);
}
const SHATTER = {
  caps: [[0, 1.5, 'ATAS X costs this.'], [1.5, 3.5, 'Or get it free.'], [7.7, 9.8, '+6 more platforms'], [9.8, 15.5, 'Want it free?']],
  world: shatterWorld,
  sfx: () => [['boom', 0.05], ['rip', 0.7], ['boom', 1.5], ['whoosh', 1.5], ...BARS.map((_, k) => ['tick', 1.85 + 0.06 * k]), ['whoosh', 2.9], ['whoosh', 4.2], ['pop', 4.3], ['whoosh', 5.3], ['pop', 5.4],
    ['whoosh', 7.5], ['pop', 8.3], ...[0, 1, 2, 3, 4, 5].map(j => ['tick', 8.5 + 0.08 * j]), ...MSGS.map((_, i) => ['notif', 10.1 + i * 0.6]), ['pop', 12.0], ['chime', 12.05]],
};

/* ================= domino ================= */
const DCW = 420, DCH = 640, GAP = 256, SPC = DCW + GAP, GY = 1260, ALPHA = Math.asin(GAP / DCH), T0 = 1.0, DT = 1.15, tI = i => T0 + DT * i, TC = 0.54;
const zoomD = t => lerp(0.42, 1, spr(t - 0.9, [0.6, 0.9]));
function camD(t) { let x = DCW / 2 + 110 + (1 - spr(t - 0.9, [0.6, 0.9])) * SPC * 1.3; for (let i = 1; i < 7; i++) x += SPC * spr(t - (tI(i) - 0.3), [0.55, 0.9]); return x; }
const toScr = (wx, wy, t) => [(wx - camD(t)) * zoomD(t) + CX, (wy - GY) * zoomD(t) + 1260];
const RT = tI(6) + TC + 0.05, RC = toScr(6 * SPC + DCW + DCH * Math.sin(ALPHA), GY - DCH * Math.cos(ALPHA), RT);
function dominoWorld(g, t) {
  const z = zoomD(t);
  if (t < 9.3) {
    g.save(); g.translate(CX, 1260); g.scale(z, z); g.translate(-camD(t), -GY);
    for (let i = 0; i < 7; i++) {
      const id = ORD[i], a = A[id], px = i * SPC + DCW, th = ALPHA * spr(t - tI(i), [1.4, 0.5]);
      const lit = ease(t, tI(i) - 0.55, tI(i) - 0.3) * (1 - ease(t, tI(i) + 0.95, tI(i) + 1.2));
      if (px - camD(t) > 1400 / z + 200 || px - camD(t) < -1400 / z - 200) continue;
      g.save(); g.translate(px, GY); g.rotate(th);
      R(g, -DCW, -DCH, DCW, DCH, 26); g.fillStyle = K.surf; g.fill();
      g.globalAlpha = 0.75 * (1 - lit); appIcon(g, a, -DCW / 2 - 75, -DCH / 2 - 75, 150); g.globalAlpha = 1;
      if (lit > 0.01) {
        g.save(); g.globalAlpha = lit; R(g, -DCW + 20, -DCH + 20, DCW - 40, 410, 14); g.save(); g.clip();
        view(g, chart(id), 680, 680, 1, -DCW + 20, -DCH + 20, DCW - 40, 410); g.restore();
        appIcon(g, a, -DCW + 24, -190, 84); T(g, a.name, -DCW + 122, -146, F5(fitSize(g, a.name, 42, 260)), K.text);
        g.lineWidth = 3; g.strokeStyle = a.hue; R(g, -DCW, -DCH, DCW, DCH, 26); g.stroke(); g.restore();
      }
      g.restore();
      const kc = t - (tI(i) + TC); // impact ring at the contact point
      if (kc > 0 && kc < 0.35) { g.save(); g.globalAlpha = 1 - kc / 0.35; g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(px + DCH * Math.sin(ALPHA), GY - DCH * Math.cos(ALPHA), 20 + kc * 280, 0, 7); g.stroke(); g.restore(); }
    }
    g.restore();
  }
  const r = FR * ease(t, RT, RT + 0.6, inOut);
  if (r > 1) { g.beginPath(); g.arc(RC[0], RC[1], r, 0, 7); g.fillStyle = K.discord; g.fill(); }
  if (t >= 9.4) chat(g, t, 9.4, true);
}
const DOMINO = {
  caps: [[0, 1.2, 'Done with subscriptions?'], [1.2, RT, '7 platforms. One price each.'], [RT + 0.55, 15.5, 'Join the Discord.', '#fff']],
  world: dominoWorld,
  sfx: () => [['whoosh', 0.8], ['boom', T0], ...ORD.flatMap((_, i) => [['pop', tI(i) + 0.02], ['tick', tI(i) + TC]]), ['boom', RT], ['whoosh', RT], ...MSGS.map((_, i) => ['notif', 9.7 + i * 0.6]), ['pop', 11.6], ['chime', 11.65]],
};

/* ---------- frame ---------- */
const V = { door: DOOR, shatter: SHATTER, domino: DOMINO }[NAME];
function drawWorld(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = K.bg; g.fillRect(0, 0, W, H);
  V.world(g, t); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  captions(g, t, V.caps);
}
const N = 5, SHUT = 1 / 120;
const out = createCanvas(W, H), o = out.getContext('2d'), TMP = createCanvas(W, H), tg = TMP.getContext('2d');
function renderFrame(f) {
  FRAME = f;
  for (let k = 0; k < N; k++) { drawWorld(tg, Math.max(0, f / FPS - SHUT * k / (N - 1))); o.globalAlpha = 1 / (k + 1); o.drawImage(TMP, 0, 0); }
  o.globalAlpha = 1;
}
writeFileSync(`out/timeline_${OUTN}.json`, JSON.stringify({ dur: DUR, events: V.sfx().map(([n, a]) => [n, +Math.max(0, a).toFixed(3)]) }, null, 1));

(async () => {
  setIco(await loadIco());
  for (const a of APPS) LOGOS[a.letters] = await loadImage(`icons/${a.id}.png`);
  if (SMOKE) {
    const defs = { door: '0.4,1.0,1.6,2.1,2.5,2.7,3.3,5.0,7.0,8.4,9.5,10.2,11.2,12.2,14.0', shatter: '0.3,0.9,1.35,1.7,2.2,3.0,3.8,4.6,5.8,7.0,7.8,8.9,10.6,12.5,14.0',
      domino: '0.5,1.1,1.7,2.5,3.6,4.9,6.3,7.7,8.4,8.8,9.8,10.6,12.0,14.0' };
    const ts = (process.env.TIMES || defs[NAME]).split(',');
    for (const s of ts) {
      const f = Math.round(+s * FPS); renderFrame(f);
      o.fillStyle = 'rgba(255,0,0,0.16)'; o.fillRect(0, 0, W, 220); o.fillRect(920, 0, 160, H); o.fillRect(0, 1400, W, 520); // TikTok UI zones
      writeFileSync(`qc/fs_${NAME}_${String(f).padStart(4, '0')}.png`, out.toBuffer('image/png'));
    }
    console.log('SMOKE done', ts.length); return;
  }
  const ff = spawn(FF, ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', `out/tradebay_${OUTN}_nosound.mp4`], { stdio: ['pipe', 'inherit', 'pipe'] });
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
