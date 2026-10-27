// Trade Bay — "Inside the control room": a 16s video with real 3D (software perspective renderer on the 2D canvas).
// Camera sits in the centre of a ring of 7 live-chart panels (textured quads in 3D, slab thickness, floor reflection),
// extruded 3D "$149.99" and logo (stacked layers in depth), depth-cue dust. Flat Discord ending kept inside TikTok's safe zone.
// Usage: node render_3d.js [SMOKE=1 TIMES=..]   then  GAIN=2.6 node assemble_short.js 3d
const E = require('./engines.js');
const { W, H, APPS, clamp01, lerp, rr, loadIco, setIco, ico, LOGOS, tile, rnd, createCanvas, GlobalFonts, FF } = E;
const { loadImage } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');

const FPS = 60, DUR = 16, FRAMES = DUR * FPS, SMOKE = !!process.env.SMOKE, PRICE = '$149.99', CX = 495;
const MSGS = ['Not sure which to pick? Ask.', 'Setup help, live.', 'Updates first.'];
mkdirSync('out', { recursive: true }); mkdirSync('qc', { recursive: true });
GlobalFonts.registerFromPath('fonts/HankenGrotesk-400.ttf', 'Hanken');
GlobalFonts.registerFromPath('fonts/HankenGrotesk-500.ttf', 'Hanken');
const K = { bg: '#0b0b0e', floor: '#101015', surf: '#17171c', raise: '#1f1f25', text: '#f2f2f0', muted: '#9a9ca4', green: '#5fc39c', discord: '#5865F2' };
const F5 = s => `500 ${s}px Hanken`, F4 = s => `400 ${s}px Hanken`;

function spr(t, [response, damping]) {
  if (t <= 0) return 0;
  const w0 = 2 * Math.PI / response;
  if (damping >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + (damping * w0 / wd) * Math.sin(wd * t));
}
const CALM = [0.5, 1], POP = [0.42, 0.6], SOFT = [0.6, 0.95], SLAM = [0.3, 0.6], CAMS = [0.5, 0.9];
const smooth = x => x * x * (3 - 2 * x), outCubic = x => 1 - Math.pow(1 - x, 3), inCubic = x => x * x * x;
const ease = (t, a, b, f = smooth) => f(clamp01((t - a) / (b - a)));
const R = (g, x, y, w, h, r) => { if (w < 1 || h < 1) { g.beginPath(); return; } rr(g, x, y, w, h, Math.max(0, r)); };
function T(g, s, x, y, font, fill, align = 'left', ls = 0) { g.font = font; g.fillStyle = fill; g.textAlign = align; g.textBaseline = 'middle'; g.letterSpacing = `${ls}px`; g.fillText(s, x, y); g.letterSpacing = '0px'; }
function wrap(g, s, font, maxW) { g.font = font; g.letterSpacing = '0px'; const out = []; let line = ''; for (const w of s.split(' ')) { const t2 = line ? line + ' ' + w : w; if (g.measureText(t2).width > maxW && line) { out.push(line); line = w; } else line = t2; } return [...out, line]; }
function fitSize(g, s, size, maxW) { g.font = F5(size); g.letterSpacing = '0px'; const w = g.measureText(s).width; return w > maxW ? Math.floor(size * maxW / w) : size; }
function fadeIn(g, k, dy = 28) { g.globalAlpha *= clamp01(k / 0.2); g.translate(0, dy * (1 - spr(k, CALM))); }
function captions(g, t, CAPS) {
  for (const [a, b, s] of CAPS) {
    const k = t - a, o = t - (b - 0.12); if (k <= 0 || o > 0.3) continue;
    g.save(); fadeIn(g, k, 30); if (o > 0) { const e = ease(o, 0, 0.28); g.globalAlpha *= 1 - e; g.translate(0, -36 * e); }
    const sz = fitSize(g, s, 74, 850); g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 18; T(g, s, CX, 300, F5(sz), K.text, 'center', -sz * 0.02); g.restore();
  }
}
const ORD = ['ax', 'atas', 'bm', 'mw', 'dc', 'sc', 'jig'], A = Object.fromEntries(APPS.map(a => [a.id, a]));
function appIcon(g, a, x, y, s) { tile(g, x, y, s, a.hue, a.letters, s * 0.3); }
function view(g, img, cx, cy, zz, dx, dy, dw, dh) { const sh = img.height / zz, sw = Math.min(img.width, sh * dw / dh), sh2 = sw * dh / dw; const sx = Math.max(0, Math.min(img.width - sw, cx - sw / 2)), sy = Math.max(0, Math.min(img.height - sh2, cy - sh2 / 2)); g.drawImage(img, sx, sy, sw, sh2, dx, dy, dw, dh); }

