// Trade Bay — "One Line": 22s, no hard cuts. One camera, one green line threading every scene.
// Receipt prints forever -> tears -> PAID ONCE ticket -> zoom through the O -> logo splits into 7 app tiles
// -> tile grows into a window -> camera glides across 7 live app windows linked by the line
// -> line becomes the install bar -> bar morphs into a swinging $149.99 tag -> flips -> pull out to the logo.
// drawWorld(g, t) is a pure function of time; every frame averages 5 sub-frame samples (180° shutter)
// so all motion gets real motion blur. Raw RGBA piped to ffmpeg.
// Usage: node render_line.js          -> out/tradebay_line_nosound.mp4 (+ out/timeline_line.json)
//        SMOKE=1 node render_line.js  -> QC stills only (qc/ln_*.png)
const E = require('./engines.js');
const { W, H, C, APPS, clamp01, lerp, outCubic, inOutSine, shake, rnd,
  rr, txt, tile, ico, loadIco, setIco, LOGOS, rgba, mixHex, createCanvas, GlobalFonts, FF } = E;
const { loadImage } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');

const FPS = 60, DUR = 22.0, FRAMES = Math.round(DUR * FPS), PRICE = '$149.99';
const SMOKE = !!process.env.SMOKE;
mkdirSync('out', { recursive: true }); mkdirSync('qc', { recursive: true });

GlobalFonts.registerFromPath('C:/Windows/Fonts/seguibl.ttf', 'TB Black');
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeuib.ttf', 'TB Bold');
GlobalFonts.registerFromPath('C:/Windows/Fonts/seguisb.ttf', 'TB Semi');
GlobalFonts.registerFromPath('C:/Windows/Fonts/consolab.ttf', 'TB Mono');
const BLACK = s => `${s}px "TB Black"`, BOLD = s => `${s}px "TB Bold"`;
const SEMI = s => `${s}px "TB Semi"`, MONOB = s => `${s}px "TB Mono"`;
const P = Object.fromEntries(APPS.map(a => [a.id, a]));
const ORDER = ['atas', 'bm', 'sc', 'mw', 'dc', 'ax', 'jig'];
const LINE = C.posInk;

/* ---------- motion: damped springs + eases (no linear motion anywhere) ---------- */
function spr(t, [response, damping]) {
  if (t <= 0) return 0;
  const w0 = 2 * Math.PI / response;
  if (damping >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + (damping * w0 / wd) * Math.sin(wd * t));
}
const SNAP = [0.32, 0.8], BOUNCE = [0.42, 0.5], SOFT = [0.55, 0.95], CAM = [0.75, 0.88], CRIT = [0.5, 1];
const inCubic = x => x * x * x, inQuart = x => x * x * x * x;
const inOutCubic = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const ease = (t, a, b, f = inOutSine) => f(clamp01((t - a) / (b - a)));

/* ---------- timeline (seconds) ---------- */
const JAM = 2.2, TEAR = 2.5, TICKET = 2.62, ZOOM0 = 3.3, ZOOM1 = 4.35, XF0 = 4.12, XF1 = 4.35;
const ICON = 4.2, TILES = 4.52, FLIPS = 4.66, GROW = 5.15;
const S_AT = i => 5.3 + 1.5 * i - 0.35;          // camera departs toward slot i (1..7)
const LAND = i => i === 0 ? 5.35 : S_AT(i) + 0.3; // header of app i animates in
const TRACK = 15.75, FILL0 = 15.9, FILL1 = 16.8, MORPH = 17.1, SWING = 17.25, FLIP = 18.7, PULL = 19.5, WORD = 19.95, PILL = 20.25;

/* ---------- live chart engines, crisp at 2x ---------- */
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

