// Trade Bay — 25s non-linear TikTok cut. 120 BPM: every cut starts on a beat / half-beat.
// Story: payoff first (PAID ONCE) -> rewind -> monthly-bill problem -> drop -> 7 platforms (1.5s each)
// -> launcher -> benefits -> $149.99 -> CTA. Raw RGBA frames piped into ffmpeg (no PNG encode).
// All motion runs on damped springs (spr) or eased curves; slides use true multi-sample motion blur.
// Usage: node render_short.js          -> out/tradebay_short_nosound.mp4 (+ out/timeline_short.json)
//        SMOKE=1 node render_short.js  -> renders every frame, writes QC stills to qc/
const E = require('./engines.js');
const { W, H, C, APPS, clamp01, lerp, outExpo, outCubic, inOutSine, shake, rnd,
  rr, txt, tile, ico, loadIco, setIco, LOGOS, rgba, mixHex, createCanvas, GlobalFonts, FF } = E;
const { loadImage } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');

const FPS = 60, PRICE = '$149.99';
const SMOKE = !!process.env.SMOKE;
mkdirSync('out', { recursive: true }); mkdirSync('qc', { recursive: true });

/* ---------- fonts: heavy display face for TikTok-readable text ---------- */
GlobalFonts.registerFromPath('C:/Windows/Fonts/seguibl.ttf', 'TB Black');
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeuib.ttf', 'TB Bold');
GlobalFonts.registerFromPath('C:/Windows/Fonts/seguisb.ttf', 'TB Semi');
GlobalFonts.registerFromPath('C:/Windows/Fonts/consolab.ttf', 'TB Mono');
const BLACK = s => `${s}px "TB Black"`, BOLD = s => `${s}px "TB Bold"`;
const SEMI = s => `${s}px "TB Semi"`, MONOB = s => `${s}px "TB Mono"`;
const P = Object.fromEntries(APPS.map(a => [a.id, a]));

/* ---------- springs: unit step response of a damped harmonic oscillator ----------
   response = natural period in seconds (smaller = faster), damping = zeta (<1 overshoots). */
function spr(t, [response, damping]) {
  if (t <= 0) return 0;
  const w0 = 2 * Math.PI / response;
  if (damping >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + (damping * w0 / wd) * Math.sin(wd * t));
}
const SNAP = [0.32, 0.8];    // quick, tiny overshoot: text
const BOUNCE = [0.42, 0.5];  // visible bounce: icons, pills, notifications
const SETTLE = [0.4, 0.72];  // notification stack pushing down
const SOFT = [0.55, 0.95];   // near-critical: camera slides
const SLAM = [0.3, 0.55];    // big words landing

/* ---------- live chart engines (site/app.js ports), crisp at 2x ---------- */
const EL = 680, DPR = 2; // logical 680x680, rendered 1360x1360
const ENG = {};
for (const a of APPS) {
  const cv = createCanvas(EL * DPR, EL * DPR);
  const Maker = { footprint: E.Footprint, heatmap: E.Heatmap, candles: E.Candles, waves: E.Waves }[a.scene];
  const sc = new Maker({ seed: a.seed, sym: a.sym, hue: a.hue, dom: a.dom, variant: a.variant }, EL, EL);
  sc.ctx = cv.getContext('2d'); sc.w = EL; sc.h = EL;
  if (a.scene === 'footprint') { sc.per = 55; for (let k = 0; k < 55 * 5; k++) sc.step(); } // taller, fuller candles
  ENG[a.id] = { cv, sc, last: -1 };
}
let FRAME = 0;
function chart(id) {
  const e = ENG[id];
  if (e.last !== FRAME) { e.sc.step(); e.sc.ctx.setTransform(DPR, 0, 0, DPR, 0, 0); e.sc.draw(); e.last = FRAME; }
  return e.cv;
}

