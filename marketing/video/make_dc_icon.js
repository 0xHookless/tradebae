// DeepCharts only ships a 32px icon (exe + deepchart_icon_dark.png/.ico), which blurs when scaled up.
// This redraws the same mark as vector at 256px -> icons/dc.png: three slanted bars
// (grey, lavender, indigo->black) overlapping left to right, each with a cut-out slot.
const { createCanvas } = require('@napi-rs/canvas');
const { writeFileSync } = require('fs');
const S = 256, k = S / 45, cv = createCanvas(S, S), g = cv.getContext('2d');
g.translate(0, (S - 32 * k) / 2); g.scale(k, k);           // design grid: 45 x 32 like the source png
const slant = 9, bw = 16, r = 2.2;
function para(x, fill, round) {                              // x = bottom-left; top is shifted right by slant
  g.beginPath();
  g.moveTo(x + slant, 0); g.lineTo(x + slant + bw - (round ? r : 0), 0);
  if (round) g.quadraticCurveTo(x + slant + bw, 0, x + slant + bw - 0.4, r);
  g.lineTo(x + bw - (round ? 0.6 : 0), 32 - (round ? r : 0));
  if (round) g.quadraticCurveTo(x + bw - 1.2, 32, x + bw - r - 1, 32);
  g.lineTo(x, 32); g.closePath();
  g.fillStyle = fill; g.fill();
}
function slot(x) {                                           // transparent slanted slot through the bar
  const cx = x + bw / 2 + 1.5, y0 = 5, y1 = 27, w = 3.4, s = slant * (y1 - y0) / 32;
  g.save(); g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.moveTo(cx - w / 2 + s / 2, y0); g.lineTo(cx + w / 2 + s / 2, y0);
  g.lineTo(cx + w / 2 - s / 2, y1); g.lineTo(cx - w / 2 - s / 2, y1); g.closePath(); g.fill(); g.restore();
}
const grad = g.createLinearGradient(20, 0, 44, 0);
grad.addColorStop(0, '#5a10f0'); grad.addColorStop(0.45, '#2a0890'); grad.addColorStop(1, '#05020f');
para(0, '#c4c4c8', false); slot(0);
para(10, '#7f6ea8', false); slot(10);
para(20, grad, true); slot(20);
writeFileSync('icons/dc.png', cv.toBuffer('image/png'));
console.log('icons/dc.png redrawn');