/* ---------- shared drawing ---------- */
const dots = (() => {
  const c = createCanvas(W + 36, H + 36), g = c.getContext('2d');
  g.fillStyle = C.ground; g.fillRect(0, 0, W + 36, H + 36);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 9; y < H + 36; y += 18) for (let x = 9; x < W + 36; x += 18) g.fillRect(x, y, 1.6, 1.6);
  return c;
})();
function bg(g, shiftX = 0, glow = C.accent, a = 0.14, cy = 1000) {
  g.drawImage(dots, -(((shiftX % 18) + 18) % 18) - 18 + 18, 0);
  const r = g.createRadialGradient(W / 2, cy, 0, W / 2, cy, H * 0.6);
  r.addColorStop(0, rgba(glow, a)); r.addColorStop(1, rgba(glow, 0));
  g.fillStyle = r; g.fillRect(0, 0, W, H);
}
function fit(g, s, font, size, maxW) { g.font = font(size); const w = g.measureText(s).width; return w > maxW ? Math.floor(size * maxW / w) : size; }
function rise(g, s, x, y, font, fill, k, align = 'center') {
  if (k <= 0) return;
  const p = spr(k, SNAP);
  g.save(); g.globalAlpha *= clamp01(k / 0.15); g.translate(0, (1 - p) * 40);
  txt(g, s, x, y, font, fill, align); g.restore();
}
function popAt(g, x, y, k, cfg, draw) { const s = spr(k, cfg); if (s <= 0.01) return; g.save(); g.translate(x, y); g.scale(s, s); draw(); g.restore(); }
function pill(g, x, y, w, h, fill, stroke, label, font, ink) {
  rr(g, x - w / 2, y - h / 2, w, h, h / 2); g.fillStyle = fill; g.fill();
  if (stroke) { g.lineWidth = 3; g.strokeStyle = stroke; g.stroke(); }
  if (label) txt(g, label, x, y + 2, font, ink);
}
function logo(g, id, x, y, s) { const a = P[id]; tile(g, x, y, s, a.hue, a.letters, Math.round(s * 0.3)); }
function appWindow(g, id, x, y, w) { // title bar + live chart + caption
  const a = P[id], barH = 70, bodyH = w, footH = 60, h = barH + bodyH + footH;
  g.save(); g.shadowColor = rgba(a.hue, 0.3); g.shadowBlur = 90;
  rr(g, x, y, w, h, 24); g.fillStyle = C.chrome; g.fill(); g.restore();
  g.save(); rr(g, x, y, w, h, 24); g.clip();
  g.fillStyle = C.chrome; g.fillRect(x, y, w, barH);
  logo(g, id, x + 22, y + 15, 40);
  txt(g, a.name, x + 78, y + 37, BOLD(32), C.text, 'left');
  g.font = BOLD(32); const nw = g.measureText(a.name).width;
  txt(g, a.sym, x + 96 + nw, y + 38, MONOB(24), C.muted, 'left');
  txt(g, PRICE, x + w - 26, y + 38, MONOB(30), C.posInk, 'right');
  g.fillStyle = C.rule; g.fillRect(x, y + barH - 1, w, 1);
  g.imageSmoothingQuality = 'high';
  g.drawImage(chart(id), x, y + barH, w, bodyH);
  g.fillStyle = C.rule; g.fillRect(x, y + barH + bodyH, w, 1);
  txt(g, a.view, x + 26, y + barH + bodyH + footH / 2 + 1, MONOB(26), C.muted, 'left');
  g.restore();
  g.lineWidth = 2.5; g.strokeStyle = rgba(a.hue, 0.75); rr(g, x, y, w, h, 24); g.stroke();
}
const WIN = { x: 40, y: 450, w: 1000, h: 1130 };

