// Trade Bay — two dark 20s explainers with a Discord close.
//   math: a cost counter -> monthly-bill line vs one $149.99 line -> the line becomes the launcher -> 7 installs -> price -> Discord
//   pov : a cursor does it live: key email -> copy -> launcher opens -> paste -> 7 unlocks -> install all -> Bookmap live -> price -> Discord
// Flat near-black, one typeface (Hanken Grotesk), green = money kept / done, red = money spent. Every phase hands an object to the
// next and overlaps it by ~0.25s; something is always moving. drawWorld(t) is pure; each frame averages 5 sub-frames (motion blur).
// Usage: node render_dark.js <math|pov>  [SMOKE=1 for QC stills]  then  node assemble_short.js <math|pov>
const E = require('./engines.js');
const { W, H, APPS, clamp01, lerp, rr, ico, loadIco, setIco, LOGOS, tile, createCanvas, GlobalFonts, FF } = E;
const { loadImage } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');

const NAME = process.argv[2];
if (!['math', 'pov'].includes(NAME)) { console.error('usage: node render_dark.js <math|pov>'); process.exit(1); }
const FPS = 60, DUR = 20, FRAMES = DUR * FPS, SMOKE = !!process.env.SMOKE, PRICE = '$149.99';
// UNCONFIRMED: replace with what the Discord really offers before posting.
const DISCORD = {
  math: ['Not sure which platform fits you? Ask us.', 'Get help with setup, live.', 'Hear about updates first.'],
  pov: ['Ask anything before you buy.', 'Setup help from real people.', 'Update news first.'],
}[NAME];
mkdirSync('out', { recursive: true }); mkdirSync('qc', { recursive: true });

/* ---------- tokens ---------- */
GlobalFonts.registerFromPath('fonts/HankenGrotesk-400.ttf', 'Hanken');
GlobalFonts.registerFromPath('fonts/HankenGrotesk-500.ttf', 'Hanken');
const K = { bg: '#0b0b0e', surf: '#151519', raise: '#1f1f25', text: '#f2f2f0', muted: '#9a9ca4', green: '#5fc39c', red: '#e5566f', discord: '#5865F2', select: 'rgba(74,138,214,0.45)' };
const F5 = s => `500 ${s}px Hanken`, F4 = s => `400 ${s}px Hanken`;
const X = 80, MAXW = 920;

/* ---------- motion ---------- */
function spr(t, [response, damping]) {
  if (t <= 0) return 0;
  const w0 = 2 * Math.PI / response;
  if (damping >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + (damping * w0 / wd) * Math.sin(wd * t));
}
const CALM = [0.5, 1], SNAP = [0.34, 0.82], POP = [0.42, 0.6], SOFT = [0.6, 0.95];
const smooth = x => x * x * (3 - 2 * x), outCubic = x => 1 - Math.pow(1 - x, 3), inCubic = x => x * x * x;
const inOut = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const ease = (t, a, b, f = smooth) => f(clamp01((t - a) / (b - a)));

/* ---------- text ---------- */
function T(g, s, x, y, font, fill, align = 'left') { g.font = font; g.fillStyle = fill; g.textAlign = align; g.textBaseline = 'middle'; g.letterSpacing = '0px'; g.fillText(s, x, y); }
function wrap(g, s, font, maxW) {
  g.font = font; g.letterSpacing = '0px'; const out = []; let line = '';
  for (const w of s.split(' ')) { const t2 = line ? line + ' ' + w : w; if (g.measureText(t2).width > maxW && line) { out.push(line); line = w; } else line = t2; }
  return [...out, line];
}
function fadeIn(g, k, dy = 28) { g.globalAlpha *= clamp01(k / 0.2); g.translate(0, dy * (1 - spr(k, CALM))); }
// caption track: each line rises in on time and lifts out as the next arrives (they overlap)
function captions(g, t, CAPS) {
  for (const [a, b, s, sub] of CAPS) {
    const k = t - a, o = t - (b - 0.12); if (k <= 0 || o > 0.3) continue;
    g.save(); fadeIn(g, k, 34);
    if (o > 0) { const e = ease(o, 0, 0.28); g.globalAlpha *= 1 - e; g.translate(0, -40 * e); }
    const lines = wrap(g, s, F5(66), MAXW);
    lines.forEach((l, i) => { g.letterSpacing = '-1.3px'; T(g, l, X, 250 + i * 78, F5(66), K.text); });
    if (sub) T(g, sub, X, 250 + lines.length * 78 + 4, F4(38), K.muted);
    g.restore();
  }
}

