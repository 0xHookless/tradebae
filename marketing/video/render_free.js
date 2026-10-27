// Trade Bay — two 18s "free" videos (dark style, live ATAS X footprint). Never states the condition: both end on
// "Want it free? Find out how in our Discord."
//   dont: a Buy $149.99 button runs away from the cursor, folds and falls -> ATAS X live -> 6 more platforms -> Discord
//   cart: 7 platforms in a cart, total $1,049.93; a FREE stamp slams on each row, total rolls to $0.00 -> ATAS X live -> counters -> Discord
// Usage: node render_free.js <dont|cart>  [SMOKE=1 TIMES=...]  then  GAIN=2.6 node assemble_short.js free_<name>
const E = require('./engines.js');
const { W, H, APPS, clamp01, lerp, rr, ico, loadIco, setIco, LOGOS, tile, createCanvas, GlobalFonts, FF } = E;
const { loadImage } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');

const NAME = process.argv[2];
if (!['dont', 'cart'].includes(NAME)) { console.error('usage: node render_free.js <dont|cart>'); process.exit(1); }
const OUTN = `free_${NAME}`, FPS = 60, DUR = 18, FRAMES = DUR * FPS, SMOKE = !!process.env.SMOKE;
const PRICE = '$149.99', TOTAL = 149.99 * 7;
// Confirmed placeholders (same reasons as the other Discord videos) + the hook line.
const DISCORD = ['Here’s how to get it free.', 'Get help with setup, live.', 'Hear about updates first.'];
mkdirSync('out', { recursive: true }); mkdirSync('qc', { recursive: true });

GlobalFonts.registerFromPath('fonts/HankenGrotesk-400.ttf', 'Hanken');
GlobalFonts.registerFromPath('fonts/HankenGrotesk-500.ttf', 'Hanken');
const K = { bg: '#0b0b0e', surf: '#151519', raise: '#1f1f25', text: '#f2f2f0', muted: '#9a9ca4', green: '#5fc39c', red: '#e5566f', discord: '#5865F2' };
const F5 = s => `500 ${s}px Hanken`, F4 = s => `400 ${s}px Hanken`;
const X = 80, MAXW = 920;

function spr(t, [response, damping]) {
  if (t <= 0) return 0;
  const w0 = 2 * Math.PI / response;
  if (damping >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + (damping * w0 / wd) * Math.sin(wd * t));
}
const CALM = [0.5, 1], POP = [0.42, 0.6], SOFT = [0.6, 0.95], DODGE = [0.3, 0.55], DROP = [0.5, 0.55], SLAM = [0.3, 0.6];
const smooth = x => x * x * (3 - 2 * x), outCubic = x => 1 - Math.pow(1 - x, 3), inCubic = x => x * x * x;
const inOut = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const ease = (t, a, b, f = smooth) => f(clamp01((t - a) / (b - a)));

function T(g, s, x, y, font, fill, align = 'left', ls = 0) { g.font = font; g.fillStyle = fill; g.textAlign = align; g.textBaseline = 'middle'; g.letterSpacing = `${ls}px`; g.fillText(s, x, y); g.letterSpacing = '0px'; }
function wrap(g, s, font, maxW) {
  g.font = font; g.letterSpacing = '0px'; const out = []; let line = '';
  for (const w of s.split(' ')) { const t2 = line ? line + ' ' + w : w; if (g.measureText(t2).width > maxW && line) { out.push(line); line = w; } else line = t2; }
  return [...out, line];
}
function fadeIn(g, k, dy = 28) { g.globalAlpha *= clamp01(k / 0.2); g.translate(0, dy * (1 - spr(k, CALM))); }
function captions(g, t, CAPS) {
  for (const [a, b, s] of CAPS) {
    const k = t - a, o = t - (b - 0.12); if (k <= 0 || o > 0.3) continue;
    g.save(); fadeIn(g, k, 34);
    if (o > 0) { const e = ease(o, 0, 0.28); g.globalAlpha *= 1 - e; g.translate(0, -40 * e); }
    wrap(g, s, F5(66), MAXW).forEach((l, i) => T(g, l, X, 250 + i * 78, F5(66), K.text, 'left', -1.3));
    g.restore();
  }
}