/* ---------- 1. receipt ---------- */
const PX = 160, PW = 760, SLOT_Y = 430, ROW = 64, PAPER = '#efede6', INK = '#26262c', TEAR_Y = 1150;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pAt = t => { const u = clamp01(t / JAM) * JAM; return 120 * u + 520 * u * u; }; // printed length, speeds up, jams
function receiptRow(g, k, y) {
  if (k === 0) { txt(g, 'MONTHLY STATEMENT', W / 2, y, BOLD(36), INK); return; }
  if (k === 1) { g.fillStyle = 'rgba(0,0,0,0.25)'; for (let x = PX + 30; x < PX + PW - 30; x += 22) g.fillRect(x, y, 12, 3); return; }
  const m = k - 2;
  txt(g, `${MONTHS[m % 12]} '${26 + Math.floor(m / 12)}`, PX + 36, y, MONOB(30), INK, 'left');
  txt(g, 'Platform subscription', PX + 196, y, MONOB(26), '#6b6b72', 'left');
  txt(g, 'RENEWED', PX + PW - 36, y, MONOB(30), '#c23a46', 'right');
  g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(PX + 30, y + ROW / 2, PW - 60, 2);
}
function receipt(g, t) {
  const p = pAt(t), bot = SLOT_Y + p;
  g.save();
  g.beginPath(); g.moveTo(PX, SLOT_Y - 20); g.lineTo(PX + PW, SLOT_Y - 20); g.lineTo(PX + PW, bot);
  for (let x = PX + PW; x > PX; x -= 20) { g.lineTo(x - 10, bot + 10); g.lineTo(x - 20, bot); }
  g.closePath();
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 50; g.fillStyle = PAPER; g.fill(); g.shadowBlur = 0;
  g.clip();
  const sh = g.createLinearGradient(PX, 0, PX + PW, 0); // soft paper curl shading
  sh.addColorStop(0, 'rgba(0,0,0,0.10)'); sh.addColorStop(0.15, 'rgba(0,0,0,0)'); sh.addColorStop(0.85, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = sh; g.fillRect(PX, SLOT_Y - 20, PW, p + 40);
  for (let k = 0; k <= Math.floor(p / ROW); k++) {
    const y = bot - 40 - k * ROW;
    if (y > H + ROW) continue; if (y < SLOT_Y - ROW) break;
    receiptRow(g, k, y);
  }
  g.restore();
  // printer
  rr(g, 100, SLOT_Y - 120, 880, 126, 28); g.fillStyle = '#1c1c22'; g.fill();
  g.lineWidth = 2; g.strokeStyle = C.border; g.stroke();
  g.fillStyle = '#050507'; rr(g, 140, SLOT_Y - 8, 800, 10, 5); g.fill();
  const jam = t >= JAM;
  txt(g, jam ? 'PAPER JAM' : 'PRINTING\u2026', 150, SLOT_Y - 62, MONOB(28), jam ? C.negative : C.muted, 'left');
  g.beginPath(); g.arc(930, SLOT_Y - 62, 10, 0, 7);
  g.fillStyle = jam ? C.negative : (Math.sin(t * 18) > 0 ? C.positive : '#1f3a30'); g.fill();
}
const TEAR_PTS = [[-120, TEAR_Y], ...Array.from({ length: 27 }, (_, i) => [PX - 20 + i * (PW + 40) / 26, TEAR_Y + (rnd(i * 3.17 + 1) - 0.5) * 40]), [1200, TEAR_Y]];
function tearClip(g, above) {
  g.beginPath(); TEAR_PTS.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
  if (above) { g.lineTo(1200, -400); g.lineTo(-120, -400); } else { g.lineTo(1200, H + 3000); g.lineTo(-120, H + 3000); }
  g.closePath(); g.clip();
}
function introText(g, t) {
  const a = 1 - ease(t, TEAR, TEAR + 0.25, outCubic); if (a <= 0) return;
  g.save(); g.globalAlpha = a;
  const parts = [['It ', C.text], ['never', C.negative], [' stops.', C.text]];
  g.font = BLACK(100); const tw = parts.reduce((s, [p]) => s + g.measureText(p).width, 0);
  const k = t - 0.3, sp = spr(k, SNAP);
  if (k > 0) {
    g.globalAlpha = a * clamp01(k / 0.15); g.translate(0, (1 - sp) * 40);
    let x = W / 2 - tw / 2;
    for (const [p, c] of parts) { txt(g, p, x, 220, BLACK(100), c, 'left'); x += g.measureText(p).width; }
  }
  g.restore();
}

/* ---------- 2. ticket + zoom through the O ---------- */
const TK = { cx: 540, cy: 960, w: 820, h: 440 };
const O_C = (() => { // centre of the "O" in ONCE. (ticket-local text at y = +20)
  const g = createCanvas(10, 10).getContext('2d'); g.font = BLACK(210); g.textBaseline = 'middle';
  const wAll = g.measureText('ONCE.').width; g.textAlign = 'left'; const o = g.measureText('O');
  const x0 = TK.cx - wAll / 2, y0 = TK.cy + 20;
  return [x0 + (o.actualBoundingBoxRight - o.actualBoundingBoxLeft) / 2, y0 + (o.actualBoundingBoxDescent - o.actualBoundingBoxAscent) / 2];
})();
function ticket(g, t) {
  const k = t - TICKET, s = spr(k, BOUNCE); if (s <= 0.01) return;
  const { cx, w, h } = TK, cy = lerp(TEAR_Y, TK.cy, spr(k, SNAP));
  g.save(); g.translate(cx, cy); g.scale(s, s); g.rotate((1 - spr(k, SOFT)) * 0.14);
  g.shadowColor = rgba(LINE, 0.35); g.shadowBlur = 80;
  rr(g, -w / 2, -h / 2, w, h, 30); g.fillStyle = '#1b1b21'; g.fill(); g.shadowBlur = 0;
  g.lineWidth = 3; g.strokeStyle = rgba(LINE, 0.65); g.stroke();
  for (const sx of [-1, 1]) { g.beginPath(); g.arc(sx * w / 2, 0, 34, 0, 7); g.fillStyle = C.ground; g.fill(); }
  g.setLineDash([14, 12]); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.12)'; rr(g, -w / 2 + 26, -h / 2 + 26, w - 52, h - 52, 18); g.stroke(); g.setLineDash([]);
  txt(g, 'P A I D', 0, -125, BOLD(54), C.soft);
  txt(g, 'ONCE.', 0, 20, BLACK(210), LINE);
  txt(g, 'LIFETIME LICENCE \u00b7 NO. 0001', 0, 160, MONOB(30), C.muted);
  g.restore();
}
function intro(g, t) {
  bg(g, 0, t < TEAR ? C.negative : LINE, 0.12);
  if (t < ZOOM0) {
    g.save();
    if (t >= JAM && t < TEAR) g.translate(Math.sin(t * 95) * 7, Math.sin(t * 71) * 3); // jam rattle
    if (t >= TEAR && t < TEAR + 0.5) g.translate(shake(t - TEAR) * 14, shake((t - TEAR) * 1.1) * 9);
    if (t < TEAR) receipt(g, t);
    else {
      const k = t - TEAR;
      g.save(); // top half + printer spring away upward
      const up = spr(k, [0.9, 1]);
      g.translate(W / 2, TEAR_Y); g.rotate(-0.05 * up); g.translate(-W / 2, -TEAR_Y - 1800 * up);
      tearClip(g, true); receipt(g, t); g.restore();
      g.save(); // bottom half falls under gravity
      const fall = ease(k, 0, 0.8, x => x * x);
      g.translate(W / 2, TEAR_Y); g.rotate(0.16 * fall); g.translate(-W / 2, -TEAR_Y + 2600 * fall);
      tearClip(g, false); receipt(g, t); g.restore();
    }
    ticket(g, t);
    g.restore();
    introText(g, t);
  } else { // dive into the O: slow anticipation, then accelerate through
    const e = ease(t, ZOOM0, ZOOM1, inQuart), z = Math.exp(Math.log(70) * e), c = ease(t, ZOOM0, 4.0, inOutCubic);
    g.save(); g.translate(lerp(O_C[0], W / 2, c), lerp(O_C[1], H / 2, c)); g.scale(z, z); g.translate(-O_C[0], -O_C[1]);
    ticket(g, t); g.restore();
  }
}