/* ---------- product pieces ---------- */
const EL = 680, DPR = 2, ENG = {};
for (const a of APPS) {
  const cv = createCanvas(EL * DPR, EL * DPR);
  const Maker = { footprint: E.Footprint, heatmap: E.Heatmap, candles: E.Candles, waves: E.Waves }[a.scene];
  const sc = new Maker({ seed: a.seed, sym: a.sym, hue: a.hue, dom: a.dom, variant: a.variant }, EL, EL);
  sc.ctx = cv.getContext('2d'); sc.w = EL; sc.h = EL;
  ENG[a.id] = { cv, sc, last: -1 };
}
let FRAME = 0;
function chart(id) { const e = ENG[id]; if (e.last !== FRAME) { e.sc.step(); e.sc.ctx.setTransform(DPR, 0, 0, DPR, 0, 0); e.sc.draw(); e.last = FRAME; } return e.cv; }
function cover(g, img, x, y, w, h) { const s = Math.max(w / img.width, h / img.height), sw = w / s, sh = h / s; g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h); }
const ORDER = APPS.map(a => a.id);
function appIcon(g, a, x, y, s) { tile(g, x, y, s, a.hue, a.letters, s * 0.3); }
function check(g, x, y, r, k) {
  const s = spr(k, POP); if (s <= 0.01) return;
  g.save(); g.translate(x, y); g.scale(s, s);
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.fillStyle = K.green; g.fill();
  g.lineWidth = r * 0.22; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = K.bg;
  g.beginPath(); g.moveTo(-r * 0.42, 0); g.lineTo(-r * 0.1, r * 0.32); g.lineTo(r * 0.45, -r * 0.34); g.stroke(); g.restore();
}
function lock(g, x, y, open, k) { // open: 0 locked .. 1 open
  g.save(); g.translate(x, y);
  const c = open > 0.5 ? K.green : K.muted;
  g.lineWidth = 6; g.strokeStyle = c; g.beginPath(); g.translate(0, -open * 14); g.arc(0, -14, 16, Math.PI, 0); g.lineTo(16, 0); g.moveTo(-16, -14); g.lineTo(-16, open > 0.3 ? -14 : 0); g.stroke();
  g.translate(0, open * 14); rr(g, -24, -2, 48, 38, 6); g.fillStyle = c; g.fill(); g.restore();
}
function cursor(g, x, y, press, a = 1) {
  if (a <= 0) return;
  g.save(); g.globalAlpha *= a; g.translate(x, y); g.scale(2.4 * press, 2.4 * press);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 34); g.lineTo(9, 26); g.lineTo(15, 40); g.lineTo(21, 37); g.lineTo(15, 24); g.lineTo(26, 24); g.closePath();
  g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke(); g.restore();
}
function path(t, keys) { // eased glide between waypoints [t, x, y]
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, x0, y0] = keys[i - 1], [b, x1, y1] = keys[i], e = inOut((t - a) / (b - a)); return [lerp(x0, x1, e), lerp(y0, y1, e)]; }
  const l = keys[keys.length - 1]; return [l[1], l[2]];
}
const pressAt = (t, clicks) => clicks.reduce((p, c) => p * (1 - 0.18 * Math.sin(Math.PI * clamp01((t - c) / 0.14))), 1);
function price(g, t, a0) { // $149.99 springs in, slow push
  const k = t - a0; if (k <= 0) return;
  const s = 0.7 + 0.3 * spr(k, POP), z = 1 + 0.04 * ease(k, 0.3, 2.5);
  g.save(); g.globalAlpha *= clamp01(k / 0.15); g.translate(W / 2, 900); g.scale(s * z, s * z);
  g.letterSpacing = '-9px'; T(g, PRICE, 0, 0, F5(230), K.text, 'center');
  T(g, 'per platform, one time', 0, 170, F4(56), K.muted, 'center'); g.restore();
}
function chat(g, t, a0) { // Discord-style messages arriving, then the button
  let y = 560;
  DISCORD.forEach((m, i) => {
    const k = t - (a0 + 0.3 + i * 0.6), lines = wrap(g, m, F4(52), 780);
    if (k > 0) {
      g.save(); fadeIn(g, k, 40);
      g.save(); g.beginPath(); g.arc(X + 40, y + 40, 40, 0, 7); g.clip(); ico(g, X, y, 80); g.restore();
      T(g, 'Trade Bay', X + 110, y + 18, F5(42), K.text); g.font = F5(42);
      T(g, 'Today', X + 130 + g.measureText('Trade Bay').width, y + 20, F4(32), K.muted);
      lines.forEach((l, j) => T(g, l, X + 110, y + 78 + j * 62, F4(52), K.text));
      g.restore();
    }
    y += 110 + lines.length * 62;
  });
  const k = t - (a0 + 2.2); if (k <= 0) return;
  const b = 1 + 0.025 * Math.sin(Math.max(0, k - 0.6) * Math.PI * 2.4), s = spr(k, POP) * b;
  g.save(); g.translate(W / 2, 1480); g.scale(s, s);
  rr(g, -460, -80, 920, 160, 22); g.fillStyle = K.discord; g.fill();
  T(g, 'Join the Discord. Link in bio.', 0, 2, F5(56), '#fff', 'center'); g.restore();
}