/* ---------- live charts ---------- */
const EL = 680, DPR = 2, ENG = {};
for (const a of APPS) {
  const cv = createCanvas(EL * DPR, EL * DPR);
  const Maker = { footprint: E.Footprint, heatmap: E.Heatmap, candles: E.Candles, waves: E.Waves }[a.scene];
  const sc = new Maker({ seed: a.seed, sym: a.sym, hue: a.hue, dom: a.dom, variant: a.variant }, EL, EL);
  sc.ctx = cv.getContext('2d'); sc.w = EL; sc.h = EL;
  if (a.id === 'ax') { sc.per = 55; for (let k = 0; k < 275; k++) sc.step(); }
  ENG[a.id] = { cv, sc, last: -1, tex: createCanvas(600, 840), texLast: -1 };
}
let FRAME = 0;
function chart(id) { const e = ENG[id]; if (e.last !== FRAME) { e.sc.step(); e.sc.ctx.setTransform(DPR, 0, 0, DPR, 0, 0); e.sc.draw(); e.last = FRAME; } return e.cv; }
function panelTex(id) { // portrait chart card with rounded corners, hue border and the real app icon
  const e = ENG[id]; if (e.texLast === FRAME) return e.tex; e.texLast = FRAME;
  const g = e.tex.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 600, 840);
  g.save(); R(g, 0, 0, 600, 840, 40); g.clip(); g.fillStyle = K.surf; g.fillRect(0, 0, 600, 840); view(g, chart(id), 680, 680, 1, 0, 0, 600, 840); g.restore();
  g.lineWidth = 8; g.strokeStyle = A[id].hue; R(g, 4, 4, 592, 832, 38); g.stroke();
  appIcon(g, A[id], 28, 28, 92); return e.tex;
}