/* ---------- live ATAS X (the site's footprint engine, taller candles) ---------- */
const EL = 680, DPR = 2, ax = APPS.find(a => a.id === 'ax');
const axCv = createCanvas(EL * DPR, EL * DPR), axSc = new E.Footprint({ seed: ax.seed, sym: ax.sym, hue: ax.hue, variant: ax.variant }, EL, EL);
axSc.ctx = axCv.getContext('2d'); axSc.w = EL; axSc.h = EL; axSc.per = 55; for (let k = 0; k < 275; k++) axSc.step();
let FRAME = 0, axLast = -1;
function axChart() { if (axLast !== FRAME) { axSc.step(); axSc.ctx.setTransform(DPR, 0, 0, DPR, 0, 0); axSc.draw(); axLast = FRAME; } return axCv; }
function cover(g, img, x, y, w, h) { const s = Math.max(w / img.width, h / img.height), sw = w / s, sh = h / s; g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h); }
function appIcon(g, a, x, y, s) { tile(g, x, y, s, a.hue, a.letters, s * 0.3); }
const WIN = { w: 1000, h: 1100 };
function axWindow(g) { // origin = top-left of a 1000x1100 window
  rr(g, 0, 0, WIN.w, WIN.h, 26); g.fillStyle = K.surf; g.fill();
  g.save(); rr(g, 0, 0, WIN.w, WIN.h, 26); g.clip();
  appIcon(g, ax, 24, 15, 40); T(g, 'ATAS X', 78, 36, F5(34), K.text); T(g, 'NQZ6', 210, 38, F4(26), K.muted);
  cover(g, axChart(), 0, 70, WIN.w, WIN.h - 70); g.restore();
}
function inPose(g, cx, cy, s, draw) { g.save(); g.translate(cx, cy); g.scale(s, s); g.translate(-WIN.w / 2, -WIN.h / 2); draw(); g.restore(); }