/* ---------- 3. logo -> 7 tiles -> first window ---------- */
const TS = 184, TG = 34;
const TILE_POS = ORDER.map((_, i) => i < 4 ? [W / 2 + (i - 1.5) * (TS + TG), 870] : [W / 2 + (i - 5) * (TS + TG), 1090]);
function tiles(g, t) {
  const out = spr(t - GROW, SNAP); // the rest shrink away as the first tile becomes a window
  // brand icon pops, then hands over to the tiles
  const ik = t - ICON, is = spr(ik, BOUNCE) * (1 - spr(t - TILES + 0.05, SNAP));
  if (is > 0.01) { g.save(); g.translate(W / 2, 960); g.scale(is, is); ico(g, -140, -140, 280, 90); g.restore(); }
  ORDER.forEach((id, i) => {
    const k = t - (TILES + i * 0.035); if (k <= 0) return;
    const m = spr(k, BOUNCE), sz = spr(k, SNAP) * (i === 0 ? 1 : 1 - out);
    if (sz <= 0.01) return;
    const [tx, ty] = TILE_POS[i], x = lerp(W / 2, tx, m), y = lerp(960, ty, m);
    const f = clamp01(spr(t - (FLIPS + i * 0.035), CRIT)), sx = Math.abs(Math.cos(Math.PI * f));
    if (i === 0 && t >= GROW) return; // handed to growWindow
    g.save(); g.translate(x, y); g.scale(sx * sz, sz);
    rr(g, -TS / 2, -TS / 2, TS, TS, 40);
    if (f < 0.5) { g.fillStyle = '#16233a'; g.fill(); g.lineWidth = 3; g.strokeStyle = rgba(C.accent, 0.6); g.stroke(); ico(g, -46, -46, 92); }
    else { g.fillStyle = C.surface; g.fill(); g.lineWidth = 3; g.strokeStyle = rgba(P[id].hue, 0.8); g.stroke(); logo(g, id, -66, -66, 132); }
    g.restore();
  });
}
function growWindow(g, t) { // tile 0 rect -> window rect on a soft spring
  const k = spr(t - GROW, SOFT), [tx, ty] = TILE_POS[0];
  const r = { x: lerp(tx - TS / 2, WIN.x, k), y: lerp(ty - TS / 2, WIN.y, k), w: lerp(TS, WIN.w, k), h: lerp(TS, WIN.h, k) };
  g.save(); g.globalAlpha = clamp01(k * 2.5);
  g.translate(r.x, r.y); g.scale(r.w / WIN.w, r.h / WIN.h); g.translate(-WIN.x, -WIN.y);
  appWindow(g, ORDER[0], WIN.x, WIN.y, WIN.w); g.restore();
  const la = 1 - clamp01(k * 2.2);
  if (la > 0) { g.save(); g.globalAlpha = la; logo(g, ORDER[0], r.x + r.w / 2 - 66 * r.w / TS, r.y + r.h / 2 - 66 * r.w / TS, 132 * r.w / TS); g.restore(); }
}