/* ---------- helpers ---------- */
const dots = (() => {
  const c = createCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = C.ground; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 9; y < H; y += 18) for (let x = 9; x < W; x += 18) g.fillRect(x, y, 1.6, 1.6);
  return c;
})();
function bg(g, glow = C.accent, a = 0.18, cy = H * 0.45) {
  g.drawImage(dots, 0, 0);
  const r = g.createRadialGradient(W / 2, cy, 0, W / 2, cy, H * 0.55);
  r.addColorStop(0, rgba(glow, a)); r.addColorStop(1, rgba(glow, 0));
  g.fillStyle = r; g.fillRect(0, 0, W, H);
}
function coverChart(g, id, z = 1, alpha = 1, blur = 0) { // chart filling the whole frame
  const s = (H / EL) * z;
  g.save(); g.globalAlpha = alpha; if (blur) g.filter = `blur(${blur}px)`;
  g.translate(W / 2, H / 2); g.scale(s / DPR, s / DPR); g.translate(-EL * DPR / 2, -EL * DPR / 2);
  g.drawImage(chart(id), 0, 0); g.restore();
}
function shade(g, top = 0.75, mid = 0.25, bot = 0.75) {
  const l = g.createLinearGradient(0, 0, 0, H);
  l.addColorStop(0, `rgba(10,10,13,${top})`); l.addColorStop(0.5, `rgba(10,10,13,${mid})`); l.addColorStop(1, `rgba(10,10,13,${bot})`);
  g.fillStyle = l; g.fillRect(0, 0, W, H);
}
const ease = (t, a, b, f = inOutSine) => f(clamp01((t - a) / (b - a)));
function fit(g, s, font, size, maxW) { g.font = font(size); const w = g.measureText(s).width; return w > maxW ? Math.floor(size * maxW / w) : size; }
// word slam: lands oversized and springs down to size with a small bounce
function slam(g, s, x, y, font, size, fill, k, maxW = 940, glow = 0) {
  if (k < 0) return;
  const sz = fit(g, s, font, size, maxW), sc = 1.45 - 0.45 * spr(k, SLAM);
  g.save(); g.globalAlpha = clamp01(k / 0.05);
  g.translate(x, y); g.scale(sc, sc);
  g.font = font(sz); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = glow ? rgba(fill, 0.55) : 'rgba(0,0,0,0.75)'; g.shadowBlur = glow || 24;
  g.fillStyle = fill; g.fillText(s, 0, 0); g.restore();
}
function rise(g, s, x, y, font, fill, k, align = 'center') { // soft spring up + fade in
  if (k <= 0) return;
  const p = spr(k, SNAP);
  g.save(); g.globalAlpha = clamp01(k / 0.15); g.translate(0, (1 - p) * 40);
  g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 16;
  txt(g, s, x, y, font, fill, align); g.restore();
}
function camShake(g, k, amt) { if (k > 0 && k < 0.5) g.translate(shake(k) * amt, shake(k * 1.13 + 0.02) * amt * 0.7); }
function pill(g, x, y, w, h, fill, stroke, label, font, ink) {
  rr(g, x - w / 2, y - h / 2, w, h, h / 2); g.fillStyle = fill; g.fill();
  if (stroke) { g.lineWidth = 3; g.strokeStyle = stroke; g.stroke(); }
  if (label) txt(g, label, x, y + 2, font, ink);
}
function popAt(g, x, y, k, cfg, draw) { // spring scale-in around (x, y)
  const s = spr(k, cfg); if (s <= 0.01) return;
  g.save(); g.translate(x, y); g.scale(s, s); draw(); g.restore();
}
function check(g, x, y, r, k) {
  popAt(g, x, y, k, BOUNCE, () => {
    g.beginPath(); g.arc(0, 0, r, 0, 7); g.fillStyle = C.pillPosBg; g.fill();
    g.lineWidth = Math.max(4, r * 0.07); g.strokeStyle = C.posInk; g.stroke();
    const d = ease(k, 0.06, 0.3, outCubic);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = r * 0.16;
    g.beginPath(); g.moveTo(-r * 0.42, 0);
    if (d < 0.4) g.lineTo(lerp(-r * 0.42, -r * 0.1, d / 0.4), lerp(0, r * 0.3, d / 0.4));
    else { g.lineTo(-r * 0.1, r * 0.3); g.lineTo(lerp(-r * 0.1, r * 0.45, (d - 0.4) / 0.6), lerp(r * 0.3, -r * 0.32, (d - 0.4) / 0.6)); }
    g.stroke();
  });
}
function logo(g, id, x, y, s) { const a = P[id]; tile(g, x, y, s, a.hue, a.letters, Math.round(s * 0.3)); }