/* ================= video: math ================= */
const CX0 = X, CX1 = 1000, CY0 = 1340, CY1 = 640, yv = v => CY0 - v / 2400 * (CY0 - CY1), xm = m => CX0 + m * (CX1 - CX0) / 24;
const GY = yv(149.99);
const RED_P = t => 24 * ease(t, 2.05, 3.95);
const PX = 80, PY = 560, PW = 920, PH = 880, RH = 108, rowY = i => PY + 120 + i * RH;
function redPath(g, n) {
  g.beginPath(); g.moveTo(CX0, CY0);
  for (let m = 0; m < Math.ceil(n); m++) { g.lineTo(xm(m), yv(100 * (m + 1))); g.lineTo(xm(Math.min(n, m + 1)), yv(100 * (m + 1))); }
}
function mathWorld(g, t) {
  // A. counter spins up, then flies to the top-right to wait for the line
  const v = 2400 * ease(t, 0.1, 1.75, outCubic), mv = spr(t - 1.85, SOFT), out = 1 - ease(t, 6.0, 6.35);
  if (t < 6.4) {
    const s = lerp(1, 0.32, mv), x = lerp(W / 2, CX1, mv), y = lerp(900, CY1 - 70, mv);
    g.save(); g.globalAlpha = out; g.translate(x, y); g.scale(s, s);
    g.letterSpacing = '-9px'; T(g, '$' + Math.round(v).toLocaleString('en-US'), 0, 0, F5(230), K.red, mv > 0.5 ? 'right' : 'center');
    g.globalAlpha = out * (1 - clamp01(mv * 2)); T(g, 'spent on one subscription', 0, 160, F4(54), K.muted, 'center');
    g.restore();
  }
  // B. the bill climbs month by month; one flat green line; the gap fills
  if (t > 2.0 && t < 6.4) {
    g.save(); g.globalAlpha = out;
    g.fillStyle = K.raise; g.fillRect(CX0, CY0 + 2, CX1 - CX0, 3);
    T(g, 'Month 1', CX0, CY0 + 50, F4(36), K.muted); T(g, 'Month 24', CX1, CY0 + 50, F4(36), K.muted, 'right');
    const f = ease(t, 4.4, 5.2);
    if (f > 0) { // area between the bill and the one-time price, sweeping left to right
      g.save(); g.beginPath(); g.rect(CX0, 0, (CX1 - CX0) * f, H); g.clip();
      redPath(g, 24); g.lineTo(CX1, GY); g.lineTo(CX0, GY); g.closePath(); g.fillStyle = 'rgba(229,86,111,0.16)'; g.fill(); g.restore();
    }
    const n = RED_P(t); redPath(g, n);
    g.lineWidth = 8; g.lineJoin = 'round'; g.strokeStyle = K.red; g.stroke();
    if (n > 0 && n < 24) { const m = Math.ceil(n); g.beginPath(); g.arc(xm(n), yv(100 * m), 12, 0, 7); g.fillStyle = K.red; g.fill(); }
    const gl = ease(t, 3.75, 4.45, inOut);
    if (gl > 0) { g.fillStyle = K.green; g.fillRect(CX0, GY - 4, (CX1 - CX0) * gl, 8); }
    if (t > 4.3) { g.save(); fadeIn(g, t - 4.3, 20); T(g, PRICE, CX1, GY - 50, F5(56), K.green, 'right'); g.restore(); }
    if (t > 5.0) { g.save(); fadeIn(g, t - 5.0); T(g, 'You keep $2,250', W / 2, 1010, F5(96), K.green, 'center'); g.restore(); }
    g.restore();
  }
  // C. the green line swings up into the launcher's edge; 7 platforms drop in
  if (t >= 6.0 && t < 14.9) {
    const m = spr(t - 6.0, SOFT), z = 1 + 0.03 * ease(t, 6.5, 14);
    const x0 = lerp(CX0, PX, m), y0 = lerp(GY, PY, m), x1 = lerp(CX1, PX, m), y1 = lerp(GY, PY + PH, m);
    g.save(); g.translate(W / 2, 1000); g.scale(z, z); g.translate(-W / 2, -1000);
    g.globalAlpha = 1 - ease(t, 14.0, 14.45); // panel clears as the rows fly into the price
    const pa = ease(t, 6.3, 6.7) * g.globalAlpha;
    if (pa > 0) {
      g.save(); g.globalAlpha = pa; g.fillStyle = K.surf; g.fillRect(PX, PY, PW, PH);
      ico(g, PX + 40, PY + 26, 56); T(g, 'Trade Bay launcher', PX + 116, PY + 55, F5(44), K.text);
      T(g, '7 platforms', PX + PW - 36, PY + 55, F4(36), K.muted, 'right'); g.restore();
    }
    g.save(); g.lineCap = 'round'; g.lineWidth = 8; g.strokeStyle = K.green; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore();
    APPS.forEach((a, i) => {
      const fly = ease(t, 14.0 + i * 0.04, 14.55 + i * 0.04, inCubic); // E. rows collapse into the price
      const k = t - (6.6 + i * 0.32); if (k <= 0 || fly >= 1) return;
      const y = rowY(i);
      g.save(); fadeIn(g, k, -50);
      g.translate(lerp(0, W / 2 - PX - PW / 2, fly), lerp(0, 900 - y - RH / 2, fly));
      g.translate(PX + PW / 2, y + RH / 2); g.scale(1 - fly, 1 - fly); g.translate(-PX - PW / 2, -y - RH / 2);
      // D. install sweep across the row
      const ip = ease(t, 10.2 + i * 0.28, 11.2 + i * 0.28, inOut), done = ip >= 1;
      if (ip > 0) { g.fillStyle = 'rgba(95,195,156,0.14)'; g.fillRect(PX + 8, y + 6, (PW - 16) * ip, RH - 12); }
      appIcon(g, a, PX + 40, y + 18, 72); T(g, a.name, PX + 140, y + RH / 2, F5(50), K.text);
      if (done) { check(g, PX + PW - 60, y + RH / 2, 26, t - (11.2 + i * 0.28)); T(g, 'Ready', PX + PW - 104, y + RH / 2, F4(38), K.green, 'right'); }
      else if (ip > 0) T(g, `${Math.round(ip * 100)}%`, PX + PW - 36, y + RH / 2, F4(38), K.text, 'right');
      else if (k > 0.2) T(g, 'Lifetime licence', PX + PW - 36, y + RH / 2, F4(36), K.green, 'right');
      g.restore();
    });
    g.restore();
  }
  // E. price
  if (t < 16.9) { g.save(); g.globalAlpha = 1 - ease(t, 16.35, 16.75); g.translate(0, -60 * ease(t, 16.35, 16.75)); price(g, t, 14.3); g.restore(); }
  // F. Discord
  chat(g, t, 16.5);
}
const MATH = {
  caps: [[0, 2.0, '2 years at $100/month:', 'Example price'], [2.0, 6.0, `Or pay ${PRICE}. Once.`],
    [6.0, 10.0, 'Trade Bay sells lifetime licences for 7 pro platforms.'], [10.0, 14.0, 'One launcher installs and updates all of them.'],
    [14.0, 16.5, 'No subscription. No renewal.'], [16.5, 20.5, 'Join the Discord']],
  world: mathWorld,
  sfx: () => {
    const ev = [['riser', 0], ['boom', 1.75], ['whoosh', 1.85]];
    let last = 0; for (let ms = 2000; ms < 4000; ms++) { const n = Math.floor(RED_P(ms / 1000)); if (n > last) { last = n; if (n % 2 === 0 || n === 1) ev.push(['tick', ms / 1000]); } }
    ev.push(['whoosh', 3.75], ['pop', 4.45], ['whoosh', 4.4], ['boom', 5.0], ['whoosh', 6.0]);
    APPS.forEach((_, i) => ev.push(['pop', 6.62 + i * 0.32]));
    APPS.forEach((_, i) => ev.push(['tick', 11.2 + i * 0.28]));
    ev.push(['whoosh', 14.0], ['boom', 14.3]);
    DISCORD.forEach((_, i) => ev.push(['notif', 16.8 + i * 0.6]));
    ev.push(['pop', 18.7], ['chime', 18.75]);
    return ev;
  },
};