/* ---------- 4. the strip: 7 windows linked by one line ---------- */
const SP = 1360, LY = [880, 1160, 940, 1200, 900, 1120, 980];
const camX = t => { let x = 0; for (let i = 1; i <= 7; i++) x += SP * spr(t - S_AT(i), CAM); return x; };
const X7 = WIN.x + 7 * SP, CX7 = X7 + 500;
function bez(p0, p3, s) { // horizontal-tangent cubic between two points
  const dx = (p3[0] - p0[0]) * 0.5, u = 1 - s;
  const p1 = [p0[0] + dx, p0[1]], p2 = [p3[0] - dx, p3[1]];
  return [u * u * u * p0[0] + 3 * u * u * s * p1[0] + 3 * u * s * s * p2[0] + s * s * s * p3[0],
    u * u * u * p0[1] + 3 * u * u * s * p1[1] + 3 * u * s * s * p2[1] + s * s * s * p3[1]];
}
function glowLine(g, pts, w = 6) {
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [lw, a] of [[w * 4, 0.12], [w * 2, 0.25], [w, 1]]) {
    g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.lineWidth = lw; g.strokeStyle = rgba(LINE, a); g.stroke();
  }
  g.restore();
}
function node(g, x, y, k) { popAt(g, x, y, k, BOUNCE, () => { g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fillStyle = LINE; g.shadowColor = LINE; g.shadowBlur = 24; g.fill(); g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fillStyle = '#eafff6'; g.fill(); }); }
function header(g, i, wx, k) {
  if (k <= 0) return;
  const a = P[ORDER[i]];
  const ls = spr(k, BOUNCE);
  if (ls > 0.01) { g.save(); g.translate(wx + 110, 290); g.scale(ls, ls); g.rotate((1 - ls) * -0.35); logo(g, a.id, -80, -80, 160); g.restore(); }
  const nk = spr(k - 0.08, SNAP), name = a.name.toUpperCase(), sz = fit(g, name, BLACK, 112, 770);
  if (k > 0.08) { g.save(); g.globalAlpha = clamp01((k - 0.08) / 0.12); g.translate((1 - nk) * 110, 0); txt(g, name, wx + 225, 252, BLACK(sz), C.text, 'left'); g.restore(); }
  popAt(g, wx + 225 + 215, 352, k - 0.2, BOUNCE, () => pill(g, 0, 0, 430, 78, C.pillPosBg, rgba(C.posInk, 0.85), `${PRICE} one time`, BOLD(40), C.posInk));
  rise(g, `${i + 1} / 7`, wx + 500, 1655, MONOB(36), rgba(C.text, 0.55), k - 0.15);
}
function strip(g, t, cx) {
  g.save(); g.translate(-cx, 0);
  const vis = x => x - cx > -1150 && x - cx < 1150;
  for (let i = 0; i < 7; i++) { // line segments (behind windows) lead the camera into the next slot
    const x0 = WIN.x + i * SP + WIN.w, p0 = [x0, LY[i]];
    const p3 = i < 6 ? [WIN.x + (i + 1) * SP, LY[i + 1]] : [X7 + 90, 1000];
    const q = spr(t - S_AT(i + 1) + 0.05, [0.6, 0.95]);
    if (q <= 0.002 || !(vis(x0) || vis(p3[0]))) continue;
    const pts = []; for (let s = 0; s <= 24; s++) pts.push(bez(p0, p3, Math.min(q, 1) * s / 24));
    const la = i < 6 ? 1 : 1 - spr(t - MORPH, SNAP); // last link retracts once the bar becomes the tag
    if (la <= 0.01) continue;
    g.save(); g.globalAlpha = la;
    glowLine(g, pts);
    node(g, p0[0], p0[1], t - S_AT(i + 1) + 0.05);
    if (i < 6) node(g, p3[0], p3[1], t - S_AT(i + 1) - 0.32);
    g.restore();
  }
  for (let i = 0; i < 7; i++) {
    const wx = WIN.x + i * SP; if (!vis(wx)) continue;
    if (i > 0 || t >= GROW + 0.6) appWindow(g, ORDER[i], wx, WIN.y, WIN.w);
    if (i < 6 && t > S_AT(i + 1) + 0.27) node(g, wx + WIN.w, LY[i], 1); // keep end nodes on top of the frame
    if (i > 0 && t > S_AT(i) + 0.3) node(g, wx, LY[i], 1);
    header(g, i, wx, t - LAND(i));
  }
  g.restore();
}