// app window: title bar (logo, name, symbol, price) + live chart + footer caption
function appWindow(g, id, x, y, w) {
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

/* ---------- shots ---------- */
const REWIND = []; // half-res copies of the cold open, replayed backwards
const SHOTS = [], MARK = {};
const shot = (dur, tr, sfx, draw) => SHOTS.push({ dur, tr, sfx, draw });

// COLD OPEN — the ending first
shot(1.0, 'punch', [['boom', 0]], (g, t) => {
  camShake(g, t - 0.02, 16);
  coverChart(g, 'bm', lerp(1.12, 1.0, ease(t, 0, 1, outCubic)));
  shade(g, 0.55, 0.6, 0.7);
  slam(g, 'PAID', W / 2, 820, BLACK, 260, C.text, t - 0.02);
  slam(g, 'ONCE.', W / 2, 1060, BLACK, 260, C.posInk, t - 0.14, 940, 40);
  rise(g, 'owned for life', W / 2, 1250, SEMI(56), C.soft, t - 0.35);
});
// REWIND
shot(0.5, 'cut', [['rewind', 0]], (g, t, d, f) => {
  const n = REWIND.length;
  const fr = REWIND[Math.max(0, Math.min(n - 1, n - 1 - Math.floor(ease(t, 0, d, outCubic) * n)))];
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  if (fr) {
    g.save(); g.filter = 'grayscale(0.7) contrast(1.2)'; g.drawImage(fr, 0, 0, W, H); g.restore();
    g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.35; g.drawImage(fr, 14, 0, W, H); g.restore();
    for (let b = 0; b < 4; b++) { // tracking-error bands
      const by = ((rnd(f * 3 + b) * H) | 0), bh = 30 + rnd(f + b * 7) * 90, sx = (rnd(f * 5 + b) - 0.5) * 120;
      g.drawImage(fr, 0, by / 2, W / 2, bh / 2, sx, by, W, bh);
    }
  }
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
  g.fillStyle = C.text; // drawn arrows: the fonts have no U+25C0 glyph
  for (const ox of [80, 122]) { g.beginPath(); g.moveTo(ox + 40, 272); g.lineTo(ox, 300); g.lineTo(ox + 40, 328); g.fill(); }
  txt(g, 'REWIND', 186, 302, MONOB(64), C.text, 'left');
});
// PROBLEM
shot(0.5, 'punch', [['boom', 0]], (g, t) => {
  camShake(g, t, 10); bg(g, C.negative, 0.12);
  slam(g, 'STILL', W / 2, 800, BLACK, 300, C.text, t);
  slam(g, 'PAYING', W / 2, 1060, BLACK, 300, C.text, t - 0.12);
});
shot(0.5, 'punch', [['boom', 0]], (g, t) => {
  camShake(g, t, 14); bg(g, C.negative, 0.22);
  slam(g, 'EVERY', W / 2, 800, BLACK, 300, C.text, t);
  slam(g, 'MONTH?', W / 2, 1060, BLACK, 300, C.negative, t - 0.12, 940, 40);
});
// NOTIFICATIONS — iOS-style: each drops in on a bouncy spring, older ones spring down the stack
const TOASTS = [['Subscription renewed', 'charged again'], ['Card charged', 'same tools, new bill'], ['Renewal due', 'pay again or lose access'], ['Payment taken', 'see you next month']];
const T_AT = [0.12, 0.42, 0.72, 1.02], SLOT = 205;
shot(1.5, 'slideU', [...T_AT.map(a => ['notif', a]), ['boom', 1.15]], (g, t, d) => {
  bg(g, C.negative, 0.1 + 0.2 * ease(t, 0, d), H * 0.5);
  for (let j = 0; j < TOASTS.length; j++) {
    const k = t - T_AT[j]; if (k <= 0) continue;
    const e = spr(k, BOUNCE);
    let push = 0; for (let q = j + 1; q < TOASTS.length; q++) push += spr(t - T_AT[q], SETTLE);
    const y = 600 + push * SLOT - (1 - e) * 260, sc = 0.9 + 0.1 * e - 0.035 * push;
    g.save(); g.globalAlpha = clamp01(k / 0.08) * (1 - 0.14 * push);
    g.translate(W / 2, y); g.scale(sc, sc);
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 40;
    rr(g, -470, -88, 940, 176, 34); g.fillStyle = '#1f1f25'; g.fill(); g.shadowBlur = 0;
    g.lineWidth = 2; g.strokeStyle = C.border; g.stroke();
    rr(g, -430, -48, 96, 96, 22); g.fillStyle = mixHex(C.negative, C.raised, 0.7); g.fill();
    txt(g, '$', -382, 2, BLACK(64), C.negative);
    txt(g, TOASTS[j][0], -306, -22, BOLD(50), C.text, 'left');
    txt(g, TOASTS[j][1], -306, 34, SEMI(38), C.muted, 'left');
    txt(g, 'now', 430, -26, SEMI(32), C.muted, 'right');
    g.restore();
  }
  slam(g, 'AGAIN.', W / 2, 360, BLACK, 200, C.negative, t - 1.15, 940, 30);
});
// DROP — brand slam (the only white flash in the video)
MARK.drop = SHOTS.length;
shot(0.5, 'flash', [['boom', 0], ['riser', -2.2]], (g, t) => {
  camShake(g, t, 14); bg(g, C.accent, 0.35);
  popAt(g, W / 2, 780, t, BOUNCE, () => ico(g, -150, -150, 300, 80));
  slam(g, 'TRADE BAY', W / 2, 1060, BLACK, 170, C.text, t - 0.06);
});
// SHOWCASE — 7 platforms, 1.5s each, slide + motion blur between them
const ORDER = ['atas', 'bm', 'sc', 'mw', 'dc', 'ax', 'jig'];
ORDER.forEach((id, i) => shot(1.5, 'slide', [['whoosh', 0], ['pop', 0.22]], (g, t, d) => {
  const a = P[id];
  bg(g, a.hue, 0.14, 1000);
  const z = lerp(1.0, 1.03, ease(t, 0, d));
  g.save(); g.translate(W / 2, 1010); g.scale(z, z); g.translate(-W / 2, -1010);
  appWindow(g, id, 40, 450, 1000);
  g.restore();
  // header: real app icon springs in with a twist, name glides in, price pops
  const ls = spr(t - 0.14, BOUNCE);
  if (ls > 0.01) { g.save(); g.translate(150, 290); g.scale(ls, ls); g.rotate((1 - ls) * -0.35); logo(g, id, -80, -80, 160); g.restore(); }
  const nk = spr(t - 0.22, SNAP), name = a.name.toUpperCase(), sz = fit(g, name, BLACK, 112, 770);
  if (t > 0.22) { g.save(); g.globalAlpha = clamp01((t - 0.22) / 0.12); g.translate((1 - nk) * 110, 0); txt(g, name, 265, 252, BLACK(sz), C.text, 'left'); g.restore(); }
  popAt(g, 265 + 215, 352, t - 0.34, BOUNCE, () => pill(g, 0, 0, 430, 78, C.pillPosBg, rgba(C.posInk, 0.85), `${PRICE} one time`, BOLD(40), C.posInk));
  rise(g, `${i + 1} / 7`, W / 2, 1655, MONOB(36), rgba(C.text, 0.55), t - 0.3);
}));
// ALL SEVEN — every platform stacked, live
shot(1.0, 'slide', [['whoosh', 0], ...ORDER.map((_, i) => ['tick', 0.12 + i * 0.07])], (g, t) => {
  bg(g, C.accent, 0.12);
  slam(g, 'ALL 7', W / 2, 250, BLACK, 180, C.text, t - 0.05);
  const RH = 150, sh = Math.round(EL * DPR * RH / 1000);
  ORDER.forEach((id, i) => {
    const k = spr(t - (0.12 + i * 0.07), SNAP); if (k <= 0.001) return;
    const y = 385 + i * 166, x = (1 - k) * (i % 2 ? W : -W);
    g.save(); g.translate(x, 0);
    rr(g, 50, y, 980, RH, 20); g.save(); g.clip();
    g.drawImage(chart(id), 0, (EL * DPR - sh) / 2, EL * DPR, sh, 50, y, 980, RH);
    const fade = g.createLinearGradient(50, 0, 560, 0);
    fade.addColorStop(0, 'rgba(10,10,13,0.92)'); fade.addColorStop(1, 'rgba(10,10,13,0)');
    g.fillStyle = fade; g.fillRect(50, y, 510, RH);
    g.restore();
    g.lineWidth = 2.5; g.strokeStyle = rgba(P[id].hue, 0.8); rr(g, 50, y, 980, RH, 20); g.stroke();
    logo(g, id, 76, y + 30, 90);
    txt(g, P[id].name, 186, y + RH / 2 + 2, BOLD(54), C.text, 'left');
    g.restore();
  });
  rise(g, 'ONE LAUNCHER', W / 2, 1610, BLACK(92), C.accentInk, t - 0.6);
});
// LAUNCHER — selection runs down the real list
shot(1.0, 'slide', [['whoosh', 0], ...[0, 1, 2, 3, 4, 5, 6].map(i => ['tick', 0.3 + i * 0.09])], (g, t) => {
  bg(g, C.accent, 0.14);
  const sel = Math.min(6, Math.floor(Math.max(0, t - 0.3) / 0.09));
  const z = lerp(1.42, 1.5, ease(t, 0, 1));
  g.save(); g.translate(W / 2, 1100); g.scale(z, z); g.translate(-420, -1000);
  E.drawLauncher(g, 15, 680, 1050, 640, sel, 0, 2);
  g.restore();
  shade(g, 0.95, 0, 0.6);
  slam(g, 'ONE PLACE', W / 2, 300, BLACK, 180, C.text, t - 0.08);
  rise(g, 'install \u00b7 update \u00b7 launch', W / 2, 440, SEMI(60), C.soft, t - 0.2);
});
// INSTALL — 0 -> 100%, verified
shot(1.0, 'punch', [['pop', 0.66]], (g, t) => {
  const p = ease(t, 0.05, 0.65, outCubic), done = t >= 0.65;
  camShake(g, t - 0.65, 8);
  bg(g, done ? C.positive : C.accent, done ? 0.3 : 0.16);
  txt(g, done ? 'All 7 installed' : 'Installing all 7\u2026', W / 2, 640, BOLD(64), C.soft);
  const pz = done ? 1 + 0.12 * (1 - spr(t - 0.65, BOUNCE)) : 1;
  g.save(); g.translate(W / 2, 900); g.scale(pz, pz); txt(g, `${Math.round(p * 100)}%`, 0, 0, BLACK(300), done ? C.posInk : C.text); g.restore();
  rr(g, 90, 1110, 900, 36, 18); g.fillStyle = C.raised; g.fill();
  rr(g, 90, 1110, Math.max(36, 900 * p), 36, 18); g.fillStyle = done ? C.positive : C.accent; g.fill();
  if (done) check(g, W / 2, 1340, 90, t - 0.65);
  else rise(g, 'signed \u00b7 verified', W / 2, 1240, MONOB(46), C.muted, t);
});
// RUN — cursor glides in, button presses, white bloom
shot(0.5, 'cut', [['pop', 0.2], ['boom', 0.3]], (g, t) => {
  bg(g, C.positive, 0.2);
  const press = t > 0.2 ? 1 - 0.1 * Math.sin(Math.PI * clamp01((t - 0.2) / 0.12)) : 1;
  popAt(g, W / 2, 960, t, BOUNCE, () => {
    g.scale(press, press);
    pill(g, 0, 0, 600, 210, C.pillPosBg, C.posInk, '', null, null);
    txt(g, 'RUN', -40, 2, BLACK(110), C.posInk); // drawn triangle: no U+25B6 glyph in the font
    g.fillStyle = C.posInk; g.beginPath(); g.moveTo(110, -36); g.lineTo(166, 0); g.lineTo(110, 36); g.fill();
  });
  const m = spr(t, SOFT), cx = lerp(980, W / 2 + 120, m), cy = lerp(1500, 1010, m);
  g.save(); g.translate(cx, cy); g.scale(2.2 * press, 2.2 * press); // cursor
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 34); g.lineTo(9, 26); g.lineTo(15, 40); g.lineTo(21, 37); g.lineTo(15, 24); g.lineTo(26, 24); g.closePath();
  g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke(); g.restore();
  const fl = ease(t, 0.3, 0.5, outExpo);
  if (fl > 0) { g.beginPath(); g.arc(W / 2, 960, fl * 1400, 0, 7); g.fillStyle = rgba('#ffffff', 0.95); g.fill(); }
});
// BENEFITS — three rows tick in one after another
const BENEFITS = ['No subscription', 'Lifetime licence', 'Always up to date'];
shot(1.5, 'fromWhite', BENEFITS.map((_, i) => ['pop', 0.15 + i * 0.35]), (g, t, d) => {
  coverChart(g, 'atas', lerp(1.05, 1.12, ease(t, 0, d)), 0.5, 3);
  shade(g, 0.85, 0.6, 0.85);
  rise(g, 'WHAT YOU GET', W / 2, 600, BOLD(56), C.muted, t - 0.02);
  BENEFITS.forEach((s, i) => {
    const k = t - (0.15 + i * 0.35); if (k <= 0) return;
    const y = 790 + i * 200, p = spr(k, SNAP);
    check(g, 150, y, 62, k);
    const sz = fit(g, s, BLACK, 96, 760);
    g.save(); g.globalAlpha = clamp01(k / 0.12); g.translate((1 - p) * 90, 0);
    txt(g, s, 245, y + 4, BLACK(sz), C.text, 'left'); g.restore();
  });
});
// PRICE
shot(1.5, 'slide', [['whoosh', 0], ...[0, 1, 2, 3].map(i => ['tick', 0.1 + i * 0.06]), ['boom', 0.35], ['pop', 0.7]], (g, t) => {
  camShake(g, t - 0.35, 14);
  bg(g, C.positive, 0.24);
  const z = lerp(1, 1.05, ease(t, 0.4, 1.5));
  g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2);
  rise(g, 'EVERY PLATFORM', W / 2, 700, BOLD(70), C.soft, t - 0.05);
  const lock = t >= 0.35;
  const s = lock ? PRICE : '$' + (100 + Math.floor(rnd(Math.floor(t * 40)) * 899)) + '.' + String(Math.floor(rnd(t * 77) * 99)).padStart(2, '0');
  const pop = lock ? 1.25 - 0.25 * spr(t - 0.35, BOUNCE) : 1;
  g.save(); g.translate(W / 2, 920); g.scale(pop, pop);
  const sz = fit(g, PRICE, BLACK, 290, 980);
  g.shadowColor = lock ? rgba(C.posInk, 0.5) : 'transparent'; g.shadowBlur = 50;
  txt(g, s, 0, 0, BLACK(sz), lock ? C.text : C.soft); g.restore();
  popAt(g, W / 2, 1180, t - 0.7, BOUNCE, () => pill(g, 0, 0, 720, 130, C.pillPosBg, rgba(C.posInk, 0.8), 'ONE TIME. NO RENEWAL.', BOLD(56), C.posInk));
});
// TAGLINE
shot(0.5, 'punch', [['boom', 0]], (g, t, d) => {
  camShake(g, t, 12); bg(g, C.accent, 0.16);
  { const z = lerp(1, 1.06, ease(t, 0, d, outCubic)); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2); }
  slam(g, 'PAY', W / 2, 820, BLACK, 300, C.text, t);
  slam(g, 'ONCE.', W / 2, 1080, BLACK, 300, C.text, t - 0.12);
});
shot(1.0, 'punch', [['boom', 0]], (g, t, d) => {
  camShake(g, t, 12); bg(g, C.positive, 0.24);
  { const z = lerp(1, 1.08, ease(t, 0, d, outCubic)); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2); }
  slam(g, 'TRADE', W / 2, 820, BLACK, 300, C.text, t);
  slam(g, 'FOREVER.', W / 2, 1080, BLACK, 300, C.posInk, t - 0.12, 960, 40);
});
// END CARD
MARK.end = SHOTS.length;
shot(2.0, 'fade', [['boom', 0], ['chime', 0.05]], (g, t) => {
  bg(g, C.accent, 0.28, 760);
  const z = lerp(1, 1.04, ease(t, 0, 2));
  g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2);
  popAt(g, W / 2, 640, t, BOUNCE, () => ico(g, -130, -130, 260, 70));
  slam(g, 'Trade Bay', W / 2, 910, BLACK, 150, C.text, t - 0.1);
  rise(g, '7 pro trading platforms. Paid once.', W / 2, 1030, SEMI(52), C.soft, t - 0.25);
  const breathe = 1 + 0.03 * Math.sin(Math.max(0, t - 0.9) * Math.PI * 4);
  popAt(g, W / 2, 1230, t - 0.45, BOUNCE, () => { g.scale(breathe, breathe); pill(g, 0, 0, 600, 140, '#ffffff', null, 'LINK IN BIO', BLACK(66), C.ground); });
  rise(g, 'Authorized reseller \u00b7 Windows 10/11', W / 2, 1390, MONOB(34), C.muted, t - 0.7);
});