/* ================= video: pov ================= */
const KEY = 'TB-7F3K-Q9LM-2X8P';
const WX = 40, WY = 440, WW = 1000, WH = 1180, prow = i => 690 + i * 120;
const POV_CUR = [[0, 900, 1560], [1.8, 720, 1180], [2.55, 820, 690], [3.25, 820, 700], [3.55, 150, 975], [4.25, 950, 975], [4.7, 760, 1150],
  [5.05, 165, 1330], [5.6, 300, 1330], [5.8, 420, 600], [7.5, 520, 640], [8.05, 895, 600], [11.3, 820, 900], [12.4, 520, 990]];
const POV_CLICKS = [2.85, 5.1, 5.22, 5.88, 8.15, 12.45];
function povWorld(g, t) {
  // A. desktop: the Trade Bay icon waits
  const winOpen = spr(t - 5.25, SOFT), deskA = 1 - ease(t, 5.25, 5.6);
  if (deskA > 0) { g.save(); g.globalAlpha = deskA; ico(g, 110, 1270, 110); T(g, 'Trade Bay', 165, 1410, F4(34), K.text, 'center'); g.restore(); }
  // B. key email: slides in, opens, key gets selected and copied
  if (t > 2.05 && t < 5.4) {
    const k = t - 2.05, inX = (1 - spr(k, SNAP)) * 1100, exitX = ease(t, 4.8, 5.3, inCubic) * 1100, open = spr(t - 2.9, SOFT);
    const x = X + inX + exitX, y = 560, h = lerp(200, 560, open);
    g.save(); g.translate(x - X, 0);
    rr(g, X, y, MAXW, h, 28); g.fillStyle = K.surf; g.fill();
    ico(g, X + 36, y + 36, 80); T(g, 'Trade Bay', X + 140, y + 66, F5(46), K.text); T(g, 'now', X + MAXW - 36, y + 66, F4(36), K.muted, 'right');
    T(g, 'Your licence key is ready', X + 140, y + 128, F4(44), K.muted);
    if (open > 0.3) {
      g.save(); g.globalAlpha = clamp01((open - 0.3) / 0.4);
      T(g, 'Licence key', X + 36, y + 250, F4(38), K.muted);
      rr(g, X + 36, y + 300, MAXW - 72, 150, 18); g.fillStyle = K.raise; g.fill();
      const sel = ease(t, 3.55, 4.25, x2 => x2);
      g.letterSpacing = '2px'; g.font = F5(64); const kw = g.measureText(KEY).width;
      const sx = X + 70, selW = Math.min(kw, Math.max(0, path(t, POV_CUR)[0] - sx));
      if (t > 3.55) { g.fillStyle = K.select; g.fillRect(sx - 8, y + 335, (t > 4.25 ? kw : selW) + 16, 80); }
      g.letterSpacing = '2px'; g.font = F5(64); g.fillStyle = K.text; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(KEY, sx, y + 376);
      if (t > 4.3) { g.save(); fadeIn(g, t - 4.3, 16); rr(g, X + 36, y + 480, 220, 56, 28); g.fillStyle = 'rgba(95,195,156,0.18)'; g.fill(); T(g, 'Copied', X + 146, y + 509, F5(36), K.green, 'center'); g.restore(); }
      g.restore();
    }
    g.restore();
  }
  // C. launcher zooms open from the desktop icon
  if (t > 5.25 && t < 15.6) {
    const r = { x: lerp(110, WX, winOpen), y: lerp(1270, WY, winOpen), w: lerp(110, WW, winOpen), h: lerp(110, WH, winOpen) };
    const fadeOut = 1 - ease(t, 12.6, 13.2);
    g.save(); g.globalAlpha = clamp01(winOpen * 3) * fadeOut;
    g.translate(r.x, r.y); g.scale(r.w / WW, r.h / WH); g.translate(-WX, -WY);
    rr(g, WX, WY, WW, WH, 26); g.fillStyle = K.surf; g.fill();
    ico(g, WX + 36, WY + 22, 48); T(g, 'Trade Bay', WX + 100, WY + 46, F5(40), K.text);
    const lic = t > 6.2;
    g.save(); g.translate(WX + WW - 150, WY + 46); if (lic) { const s = 1 + 0.15 * (1 - spr(t - 6.2, POP)); g.scale(s, s); }
    rr(g, -110, -26, 220, 52, 26); g.fillStyle = lic ? 'rgba(95,195,156,0.18)' : K.raise; g.fill();
    T(g, lic ? 'Licensed' : 'Unlicensed', 0, 1, F5(32), lic ? K.green : K.muted, 'center'); g.restore();
    // key field + install-all
    rr(g, WX + 40, 550, 700, 100, 16); g.fillStyle = K.raise; g.fill();
    if (t < 5.95) T(g, 'Paste licence key', WX + 76, 600, F4(42), K.muted);
    else { const fl = 1 - ease(t, 5.95, 6.35); g.letterSpacing = '1px'; T(g, KEY, WX + 76, 600, F5(44), K.text); if (fl > 0) { g.save(); g.globalAlpha *= fl * 0.35; rr(g, WX + 40, 550, 700, 100, 16); g.fillStyle = K.green; g.fill(); g.restore(); } }
    if (t > 7.6) { g.save(); fadeIn(g, t - 7.6, 16); const p = pressAt(t, [8.15]); g.translate(WX + 870, 600); g.scale(p, p); rr(g, -125, -50, 250, 100, 16); g.fillStyle = K.green; g.fill(); T(g, 'Install all', 0, 2, F5(40), K.bg, 'center'); g.restore(); }
    // rows: locked -> unlocked -> installing -> ready
    APPS.forEach((a, i) => {
      const y = prow(i), un = ease(t, 6.4 + i * 0.15, 6.7 + i * 0.15), ip = ease(t, 8.4 + i * 0.3, 9.4 + i * 0.3, inOut);
      const sel = i === 2 && t > 12.45, base = sel ? 1 - ease(t, 12.45, 12.7) : 1;
      g.save(); g.globalAlpha *= (0.4 + 0.6 * un) * base;
      if (ip > 0) { g.fillStyle = 'rgba(95,195,156,0.13)'; g.fillRect(WX + 24, y + 8, (WW - 48) * ip, 104); }
      appIcon(g, a, WX + 50, y + 22, 76); T(g, a.name, WX + 156, y + 60, F5(50), K.text);
      if (ip >= 1) { check(g, WX + WW - 70, y + 60, 26, t - (9.4 + i * 0.3)); T(g, 'Ready', WX + WW - 114, y + 60, F4(38), K.green, 'right'); }
      else if (ip > 0) T(g, `${Math.round(ip * 100)}%`, WX + WW - 46, y + 60, F4(38), K.text, 'right');
      else lock(g, WX + WW - 70, y + 52, un, t);
      g.restore();
    });
    g.restore();
  }
  // E. Bookmap row grows into the live chart
  if (t > 12.45 && t < 15.6) {
    const m = spr(t - 12.45, SOFT), y0 = prow(2), down = ease(t, 14.75, 15.2, inCubic);
    const r = { x: lerp(WX + 24, 0, m), y: lerp(y0 + 8, 440, m) + down * 1500, w: lerp(WW - 48, W, m), h: lerp(104, 1300, m) };
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); cover(g, chart('bm'), r.x, r.y, r.w, r.h); g.restore();
    if (m > 0.6) { g.save(); g.globalAlpha = clamp01((m - 0.6) / 0.3); rr(g, 50, r.y + 30, 330, 96, 18); g.fillStyle = 'rgba(11,11,14,0.85)'; g.fill(); appIcon(g, APPS[2], 70, r.y + 46, 64); T(g, 'Bookmap', 150, r.y + 78, F5(46), K.text); g.restore(); }
  }
  // F. price, G. Discord
  if (t < 17.4) { g.save(); g.globalAlpha = 1 - ease(t, 16.85, 17.25); g.translate(0, -60 * ease(t, 16.85, 17.25)); price(g, t, 15.15); g.restore(); }
  chat(g, t, 17.0);
  const [cx, cy] = path(t, POV_CUR);
  cursor(g, cx, cy, pressAt(t, POV_CLICKS), 1 - ease(t, 12.5, 12.9));
}
const POV = {
  caps: [[0, 2.0, 'POV: you stopped paying monthly for your charts.'], [2.0, 5.0, 'Buy once. Your key arrives by email.'],
    [5.0, 8.0, 'Paste it. Everything you bought unlocks.'], [8.0, 12.0, 'The vendor’s full build, verified and kept up to date.'],
    [12.0, 15.0, 'Bookmap, ATAS, Sierra Chart and 4 more.'], [15.0, 17.0, `${PRICE} each. Yours for life.`], [17.0, 20.5, 'Questions first? Ask us on Discord.']],
  world: povWorld,
  sfx: () => {
    const ev = [['whoosh', 0.1], ['notif', 2.1], ...POV_CLICKS.map(c => ['pop', c]), ['tick', 4.3], ['whoosh', 4.8], ['whoosh', 5.25], ['notif', 6.2]];
    APPS.forEach((_, i) => ev.push(['tick', 6.55 + i * 0.15]));
    APPS.forEach((_, i) => ev.push(['tick', 9.4 + i * 0.3]));
    ev.push(['whoosh', 12.45], ['boom', 12.9], ['whoosh', 14.75], ['boom', 15.15]);
    DISCORD.forEach((_, i) => ev.push(['notif', 17.3 + i * 0.6]));
    ev.push(['pop', 19.2], ['chime', 19.25]);
    return ev;
  },
};

