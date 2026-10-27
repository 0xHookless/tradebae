// ATAS X Update Horizontal Banner (1920x640, 10.0s seamless loop -> MP4 + Discord GIF)
// Dark background with moving purple gradient glow blur, ATAS X icon, and the 3 suites:
// MBO Bundle · Options Chain Suite · Options X-Ray Suite
// Usage:
//   SMOKE=1 node render_atasx_banner.js   -> writes QC stills to qc/ax_banner_*.png
//   node render_atasx_banner.js           -> renders out/atasx_mbo_banner.mp4 + out/atasx_mbo_banner.gif
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const { spawn, spawnSync } = require('child_process');
const { mkdirSync, writeFileSync, statSync } = require('fs');

const W = 1920, H = 640, FPS = 30, DUR = 10.0, FRAMES = Math.round(DUR * FPS);
const W0 = (2 * Math.PI) / DUR; // exact harmonic fundamental so t=0 and t=DUR match seamlessly
const SMOKE = !!process.env.SMOKE;
const FF = process.env.FFMPEG || 'C:\\Users\\hawdi\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe';

mkdirSync('out', { recursive: true });
mkdirSync('qc', { recursive: true });

GlobalFonts.registerFromPath('fonts/HankenGrotesk-400.ttf', 'Hanken');
GlobalFonts.registerFromPath('fonts/HankenGrotesk-500.ttf', 'Hanken');
const F5 = s => `500 ${s}px Hanken`;
const F4 = s => `400 ${s}px Hanken`;

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const lerp = (a, b, t) => a + (b - a) * t;
const inOut = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const ease = (t, a, b, f = inOut) => f(clamp01((t - a) / (b - a)));

function spr(t, [response, damping]) {
  if (t <= 0) return 0;
  const w0 = 2 * Math.PI / response;
  if (damping >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + (damping * w0 / wd) * Math.sin(wd * t));
}

const BOUNCE = [0.44, 0.68];
const SNAP   = [0.36, 0.84];
const GLIDE  = [0.58, 0.92];

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const SUITES = [
  'MBO Bundle',
  'Options Chain Suite',
  'Options X-Ray Suite',
];

let AX_ICON = null;