const starts = []; let DUR = 0; for (const s of SHOTS) { starts.push(DUR); DUR += s.dur; }
const FRAMES = Math.round(DUR * FPS);

/* ---------- compositor ---------- */
const TR_LEN = { slide: 0.6, slideU: 0.6, fade: 0.35, fromWhite: 0.35, punch: 0.3, flash: 0.3, cut: 0 };
const BLUR_N = 8, SHUTTER = 1 / 90; // motion blur: 8 sub-samples across a 1/90s shutter
const main = createCanvas(W, H), m = main.getContext('2d');
const S = createCanvas(W, H), sg = S.getContext('2d');      // incoming shot
const S2 = createCanvas(W, H), sg2 = S2.getContext('2d');   // outgoing shot, still live during transitions
const OUT = createCanvas(W, H), og = OUT.getContext('2d');  // frozen last frame (for hard-cut shots)
let cur = -1;

function drawShot(g, i, lt, f) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none';
  g.fillStyle = C.ground; g.fillRect(0, 0, W, H);
  SHOTS[i].draw(g, lt, SHOTS[i].dur, f);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = 'none';
}
function placed(img, dx, dy, z, a) { // draw a full frame offset by (dx,dy), scaled z about centre
  m.save(); m.globalAlpha = a; m.translate(W / 2 + dx, H / 2 + dy); m.scale(z, z); m.drawImage(img, -W / 2, -H / 2); m.restore();
}
function renderFrame(f) {
  FRAME = f;
  const T = f / FPS;
  let i = 0; while (i < SHOTS.length - 1 && T >= starts[i + 1] - 1e-9) i++;
  if (i !== cur) { og.drawImage(main, 0, 0); cur = i; }
  const sh = SHOTS[i], lt = T - starts[i], tr = i === 0 ? 'punch' : sh.tr, inTr = lt < TR_LEN[tr];
  drawShot(sg, i, lt, f);
  const live = inTr && i > 0 && (tr === 'slide' || tr === 'slideU' || tr === 'fade');
  if (live) drawShot(sg2, i - 1, SHOTS[i - 1].dur + lt, f);

  m.setTransform(1, 0, 0, 1, 0, 0); m.globalAlpha = 1;
  m.fillStyle = '#060608'; m.fillRect(0, 0, W, H);
  if (live && tr !== 'fade') {
    // camera pans to the next shot on a near-critical spring; frames dip slightly in depth mid-move.
    // Average BLUR_N samples across the shutter (running mean) = real motion blur, strongest at peak speed.
    const vert = tr === 'slideU', L = vert ? H : W;
    for (let k = 0; k < BLUR_N; k++) {
      const p = spr(lt - SHUTTER * k / (BLUR_N - 1), SOFT), z = 1 - 0.06 * Math.sin(Math.PI * clamp01(p));
      const a = 1 / (k + 1), o = -p * L * z, n = (1 - p) * L * z;
      placed(S2, vert ? 0 : o, vert ? o : 0, z, a);
      placed(S, vert ? 0 : n, vert ? n : 0, z, a);
    }
  } else if (live) { // fade
    m.drawImage(S2, 0, 0); m.globalAlpha = inOutSine(lt / TR_LEN.fade); m.drawImage(S, 0, 0); m.globalAlpha = 1;
  } else if ((tr === 'punch' || tr === 'flash') && inTr) {
    placed(S, 0, 0, 1 + 0.1 * (1 - spr(lt, SNAP)), 1);
  } else m.drawImage(S, 0, 0);
  if (tr === 'flash' && lt < 0.2) { m.globalAlpha = 0.4 * (1 - ease(lt, 0, 0.2, outCubic)); m.fillStyle = '#fff'; m.fillRect(0, 0, W, H); m.globalAlpha = 1; }
  if (tr === 'fromWhite' && inTr) { m.globalAlpha = 1 - ease(lt, 0, TR_LEN.fromWhite, outCubic); m.fillStyle = '#fff'; m.fillRect(0, 0, W, H); m.globalAlpha = 1; }

  if (i === 0) { const c = createCanvas(W / 2, H / 2); c.getContext('2d').drawImage(main, 0, 0, W / 2, H / 2); REWIND.push(c); }
}