/* ---------- 5. line -> install bar -> $149.99 tag that swings, flips; pull out to the logo ---------- */
const PIV_Y = -60, TAG = { w: 640, h: 360, cy: 1050 };
function finale(g, t, cx) {
  g.save(); g.translate(-cx, 0);
  const done = t >= FILL1, f = ease(t, FILL0, FILL1, inOutCubic), m = spr(t - MORPH, [0.5, 0.7]);
  const fade = 1 - spr(t - MORPH, SNAP);
  if (fade > 0.01) { // install readout
    g.save(); g.globalAlpha = fade;
    rise(g, done ? 'All 7 installed' : 'Installing all 7\u2026', CX7, 560, BOLD(62), C.soft, t - TRACK);
    const pz = done ? 1 + 0.14 * (1 - spr(t - FILL1, BOUNCE)) : 1;
    if (t > TRACK) { g.save(); g.globalAlpha *= clamp01((t - TRACK) / 0.2); g.translate(CX7, 790); g.scale(pz, pz); txt(g, `${Math.round(f * 100)}%`, 0, 0, BLACK(260), done ? LINE : C.text); g.restore(); }
    g.restore();
  }
  if (t < MORPH) { // track + fill (the line continuing straight)
    g.save(); g.globalAlpha = ease(t, TRACK, TRACK + 0.25);
    rr(g, X7 + 90, 987, 900, 26, 13); g.fillStyle = C.raised; g.fill(); g.restore();
    if (f > 0) glowLine(g, [[X7 + 90, 1000], [X7 + 90 + 900 * f, 1000]], 14);
  } else { // bar morphs into the tag, which hangs from the pivot and swings
    const r = { x: lerp(X7 + 90, CX7 - TAG.w / 2, m), y: lerp(987, TAG.cy - TAG.h / 2, m), w: lerp(900, TAG.w, m), h: lerp(26, TAG.h, m) };
    const tau = t - SWING, th = tau > 0 ? 0.2 * Math.exp(-0.9 * tau) * Math.sin(4.4 * tau) : 0;
    g.save(); g.translate(CX7, PIV_Y); g.rotate(th); g.translate(-CX7, -PIV_Y);
    const sa = clamp01((m - 0.45) * 2.5), holeY = r.y + 46;
    if (sa > 0) { g.save(); g.globalAlpha = sa; g.beginPath(); g.moveTo(CX7, PIV_Y); g.lineTo(CX7, holeY - 18); g.lineWidth = 3; g.strokeStyle = 'rgba(230,230,235,0.75)'; g.stroke(); g.restore(); }
    const fl = clamp01(spr(t - FLIP, [0.55, 1])), sx = Math.cos(Math.PI * fl), back = sx < 0;
    g.save(); g.translate(CX7, r.y + r.h / 2); g.scale(Math.max(0.001, Math.abs(sx)), 1); g.translate(-CX7, -(r.y + r.h / 2));
    g.shadowColor = rgba(LINE, 0.4); g.shadowBlur = 70;
    rr(g, r.x, r.y, r.w, r.h, Math.min(44, r.h / 2)); g.fillStyle = back ? '#1b1b21' : LINE; g.fill(); g.shadowBlur = 0;
    if (back) { g.lineWidth = 4; g.strokeStyle = LINE; g.stroke(); }
    const ta = clamp01((m - 0.7) / 0.3);
    if (ta > 0) {
      g.save(); g.globalAlpha = ta;
      g.beginPath(); g.arc(CX7, holeY, 18, 0, 7); g.fillStyle = C.ground; g.fill();
      g.lineWidth = 3; g.strokeStyle = back ? LINE : 'rgba(14,14,17,0.5)'; g.stroke();
      if (!back) {
        txt(g, PRICE, CX7, TAG.cy + 10, BLACK(150), C.ground);
        txt(g, 'per platform \u00b7 one time', CX7, TAG.cy + 110, BOLD(38), 'rgba(14,14,17,0.72)');
      } else {
        txt(g, 'PAY ONCE.', CX7, TAG.cy - 15, BLACK(fit(g, 'PAY ONCE.', BLACK, 96, 560)), C.text);
        txt(g, 'TRADE FOREVER.', CX7, TAG.cy + 85, BLACK(fit(g, 'TRADE FOREVER.', BLACK, 76, 560)), LINE);
      }
      g.restore();
    }
    g.restore(); g.restore();
    popAt(g, CX7, PIV_Y - 150, t - PULL - 0.15, BOUNCE, () => ico(g, -150, -150, 300, 90)); // the tag hangs from the brand
  }
  g.restore();
}