function drawPurpleGlowBackground(g, t) {
  // Deep near-black base
  g.fillStyle = '#07060b';
  g.fillRect(0, 0, W, H);

  // Moving purple/indigo/violet radial blur orbs using exact integer harmonics of W0
  // so the background loops seamlessly at DUR = 10.0s with zero jump
  const orbs = [
    {
      x: W * 0.30 + Math.sin(t * W0 * 2) * 250 + Math.cos(t * W0) * 90,
      y: H * 0.45 + Math.cos(t * W0 * 2) * 140,
      r: 620,
      c0: 'rgba(139, 92, 246, 0.52)',   // rich electric purple
      c1: 'rgba(124, 58, 237, 0.20)',
    },
    {
      x: W * 0.70 + Math.cos(t * W0 * 2 + 1.1) * 270,
      y: H * 0.35 + Math.sin(t * W0 * 2 + 0.7) * 145,
      r: 680,
      c0: 'rgba(99, 102, 241, 0.46)',   // deep indigo-violet glow
      c1: 'rgba(79, 70, 229, 0.16)',
    },
    {
      x: W * 0.52 + Math.sin(t * W0 * 3 + 2.3) * 310,
      y: H * 0.68 + Math.cos(t * W0 * 2 + 1.8) * 125,
      r: 540,
      c0: 'rgba(192, 132, 252, 0.38)',  // soft violet-magenta highlight
      c1: 'rgba(168, 85, 247, 0.14)',
    },
  ];

  g.save();
  g.globalCompositeOperation = 'screen';
  for (const o of orbs) {
    const grad = g.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
    grad.addColorStop(0, o.c0);
    grad.addColorStop(0.48, o.c1);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // Subtle dark vignette at edges so focus stays locked on center lockup
  const vig = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.25, W * 0.5, H * 0.5, W * 0.65);
  vig.addColorStop(0, 'rgba(7, 6, 11, 0)');
  vig.addColorStop(1, 'rgba(5, 4, 9, 0.62)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
}

function drawWorld(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;

  drawPurpleGlowBackground(g, t);

  // Smooth fade-out at the very end (9.45s -> 9.95s) so the GIF loops cleanly on Discord
  // after holding for over 8 seconds while readers view the announcement
  const loopOut = 1 - ease(t, 9.45, 9.95);

  // Choreography:
  // 0.05s: ATAS X icon springs in at center, then at 0.50s glides left to x = 410
  const kIn = t - 0.05;
  const sIn = spr(kIn, BOUNCE);
  const shift = spr(t - 0.50, GLIDE);
  const iconCx = lerp(W / 2, 410, shift);
  const iconCy = H / 2;
  const breathe = 1 + 0.018 * Math.sin(t * W0 * 4);

  if (kIn > 0 && loopOut > 0.001) {
    g.save();
    g.translate(iconCx, iconCy);
    const sc = sIn * breathe * (0.94 + 0.06 * loopOut);
    g.scale(sc, sc);
    g.globalAlpha = clamp01(kIn / 0.15) * loopOut;

    // Ambient purple halo behind icon tile
    const halo = g.createRadialGradient(0, 0, 20, 0, 0, 195);
    halo.addColorStop(0, 'rgba(147, 51, 234, 0.50)');
    halo.addColorStop(0.55, 'rgba(99, 102, 241, 0.18)');
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, 0, 195, 0, Math.PI * 2);
    g.fill();

    // Dark glass icon container
    const box = 224;
    rr(g, -box / 2, -box / 2, box, box, 48);
    const tileGrad = g.createLinearGradient(-box / 2, -box / 2, box / 2, box / 2);
    tileGrad.addColorStop(0, 'rgba(28, 24, 42, 0.92)');
    tileGrad.addColorStop(1, 'rgba(15, 13, 24, 0.95)');
    g.fillStyle = tileGrad;
    g.fill();

    g.lineWidth = 2;
    const borderGrad = g.createLinearGradient(-box / 2, -box / 2, box / 2, box / 2);
    borderGrad.addColorStop(0, 'rgba(192, 132, 252, 0.55)');
    borderGrad.addColorStop(0.5, 'rgba(124, 58, 237, 0.22)');
    borderGrad.addColorStop(1, 'rgba(99, 102, 241, 0.45)');
    g.strokeStyle = borderGrad;
    g.stroke();

    // ATAS X hexagon icon
    const icoS = 148;
    g.drawImage(AX_ICON, -icoS / 2, -icoS / 2, icoS, icoS);
    g.restore();
  }

  // Right-side lockup: starts appearing as the icon glides left
  const textX = 580;

  // 1. Top "NEW UPDATE" pill badge
  const kBadge = t - 0.62;
  if (kBadge > 0 && loopOut > 0.001) {
    const sb = spr(kBadge, SNAP);
    g.save();
    g.globalAlpha = clamp01(kBadge / 0.18) * loopOut;
    g.translate(textX, 178 + (1 - sb) * 22);

    const pw = 216, ph = 42;
    rr(g, 0, -ph / 2, pw, ph, 21);
    g.fillStyle = 'rgba(139, 92, 246, 0.16)';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(167, 139, 250, 0.42)';
    g.stroke();

    // Glowing live dot
    const dotPulse = 0.75 + 0.25 * Math.sin(t * W0 * 6);
    g.beginPath();
    g.arc(24, 0, 5.5, 0, Math.PI * 2);
    g.fillStyle = `rgba(192, 132, 252, ${dotPulse.toFixed(3)})`;
    g.fill();

    g.font = F5(20);
    g.fillStyle = '#e9d5ff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.letterSpacing = '1.5px';
    g.fillText('NEW UPDATE', 42, 1);
    g.restore();
  }

  // 2. Main headline: "ATAS X now supports"
  const kTitle = t - 0.72;
  if (kTitle > 0 && loopOut > 0.001) {
    const st = spr(kTitle, SNAP);
    g.save();
    g.globalAlpha = clamp01(kTitle / 0.18) * loopOut;
    g.translate(textX, 278 + (1 - st) * 28);

    g.font = F5(78);
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.letterSpacing = '-2px';
    g.fillText('ATAS X', 0, 0);

    const axW = g.measureText('ATAS X').width;
    g.font = F4(44);
    g.fillStyle = '#b8b5c8';
    g.letterSpacing = '-0.6px';
    g.fillText('now supports', axW + 26, 6);
    g.restore();
  }

  // 3. Three Suite Cards / Pills in a clean horizontal row
  const rowY = 418;
  let curX = textX;
  g.font = F5(32);
  g.letterSpacing = '-0.4px';

  SUITES.forEach((name, i) => {
    g.font = F5(32);
    const tw = g.measureText(name).width;
    const cardW = tw + 82;
    const cardH = 78;
    const x0 = curX;
    curX += cardW + 22;

    const kCard = t - (0.94 + i * 0.11);
    if (kCard <= 0 || loopOut <= 0.001) return;
    const sc = spr(kCard, BOUNCE);

    g.save();
    g.globalAlpha = clamp01(kCard / 0.16) * loopOut;
    g.translate(x0 + cardW / 2, rowY + (1 - sc) * 32);
    g.scale(0.92 + 0.08 * sc, 0.92 + 0.08 * sc);

    // Card background
    rr(g, -cardW / 2, -cardH / 2, cardW, cardH, 20);
    const cg = g.createLinearGradient(-cardW / 2, -cardH / 2, cardW / 2, cardH / 2);
    cg.addColorStop(0, 'rgba(30, 25, 46, 0.88)');
    cg.addColorStop(1, 'rgba(18, 15, 29, 0.92)');
    g.fillStyle = cg;
    g.fill();

    // Subtle animated highlight border (periodic with W0*4)
    const pulse = 0.5 + 0.5 * Math.sin(t * W0 * 4 - i * 1.1);
    g.lineWidth = 1.8;
    g.strokeStyle = `rgba(168, 85, 247, ${(0.32 + 0.28 * pulse).toFixed(3)})`;
    g.stroke();

    // Purple accent check badge inside each suite pill
    const dotX = -cardW / 2 + 34;
    g.beginPath();
    g.arc(dotX, 0, 13, 0, Math.PI * 2);
    g.fillStyle = 'rgba(147, 51, 234, 0.28)';
    g.fill();

    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#c084fc';
    g.beginPath();
    g.moveTo(dotX - 5.5, 0.5);
    g.lineTo(dotX - 1.5, 4.5);
    g.lineTo(dotX + 6, -4);
    g.stroke();

    // Suite name
    g.font = F5(32);
    g.fillStyle = '#f5f3ff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.letterSpacing = '-0.4px';
    g.fillText(name, -cardW / 2 + 60, 1);

    g.restore();
  });
}