/* ---------- mini 3D: camera, textured quads, extruded layers ---------- */
let CAM = { C: [0, 0, 0], yaw: 0, pitch: 0, f: 1150 };
function proj(p) {
  const v0 = p[0] - CAM.C[0], v1 = p[1] - CAM.C[1], v2 = p[2] - CAM.C[2], cy = Math.cos(CAM.yaw), sy = Math.sin(CAM.yaw);
  const x1 = v0 * cy - v2 * sy, z1 = v0 * sy + v2 * cy, cp = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch);
  const y2 = v1 * cp - z1 * sp, z2 = v1 * sp + z1 * cp;
  return [540 + CAM.f * x1 / z2, 960 - CAM.f * y2 / z2, z2];
}
function triTex(g, img, p0, p1, p2, t0, t1, t2) {
  const du1 = t1[0] - t0[0], dv1 = t1[1] - t0[1], du2 = t2[0] - t0[0], dv2 = t2[1] - t0[1], det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-9) return;
  const dx1 = p1[0] - p0[0], dx2 = p2[0] - p0[0], dy1 = p1[1] - p0[1], dy2 = p2[1] - p0[1];
  const a = (dx1 * dv2 - dx2 * dv1) / det, c = (-dx1 * du2 + dx2 * du1) / det, b = (dy1 * dv2 - dy2 * dv1) / det, d = (-dy1 * du2 + dy2 * du1) / det;
  const e = p0[0] - a * t0[0] - c * t0[1], f = p0[1] - b * t0[0] - d * t0[1];
  const cx = (p0[0] + p1[0] + p2[0]) / 3, cy = (p0[1] + p1[1] + p2[1]) / 3, ex = q => q + Math.sign(q - 0) * 0;
  const out = p => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.7, p[1] + dy / l * 0.7]; };
  const o0 = out(p0), o1 = out(p1), o2 = out(p2);
  g.save(); g.beginPath(); g.moveTo(o0[0], o0[1]); g.lineTo(o1[0], o1[1]); g.lineTo(o2[0], o2[1]); g.closePath(); g.clip();
  g.transform(a, b, c, d, e, f); g.drawImage(img, 0, 0); g.restore();
}
function quad3(g, img, P, sub) { // P = [TL,TR,BR,BL] world points
  const iw = img.width, ih = img.height, V = [];
  for (let j = 0; j <= sub; j++) for (let i = 0; i <= sub; i++) {
    const u = i / sub, v = j / sub, top = [lerp(P[0][0], P[1][0], u), lerp(P[0][1], P[1][1], u), lerp(P[0][2], P[1][2], u)], bot = [lerp(P[3][0], P[2][0], u), lerp(P[3][1], P[2][1], u), lerp(P[3][2], P[2][2], u)];
    V.push(proj([lerp(top[0], bot[0], v), lerp(top[1], bot[1], v), lerp(top[2], bot[2], v)]));
  }
  if (V.some(p => p[2] < 40)) return false;
  const ix = (i, j) => j * (sub + 1) + i, tx = (i, j) => [i / sub * iw, j / sub * ih];
  for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) {
    triTex(g, img, V[ix(i, j)], V[ix(i + 1, j)], V[ix(i + 1, j + 1)], tx(i, j), tx(i + 1, j), tx(i + 1, j + 1));
    triTex(g, img, V[ix(i, j)], V[ix(i + 1, j + 1)], V[ix(i, j + 1)], tx(i, j), tx(i + 1, j + 1), tx(i, j + 1));
  }
  return true;
}
function poly3(g, P, fill, alpha = 1) { const V = P.map(proj); if (V.some(p => p[2] < 40)) return; g.save(); g.globalAlpha = alpha; g.beginPath(); V.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fillStyle = fill; g.fill(); g.restore(); }
const frame3 = (c, rx, ry, rz, w, h, dep = 0) => { // corners of a w x h card at centre c with right vector r and up (0,1,0), pushed `dep` along d
  const hw = w / 2, hh = h / 2, dx = -rz, dz = rx; // d = depth direction, perpendicular to r in the XZ plane (away from the viewer)
  const o = [dx * dep, 0, dz * dep];
  return [[c[0] - rx * hw + o[0], c[1] + hh, c[2] - rz * hw + o[2]], [c[0] + rx * hw + o[0], c[1] + hh, c[2] + rz * hw + o[2]], [c[0] + rx * hw + o[0], c[1] - hh, c[2] + rz * hw + o[2]], [c[0] - rx * hw + o[0], c[1] - hh, c[2] - rz * hw + o[2]]];
};