/* ---------- audio timeline (single source of truth for music_short.py + assemble_short.js) ---------- */
const events = [];
SHOTS.forEach((s, i) => s.sfx.forEach(([name, off]) => events.push([name, +Math.max(0, starts[i] + off).toFixed(3)])));
writeFileSync('out/timeline_short.json', JSON.stringify({ dur: DUR, drop: starts[MARK.drop], end: starts[MARK.end], starts, events }, null, 1));

(async () => {
  setIco(await loadIco());
  for (const a of APPS) LOGOS[a.letters] = await loadImage(`icons/${a.id}.png`);
  console.log(`${SHOTS.length} shots, ${DUR}s, ${FRAMES} frames`);
  if (SMOKE) {
    const want = new Set(); starts.forEach((s, i) => { want.add(Math.round((s + SHOTS[i].dur * 0.65) * FPS)); want.add(Math.round((s + 0.15) * FPS)); });
    for (let f = 0; f < FRAMES; f++) {
      renderFrame(f);
      if (want.has(f)) writeFileSync(`qc/rs_${String(f).padStart(4, '0')}.png`, main.toBuffer('image/png'));
    }
    console.log('SMOKE done', want.size, 'stills'); return;
  }
  const ff = spawn(FF, ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', 'out/tradebay_short_nosound.mp4'],
  { stdio: ['pipe', 'inherit', 'pipe'] });
  let tail = ''; ff.stderr.on('data', d => { tail = (tail + d).slice(-3000); });
  const done = new Promise(res => ff.on('exit', res));
  const t0 = Date.now();
  for (let f = 0; f < FRAMES; f++) {
    renderFrame(f);
    const px = m.getImageData(0, 0, W, H).data;
    if (!ff.stdin.write(Buffer.from(px.buffer, px.byteOffset, px.byteLength))) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`frame ${f}/${FRAMES} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  const code = await done;
  if (code === 0) console.log('VIDEO RENDER OK'); else { console.error('ffmpeg exit', code, tail); process.exit(1); }
})();