// 4-sample 180° shutter motion blur
const N = 4, SHUT = 1 / 60;
const out = createCanvas(W, H), o = out.getContext('2d');
const TMP = createCanvas(W, H), tg = TMP.getContext('2d');

function renderFrame(f) {
  for (let k = 0; k < N; k++) {
    const t = Math.max(0, f / FPS - SHUT * k / (N - 1));
    drawWorld(tg, t);
    o.globalAlpha = 1 / (k + 1);
    o.drawImage(TMP, 0, 0);
  }
  o.globalAlpha = 1;
}

(async () => {
  AX_ICON = await loadImage('icons/ax.png');

  if (SMOKE) {
    const ts = (process.env.TIMES || '0.3,0.8,1.2,2.5,6.0').split(',');
    for (const s of ts) {
      const f = Math.round(+s * FPS);
      renderFrame(f);
      const fn = `qc/ax_banner_${String(f).padStart(4, '0')}.png`;
      writeFileSync(fn, out.toBuffer('image/png'));
      console.log('Wrote', fn);
    }
    return;
  }

  const mp4Path = 'out/atasx_mbo_banner.mp4';
  const gifPath = 'out/atasx_mbo_banner.gif';

  const ff = spawn(FF, [
    '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', mp4Path
  ], { stdio: ['pipe', 'inherit', 'pipe'] });

  let tail = '';
  ff.stderr.on('data', d => { tail = (tail + d).slice(-3000); });
  const done = new Promise(res => ff.on('exit', res));

  for (let f = 0; f < FRAMES; f++) {
    renderFrame(f);
    const px = o.getImageData(0, 0, W, H).data;
    if (!ff.stdin.write(Buffer.from(px.buffer, px.byteOffset, px.byteLength))) {
      await new Promise(r => ff.stdin.once('drain', r));
    }
  }
  ff.stdin.end();
  const code = await done;
  if (code !== 0) {
    console.error('ffmpeg mp4 exit', code, tail);
    process.exit(1);
  }
  console.log('MP4 RENDER OK ->', mp4Path);

  // Convert MP4 to high-quality looping GIF (1200x400) + compact Discord <8MB GIF (900x300)
  const gifRes = spawnSync(FF, [
    '-y', '-i', mp4Path,
    '-vf', 'fps=18,scale=1200:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=192:stats_mode=full[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    '-loop', '0',
    gifPath
  ], { encoding: 'utf8' });

  if (gifRes.status !== 0) {
    console.error('ffmpeg gif exit', gifRes.status, gifRes.stderr.slice(-2000));
    process.exit(1);
  }
  const szMb = (statSync(gifPath).size / (1024 * 1024)).toFixed(2);
  console.log(`GIF RENDER OK -> ${gifPath} (${szMb} MB)`);

  const discordGifPath = 'out/atasx_mbo_banner_discord.gif';
  spawnSync(FF, [
    '-y', '-i', mp4Path,
    '-vf', 'fps=14,scale=840:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=full[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0',
    discordGifPath
  ], { encoding: 'utf8' });
  const dSzMb = (statSync(discordGifPath).size / (1024 * 1024)).toFixed(2);
  console.log(`DISCORD GIF RENDER OK -> ${discordGifPath} (${dSzMb} MB)`);
})();