/* ---------- scene objects ---------- */
const PR = 560, PW = 400, PH = 560, FLOOR = -300, TH = i => i * 2 * Math.PI / 7, Ti = i => 3.0 + 1.1 * i;
const mkText = (s, size, fill, w, h) => { const c = createCanvas(w, h), g = c.getContext('2d'); g.fillStyle = fill; g.font = F5(size); g.textAlign = 'center'; g.textBaseline = 'middle'; g.letterSpacing = `${-size * 0.045}px`; g.fillText(s, w / 2, h / 2); return c; };
const PBM = [K.text, '#4fae8c', '#2f7a63', '#1f4f41'].map(c => mkText(PRICE, 200, c, 900, 300));
let ICON = null; const ICM = []; // brand icon, plus darkened copies for the extruded sides
function mkIconSides() { for (const sh of [0, 0.55, 0.78]) { const c = createCanvas(256, 256), g = c.getContext('2d'); g.drawImage(ICON, 0, 0, 256, 256); if (sh) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(11,40,32,${sh})`; g.fillRect(0, 0, 256, 256); } ICM.push(c); } }
function extrude(g, bms, c, w, h, depth, layers, ang, sc) { // layers from back to front; bms[0] = front face, others darker sides
  if (sc < 0.02) return; const rx = Math.cos(ang), rz = Math.sin(ang);
  for (let k = layers; k >= 0; k--) {
    const dep = depth * k / layers, bm = k === 0 ? bms[0] : bms[1 + Math.min(bms.length - 2, Math.floor((k - 1) / layers * (bms.length - 1)))];
    quad3(g, bm, frame3(c, rx, 0, rz, w * sc, h * sc, dep * sc), 2);
  }
}
const DUST = [...Array(90)].map((_, i) => ({ x: (rnd(i * 1.3) - 0.5) * 3000, y: (rnd(i * 2.1 + 4) - 0.5) * 1400, z: (rnd(i * 3.7 + 9) - 0.5) * 3000, s: 2 + rnd(i * 5.1) * 3 }));
const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
function yawAt(t) { let y = 2 * Math.PI * spr(t - 2.0, [0.9, 0.9]); for (let i = 1; i < 7; i++) y += 2 * Math.PI / 7 * spr(t - (Ti(i) - 0.45), CAMS); y += 2 * Math.PI / 7 * spr(t - 10.35, [0.6, 0.9]); return y; }
function pushAt(t) { let p = 0; for (let i = 0; i < 7; i++) p += ease(t, Ti(i) - 0.3, Ti(i) + 0.1) * (1 - ease(t, Ti(i) + 0.62, Ti(i) + 1.0)); return clamp01(p); }

function scene3d(g, t) {
  const yaw = yawAt(t), push = pushAt(t) * (t > 2.9 && t < 10.5 ? 1 : 0), intro = ease(t, 0, 1.9);
  CAM = { C: [Math.sin(yaw) * 300 * push, 0, Math.cos(yaw) * 300 * push + 150 * intro * (1 - ease(t, 1.9, 2.6))], yaw, pitch: 0.035 * Math.sin(t * 0.8) + 0.02 * push, f: 1150 };
  const roll = 0.03 * Math.sin(t * 0.9) + 0.035 * (yawAt(t + 0.02) - yawAt(t - 0.02)) / 0.04 * 0.12;
  g.save(); g.translate(540, 960); g.rotate(roll); g.translate(-540, -960);
  // floor: flat plane below the horizon
  const hz = proj([0, FLOOR, 1e6]); g.fillStyle = K.floor; g.fillRect(-900, hz[1], W + 1800, H + 1800);
  // dust gives parallax
  for (const d of DUST) { const q = proj([d.x, d.y + t * 14, d.z]); if (q[2] < 80 || q[2] > 3500) continue; g.globalAlpha = 0.5 * (1 - q[2] / 3500); g.fillStyle = '#c9ccd4'; const r = d.s * 700 / q[2]; g.fillRect(q[0] - r, q[1] - r, r * 2, r * 2); }
  g.globalAlpha = 1;
  // ring of panels (far to near), reflections first
  const panels = ORD.map((id, i) => {
    const k = t - (2.0 + 0.07 * i), fly = spr(k, [0.7, 0.8]), conv = ease(t, 10.4, 10.95, inCubic), th = TH(i);
    let c = [Math.sin(th) * PR * 1.6, 0, Math.cos(th) * PR * 1.6];
    c = [lerp(0, c[0], fly), lerp(40, c[1], fly), lerp(620, c[2], fly)];
    c = [lerp(c[0], 0, conv), lerp(c[1], 60, conv), lerp(c[2], 700, conv)];
    const s = Math.max(0, fly) * (1 - conv * 0.85), diff = Math.abs(angDiff(yaw, th)), al = t < 3.0 ? 0.92 : 0.38 + 0.62 * clamp01(1 - diff / 0.55);
    return { id, c, s, th, al: t > 10.4 ? 1 : al, d: proj(c)[2] };
  }).filter(p => p.s > 0.03 && t < 11.2).sort((a, b) => b.d - a.d);
  for (const p of panels) { // reflection
    const rx = Math.cos(p.th), rz = -Math.sin(p.th), fr = frame3(p.c, rx, 0, rz, PW * p.s, PH * p.s);
    const mir = fr.map(q => [q[0], 2 * FLOOR - q[1], q[2]]); const m2 = [mir[3], mir[2], mir[1], mir[0]];
    if (quad3(g, panelTex(p.id), [mir[3], mir[2], mir[1], mir[0]].map((q, i) => i < 2 ? [q[0], q[1], q[2]] : q).map((q, i) => q), 3)) poly3(g, mir, K.floor, 0.84 + 0.1 * (1 - p.al));
  }
  for (const p of panels) {
    const rx = Math.cos(p.th), rz = -Math.sin(p.th), out = [Math.sin(p.th), 0, Math.cos(p.th)], fr = frame3(p.c, rx, 0, rz, PW * p.s, PH * p.s);
    const back = fr.map(q => [q[0] + out[0] * 22 * p.s, q[1], q[2] + out[2] * 22 * p.s]);
    for (let e = 0; e < 4; e++) poly3(g, [fr[e], fr[(e + 1) % 4], back[(e + 1) % 4], back[e]], '#23232b');
    quad3(g, panelTex(p.id), fr, 6);
    if (p.al < 0.99) poly3(g, fr, K.bg, 1 - p.al);
  }
  // extruded price (intro) and extruded logo + price (finale)
  const pa = 0.5 * Math.sin(t * 1.4) * (1 - ease(t, 1.2, 1.8)), pscale = (1 - ease(t, 1.7, 2.1, inCubic)) * (0.6 + 0.4 * spr(t - 0.05, SLAM));
  if (t < 2.2) extrude(g, PBM, [0, 190, 900], 560, 187, 80, 20, pa, pscale);
  if (t >= 10.8 && t < 12.5) {
    const sc = spr(t - 10.9, POP) * (1 - ease(t, 12.0, 12.35, inCubic)), spin = 2 * Math.PI * (1 - spr(t - 10.9, [0.9, 0.7])), tilt = 0.18 * Math.sin((t - 10.9) * 1.6);
    extrude(g, ICM.length ? [ICM[0], ICM[1], ICM[2]] : [ICON], [0, 130, 700], 250, 250, 60, 16, spin + tilt, sc);
    extrude(g, PBM, [0, -120, 700], 440, 147, 50, 14, 0.2 * Math.sin((t - 10.9) * 1.3), sc);
  }
  g.restore();
}
function chat(g, t, a0) {
  let y = 460;
  MSGS.forEach((m, i) => {
    const k = t - (a0 + 0.3 + i * 0.6), lines = wrap(g, m, F4(46), 700);
    if (k > 0) { g.save(); fadeIn(g, k, 40); g.save(); g.beginPath(); g.arc(110, y + 40, 40, 0, 7); g.clip(); ico(g, 70, y, 80); g.restore();
      T(g, 'Trade Bay', 180, y + 16, F5(40), K.text); g.font = F5(40); T(g, 'Today', 200 + g.measureText('Trade Bay').width, y + 18, F4(30), K.muted);
      lines.forEach((l, j) => T(g, l, 180, y + 72 + j * 56, F4(46), K.text)); g.restore(); }
    y += 100 + lines.length * 56;
  });
  const k = t - (a0 + 2.2); if (k <= 0) return;
  const s = spr(k, POP) * (1 + 0.025 * Math.sin(Math.max(0, k - 0.6) * Math.PI * 2.4));
  g.save(); g.translate(CX, 1250); g.scale(s, s); R(g, -425, -70, 850, 140, 24); g.fillStyle = K.discord; g.fill(); T(g, 'Join the Discord. Link in bio.', 0, 2, F5(46), '#fff', 'center'); g.restore();
}

const CAPS = [[0, 2.0, '7 pro platforms.'], ...ORD.map((id, i) => [Ti(i) - 0.15, Ti(i) + 1.0, A[id].name]), [10.95, 12.2, 'Paid once.'], [12.2, 16.5, 'Questions? Ask on Discord.']];
function drawWorld(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.fillStyle = K.bg; g.fillRect(0, 0, W, H);
  if (t < 12.4) scene3d(g, t);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  if (t >= 12.2) chat(g, t, 12.2);
  captions(g, t, CAPS);
}
const N = 4, SHUT = 1 / 120, out = createCanvas(W, H), o = out.getContext('2d'), TMP = createCanvas(W, H), tg = TMP.getContext('2d');
function renderFrame(f) { FRAME = f; for (let k = 0; k < N; k++) { drawWorld(tg, Math.max(0, f / FPS - SHUT * k / (N - 1))); o.globalAlpha = 1 / (k + 1); o.drawImage(TMP, 0, 0); } o.globalAlpha = 1; }
const sfx = [['boom', 0.05], ['whoosh', 1.8], ...ORD.map((_, i) => ['tick', 2.1 + 0.07 * i]), ['whoosh', 2.1], ...ORD.flatMap((_, i) => [...(i ? [['whoosh', Ti(i) - 0.45]] : []), ['pop', Ti(i) + 0.05]]),
  ['whoosh', 10.35], ['boom', 10.95], ['chime', 11.2], ...MSGS.map((_, i) => ['notif', 12.5 + i * 0.6]), ['pop', 14.4], ['chime', 14.45]];
writeFileSync('out/timeline_3d.json', JSON.stringify({ dur: DUR, events: sfx.map(([n, a]) => [n, +a.toFixed(3)]) }, null, 1));

(async () => {
  ICON = await loadIco(); setIco(ICON); mkIconSides();
  for (const a of APPS) LOGOS[a.letters] = await loadImage(`icons/${a.id}.png`);
  if (SMOKE) {
    const ts = (process.env.TIMES || '0.4,1.0,1.7,2.3,2.7,3.2,3.9,5.0,6.3,7.6,9.0,10.0,10.7,11.4,12.0,13.0,15.0').split(',');
    for (const s of ts) { const f = Math.round(+s * FPS); renderFrame(f); o.fillStyle = 'rgba(255,0,0,0.16)'; o.fillRect(0, 0, W, 220); o.fillRect(920, 0, 160, H); o.fillRect(0, 1400, W, 520); writeFileSync(`qc/t3_${String(f).padStart(4, '0')}.png`, out.toBuffer('image/png')); }
    console.log('SMOKE done', ts.length); return;
  }
  const ff = spawn(FF, ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', 'out/tradebay_3d_nosound.mp4'], { stdio: ['pipe', 'inherit', 'pipe'] });
  let tail = ''; ff.stderr.on('data', d => { tail = (tail + d).slice(-3000); }); const done = new Promise(res => ff.on('exit', res));
  for (let f = 0; f < FRAMES; f++) { renderFrame(f); const px = o.getImageData(0, 0, W, H).data; if (!ff.stdin.write(Buffer.from(px.buffer, px.byteOffset, px.byteLength))) await new Promise(r => ff.stdin.once('drain', r)); if (f % 120 === 0) console.log(`frame ${f}/${FRAMES}`); }
  ff.stdin.end(); const code = await done; if (code === 0) console.log('VIDEO RENDER OK'); else { console.error('ffmpeg exit', code, tail); process.exit(1); }
})();