/* ---------- frame ---------- */
const V = { math: MATH, pov: POV }[NAME];
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
writeFileSync(`out/timeline_${NAME}.json`, JSON.stringify({ dur: DUR, events: V.sfx().map(([n, a]) => [n, +a.toFixed(3)]) }, null, 1));

(async () => {
  setIco(await loadIco());
  for (const a of APPS) LOGOS[a.letters] = await loadImage(`icons/${a.id}.png`);
  if (SMOKE) {
    const ts = (process.env.TIMES || (NAME === 'math' ? '0.9,1.8,2.6,3.5,4.2,4.8,5.6,6.3,7.2,9.4,10.9,12.4,14.2,15.5,17.2,18.4,19.6'
      : '1.0,2.4,3.1,3.9,4.5,5.4,6.0,6.8,8.3,9.6,11.6,12.8,13.8,15.3,16.4,17.6,19.6')).split(',');
    for (const s of ts) { const f = Math.round(+s * FPS); renderFrame(f); writeFileSync(`qc/dk_${NAME}_${String(f).padStart(4, '0')}.png`, out.toBuffer('image/png')); }
    console.log('SMOKE done', ts.length); return;
  }
  const ff = spawn(FF, ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', `out/tradebay_${NAME}_nosound.mp4`], { stdio: ['pipe', 'inherit', 'pipe'] });
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