/* ---------- world ---------- */
const M2 = createCanvas(W, H), m2 = M2.getContext('2d');
function main(g, t) {
  const cx = camX(t), z = 1 - 0.34 * spr(t - PULL, [0.9, 1]);
  const slot = cx / SP, i0 = Math.min(6, Math.floor(slot)), fr = slot - i0;
  const hue = slot >= 6.5 ? mixHex(P.jig.hue, LINE, clamp01((slot - 6) * 1.5)) : mixHex(P[ORDER[i0]].hue, P[ORDER[Math.min(6, i0 + 1)]].hue, inOutSine(clamp01(fr)));
  bg(g, cx * 0.3, t < GROW ? C.accent : hue, 0.14);
  g.save(); g.translate(540, 1300); g.scale(z, z); g.translate(-540, -1300);
  if (t < GROW + 0.7) tiles(g, t);
  if (t >= GROW && t < GROW + 0.6) growWindow(g, t);
  if (t >= GROW) strip(g, t, cx);
  if (t >= TRACK - 0.6) finale(g, t, cx);
  g.restore();
  if (t > WORD - 0.1) { // end card text, screen-fixed
    rise(g, 'Trade Bay', W / 2, 1365, BLACK(104), C.text, t - WORD);
    rise(g, `7 platforms \u00b7 ${PRICE} each`, W / 2, 1450, SEMI(46), C.soft, t - WORD - 0.12);
    const br = 1 + 0.03 * Math.sin(Math.max(0, t - PILL - 0.6) * Math.PI * 3);
    popAt(g, W / 2, 1565, t - PILL, BOUNCE, () => { g.scale(br, br); pill(g, 0, 0, 560, 124, '#ffffff', null, 'LINK IN BIO', BLACK(60), C.ground); });
  }
}
function drawWorld(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none';
  g.fillStyle = C.ground; g.fillRect(0, 0, W, H);
  if (t < XF1) intro(g, t);
  if (t >= XF0) {
    if (t < XF1) { // crossfade inside the O's counter
      m2.setTransform(1, 0, 0, 1, 0, 0); m2.globalAlpha = 1; m2.fillStyle = C.ground; m2.fillRect(0, 0, W, H);
      main(m2, t); g.globalAlpha = ease(t, XF0, XF1); g.drawImage(M2, 0, 0); g.globalAlpha = 1;
    } else main(g, t);
  }
}