/* ---------- shared pieces ---------- */
function cursor(g, x, y, press, a = 1) {
  if (a <= 0) return;
  g.save(); g.globalAlpha *= a; g.translate(x, y); g.scale(2.4 * press, 2.4 * press);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 34); g.lineTo(9, 26); g.lineTo(15, 40); g.lineTo(21, 37); g.lineTo(15, 24); g.lineTo(26, 24); g.closePath();
  g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke(); g.restore();
}
function path(t, keys) {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, x0, y0] = keys[i - 1], [b, x1, y1] = keys[i], e = inOut((t - a) / (b - a)); return [lerp(x0, x1, e), lerp(y0, y1, e)]; }
  const l = keys[keys.length - 1]; return [l[1], l[2]];
}
const pressAt = (t, clicks) => clicks.reduce((p, c) => p * (1 - 0.18 * Math.sin(Math.PI * clamp01((t - c) / 0.14))), 1);
function stamp(g, x, y, k, w = 200, h = 78, rot = -0.12) { // green FREE stamp slamming down
  if (k <= 0) return;
  const s = 1 + 1.3 * (1 - spr(k, SLAM));
  g.save(); g.globalAlpha *= clamp01(k / 0.06); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.lineWidth = 6; g.strokeStyle = K.green; rr(g, -w / 2, -h / 2, w, h, 10); g.stroke();
  T(g, 'FREE', 0, 3, F5(h * 0.78), K.green, 'center', 3); g.restore();
}
function discordPill(g, t, a0, a1) {
  const k = t - a0; if (k <= 0 || t > a1) return;
  const s = spr(k, POP) * (1 + 0.05 * Math.sin(Math.PI * clamp01((k - 0.9) / 0.4)));
  g.save(); g.globalAlpha = 1 - ease(t, a1 - 0.4, a1); g.translate(W / 2, 1700); g.scale(s, s);
  rr(g, -380, -55, 760, 110, 55); g.fillStyle = K.discord; g.fill(); T(g, 'Join the Discord. Link in bio.', 0, 2, F5(46), '#fff', 'center'); g.restore();
}
function chat(g, t, a0) {
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
function buyButton(g, x, y, fold = 0, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(1, Math.max(0.05, 1 - fold));
  rr(g, -320, -85, 640, 170, 24); g.fillStyle = K.text; g.fill();
  T(g, `Buy ${PRICE}`, 0, 3, F5(76), K.bg, 'center', -2); g.restore();
}

/* ================= dont ================= */
const P0 = [540, 1250], P1 = [240, 1500], P2 = [830, 1270];
const BTN = t => [P0[0] + (P1[0] - P0[0]) * spr(t - 1.0, DODGE) + (P2[0] - P1[0]) * spr(t - 1.9, DODGE),
  P0[1] + (P1[1] - P0[1]) * spr(t - 1.0, DODGE) + (P2[1] - P1[1]) * spr(t - 1.9, DODGE)];
const CUR = [[0, 950, 1750], [0.95, 600, 1300], [1.5, 420, 1410], [1.85, 270, 1530], [2.4, 830, 1310], [3.3, 840, 1320]];
const OTHERS = APPS.filter(a => a.id !== 'ax'), RING = i => { const an = (-90 + i * 60) * Math.PI / 180; return [Math.cos(an), Math.sin(an)]; };
function dontWorld(g, t) {
  const gp = spr(t - 2.9, SOFT), sp = spr(t - 10.5, SOFT), cl = ease(t, 13.5, 14.0, inCubic);
  const s = lerp(lerp(1, 1.08, gp) * (1 + 0.05 * ease(t, 3.5, 10.3)), 0.46, sp) * (1 - cl);
  if (s > 0.01) inPose(g, 540, lerp(lerp(970, 1040, gp), 960, sp), s, () => axWindow(g));
  OTHERS.forEach((a, i) => {
    const k = t - (11.2 + i * 0.3); if (k <= 0) return;
    const [dx, dy] = RING(i), r = (400 + (1 - spr(k, [0.45, 0.7])) * 900) * (1 - cl), sc = 1 - cl;
    if (sc <= 0.01) return;
    g.save(); g.globalAlpha = clamp01(k / 0.1); g.translate(540 + dx * r, 960 + dy * r); g.scale(sc, sc);
    appIcon(g, a, -75, -75, 150); T(g, a.name, 0, 112, F4(30), K.muted, 'center'); g.restore();
  });
  // the button that runs away, folds and falls
  const [bx, by] = BTN(t), fold = spr(t - 2.55, [0.3, 1]) * 0.93, fall = ease(t, 2.95, 3.9, inCubic);
  if (t < 4 && by + fall * 1400 < H + 200) buyButton(g, bx, by + fall * 1400, fold, fold * 0.25 * (1 - fall));
  discordPill(g, t, 9.0, 14.0);
  g.save(); g.globalAlpha = 1 - ease(t, 17.4, 17.9); chat(g, t, 13.7); g.restore();
  if (t > 17.5) { g.save(); g.globalAlpha = ease(t, 17.5, 17.9); buyButton(g, 540, lerp(H + 130, 1790, spr(t - 17.5, SOFT))); g.restore(); }
  const [cx, cy] = path(t, CUR); cursor(g, cx, cy, pressAt(t, [0.97, 1.87, 2.45]), 1 - ease(t, 3.0, 3.4));
}
const DONT = {
  caps: [[0, 2.5, 'Don’t buy ATAS X.'], [2.5, 4.0, 'Seriously. Don’t.'], [4.0, 9.0, 'Because you can get it free.'], [9.0, 10.5, 'Find out how in the Discord.'],
    [10.5, 13.5, 'Same for 6 more pro platforms.'], [13.5, 18.5, 'Want it free? Find out how in our Discord.']],
  world: dontWorld,
  sfx: () => [['whoosh', 0.1], ['pop', 0.97], ['whoosh', 1.0], ['pop', 1.87], ['whoosh', 1.9], ['pop', 2.45], ['whoosh', 2.6], ['whoosh', 3.0], ['boom', 3.9], ['pop', 9.0],
    ...OTHERS.map((_, i) => ['tick', 11.35 + i * 0.3]), ['whoosh', 13.5], ...DISCORD.map((_, i) => ['notif', 14.0 + i * 0.6]), ['pop', 15.9], ['chime', 15.95], ['whoosh', 17.5]],
};

/* ================= cart ================= */
const RY = i => 470 + i * 125, TS = i => 2.55 + i * 0.45, TL = i => 0.15 + i * 0.18, AXI = APPS.findIndex(a => a.id === 'ax');
const money = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function cartWorld(g, t) {
  const m = spr(t - 6.0, SOFT), outD = ease(t, 6.0, 6.5, inCubic), shrink = ease(t, 11.2, 11.7, inCubic);
  APPS.forEach((a, i) => {
    const k = t - TL(i); if (k <= 0 || (i === AXI && t > 6.0)) return;
    const y = lerp(-160, RY(i), spr(k, DROP)) + outD * 1500, st = clamp01((t - TS(i)) / 0.3);
    if (y > H + 100) return;
    g.save(); g.globalAlpha = clamp01(k / 0.05);
    rr(g, X, y, MAXW, 110, 18); g.fillStyle = K.raise; g.fill();
    if (st > 0) { rr(g, X, y, MAXW, 110, 18); g.fillStyle = `rgba(95,195,156,${0.12 * st})`; g.fill(); }
    appIcon(g, a, X + 22, y + 15, 80); T(g, a.name, X + 126, y + 56, F5(48), K.text);
    T(g, PRICE, X + MAXW - 28, y + 56, F4(48), st > 0.5 ? K.muted : K.text, 'right');
    if (st > 0.5) { g.font = F4(48); const w = g.measureText(PRICE).width; g.fillStyle = K.muted; g.fillRect(X + MAXW - 28 - w, y + 55, w, 3); }
    g.restore();
    stamp(g, X + 560, y + 55, t - TS(i), 180, 72);
  });
  // total
  const left = APPS.reduce((s, _, i) => s + (1 - ease(t, TS(i), TS(i) + 0.3)), 0), rolled = ease(t, 0.15, 2.3, outCubic);
  const tot = left < 0.001 ? 0 : TOTAL * rolled * (left / 7), done = left < 0.001;
  const ta = (clamp01((t - 0.2) / 0.3)) * (1 - ease(t, 6.0, 6.4));
  if (ta > 0) { g.save(); g.globalAlpha = ta; T(g, 'Total', X, 1500, F5(56), K.muted); T(g, money(tot), X + MAXW, 1500, F5(130), done ? K.green : K.red, 'right', -5); g.restore(); }
  // ATAS X row grows into the live chart
  if (t >= 6.0 && shrink < 1) {
    const r = { x: lerp(X, 0, m), y: lerp(RY(AXI), 380, m), w: lerp(MAXW, W, m), h: lerp(110, 1300, m) }, z = (1 + 0.06 * ease(t, 6.5, 11)) * (1 - shrink);
    g.save(); g.translate(r.x + r.w / 2, r.y + r.h / 2); g.scale(z, z); g.translate(-r.w / 2, -r.h / 2);
    rr(g, 0, 0, r.w, r.h, Math.max(0, lerp(18, 0, m))); g.save(); g.clip(); g.fillStyle = K.raise; g.fillRect(0, 0, r.w, r.h);
    cover(g, axChart(), 0, 0, r.w, r.h); g.restore();
    g.globalAlpha = 1 - clamp01(m * 3); appIcon(g, ax, 22, 15, 80); T(g, 'ATAS X', 126, 56, F5(48), K.text); g.globalAlpha = 1;
    if (m > 0.6) { g.globalAlpha = clamp01((m - 0.6) / 0.3); rr(g, 50, 30, 330, 96, 18); g.fillStyle = 'rgba(11,11,14,0.85)'; g.fill(); appIcon(g, ax, 70, 46, 64); T(g, 'ATAS X', 150, 78, F5(46), K.text); }
    g.restore();
  }
  discordPill(g, t, 10.0, 14.0);
  // value vs paid
  [['Software unlocked', 700, 11.5, K.green, TOTAL * ease(t, 11.7, 13.3, outCubic)], ['You paid', 1060, 11.9, K.text, 0]].forEach(([lab, y, a0, col, v]) => {
    const k = t - a0; if (k <= 0 || t > 14.4) return;
    g.save(); fadeIn(g, k, 40); g.globalAlpha *= 1 - ease(t, 13.7, 14.2);
    T(g, lab, X, y, F4(46), K.muted); T(g, money(v), X, y + 135, F5(170), col, 'left', -7); g.restore();
  });
  chat(g, t, 14.0);
  if (t > 17.0) stamp(g, 910, 1395, t - 17.0, 190, 74, -0.12);
}
const CART = {
  caps: [[0, 2.5, 'All 7 pro trading platforms:'], [2.5, 6.0, 'Or $0.'], [6.0, 10.0, 'Including ATAS X. The real thing.'], [10.0, 11.5, 'Here’s how.'],
    [11.5, 14.0, 'Full builds. Kept up to date.'], [14.0, 18.5, 'Want it free? Find out how in our Discord.']],
  world: cartWorld,
  sfx: () => [...APPS.map((_, i) => ['tick', TL(i) + 0.12]), ...APPS.map((_, i) => ['pop', TS(i)]), ['boom', TS(6)], ['whoosh', 6.0], ['boom', 6.15], ['pop', 10.0],
    ['whoosh', 11.4], ['tick', 11.75], ['tick', 12.25], ['tick', 12.75], ['pop', 13.3], ...DISCORD.map((_, i) => ['notif', 14.3 + i * 0.6]), ['pop', 16.2], ['chime', 16.25], ['boom', 17.0]],
};

/* ---------- frame ---------- */
const V = { dont: DONT, cart: CART }[NAME];
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
    const ts = (process.env.TIMES || (NAME === 'dont' ? '0.5,1.0,1.4,2.3,2.7,3.2,3.6,5,7.5,9.5,11.0,12.2,13.0,14.2,15.4,16.8,17.7'
      : '0.4,0.9,1.5,2.4,3.2,4.4,5.6,6.4,8,10.5,11.3,12.4,13.6,14.8,16.5,17.5')).split(',');
    for (const s of ts) { const f = Math.round(+s * FPS); renderFrame(f); writeFileSync(`qc/fr_${NAME}_${String(f).padStart(4, '0')}.png`, out.toBuffer('image/png')); }
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