/* ---------- frame: 5-sample motion blur + grain + vignette ---------- */
const N = 5, SHUT = 1 / 120;
const out = createCanvas(W, H), o = out.getContext('2d');
const T = createCanvas(W, H), tg = T.getContext('2d');
const GRAIN = [0, 1, 2, 3].map(s => {
  const c = createCanvas(360, 640), gg = c.getContext('2d'), id = gg.createImageData(360, 640);
  for (let p = 0; p < 360 * 640; p++) { const v = 128 + (rnd(p * 0.37 + s * 911.3) - 0.5) * 90; id.data[p * 4] = id.data[p * 4 + 1] = id.data[p * 4 + 2] = v; id.data[p * 4 + 3] = 255; }
  gg.putImageData(id, 0, 0); return c;
});
const VIG = (() => {
  const c = createCanvas(W, H), gg = c.getContext('2d'), r = gg.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
  r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, 'rgba(0,0,0,0.5)'); gg.fillStyle = r; gg.fillRect(0, 0, W, H); return c;
})();
function renderFrame(f) {
  FRAME = f;
  const t = f / FPS;
  o.globalCompositeOperation = 'source-over';
  for (let k = 0; k < N; k++) {
    drawWorld(tg, t - SHUT * k / (N - 1));
    o.globalAlpha = 1 / (k + 1); o.drawImage(T, 0, 0);
  }
  o.globalAlpha = 1; o.drawImage(VIG, 0, 0);
  o.globalCompositeOperation = 'overlay'; o.globalAlpha = 0.07; o.drawImage(GRAIN[f % 4], 0, 0, W, H);
  o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
}

/* ---------- sound timeline ---------- */
const ev = [];
for (let k = 0; ; k++) { // one printer tick per receipt row
  const u = (-120 + Math.sqrt(120 * 120 + 4 * 520 * (40 + k * ROW))) / 1040;
  if (u >= JAM) break; if (k < 18 || k % 2 === 0) ev.push(['tick', u]);
}
ev.push(['pop', JAM], ['rip', TEAR], ['boom', TICKET + 0.05], ['whoosh', 3.95], ['boom', 4.3], ['pop', ICON + 0.05]);
ORDER.forEach((_, i) => ev.push(['tick', FLIPS + i * 0.035 + 0.12]));
ev.push(['whoosh', GROW]);
for (let i = 1; i <= 7; i++) ev.push(['whoosh', S_AT(i)]);
for (let i = 0; i < 7; i++) ev.push(['pop', LAND(i) + 0.05]);
ev.push(['riser', FILL1 - 2.2], ['notif', FILL1], ['pop', MORPH + 0.05], ['whoosh', SWING], ['whoosh', FLIP], ['boom', PULL], ['chime', WORD], ['pop', PILL]);
writeFileSync('out/timeline_line.json', JSON.stringify({ dur: DUR, events: ev.map(([n, a]) => [n, +a.toFixed(3)]) }, null, 1));

(async () => {
  setIco(await loadIco());
  for (const a of APPS) LOGOS[a.letters] = await loadImage(`icons/${a.id}.png`);
  console.log(`${DUR}s, ${FRAMES} frames, ${ev.length} sfx`);
  if (SMOKE) {
    const want = (process.env.TIMES || '0.6,1.6,2.35,2.62,2.9,3.4,3.9,4.2,4.4,4.6,4.8,5.0,5.3,5.8,6.6,7.0,8.1,9.6,11.1,12.6,14.1,15.3,15.6,16.3,16.9,17.2,17.6,18.5,18.85,19.7,20.2,21.5')
      .split(',').map(s => Math.round(+s * FPS));
    for (const f of want) { renderFrame(f); writeFileSync(`qc/ln_${String(f).padStart(4, '0')}.png`, out.toBuffer('image/png')); }
    console.log('SMOKE done', want.length, 'stills'); return;
  }
  const ff = spawn(FF, ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', 'out/tradebay_line_nosound.mp4'],
  { stdio: ['pipe', 'inherit', 'pipe'] });
  let tail = ''; ff.stderr.on('data', d => { tail = (tail + d).slice(-3000); });
  const done = new Promise(res => ff.on('exit', res));
  const t0 = Date.now();
  for (let f = 0; f < FRAMES; f++) {
    renderFrame(f);
    const px = o.getImageData(0, 0, W, H).data;
    if (!ff.stdin.write(Buffer.from(px.buffer, px.byteOffset, px.byteLength))) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 120 === 0) console.log(`frame ${f}/${FRAMES} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  const code = await done;
  if (code === 0) console.log('VIDEO RENDER OK'); else { console.error('ffmpeg exit', code, tail); process.exit(1); }
})();
