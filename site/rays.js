/* Trade Bay background: underwater sun shafts. One fixed WebGL layer behind the page.
   Bright white-gold sun above the top-right edge, shafts slanting down through blue-violet water,
   caustic shimmer near the surface and a few drifting motes. Dims behind the dense middle of the page. */
(() => {
'use strict';

const canvas = document.querySelector('[data-rays]');
if (!canvas) return;
const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power' });
if (!gl) return; // CSS gradient on the canvas element stays as the fallback

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const small = matchMedia('(max-width: 760px)');

const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uDim;
uniform vec2 uSun;
uniform float uDetail;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x * aspect, 1.0 - uv.y);           // y grows downward
  vec2 sun = vec2(uSun.x * aspect, uSun.y);
  vec2 d = p - sun;
  float dist = length(d);
  float ang = atan(d.x, d.y);                          // 0 = straight down from the sun
  float t = uTime;

  // Light shafts: three bands of angular noise drifting at different speeds
  float r1 = noise(vec2(ang * 8.0 + t * 0.045, t * 0.06));
  float r2 = noise(vec2(ang * 21.0 - t * 0.07, 3.0 + t * 0.09));
  float r3 = noise(vec2(ang * 47.0 + t * 0.11, 7.0 - t * 0.05));
  float shafts = pow(r1, 2.0) * 0.65 + pow(r2, 3.0) * 0.5 + pow(r3, 4.0) * 0.3;
  float sway = 0.85 + 0.15 * noise(vec2(dist * 3.0 - t * 0.2, ang * 4.0)); // light breaking up with depth
  shafts *= sway * smoothstep(1.35, 0.1, abs(ang)) * exp(-dist * 1.15);

  // Water: deep near-black at the edges, blue then violet toward the light
  vec3 ground = vec3(0.055, 0.055, 0.067);
  vec3 deep = vec3(0.030, 0.032, 0.058);
  vec3 blue = vec3(0.060, 0.100, 0.260);
  vec3 violet = vec3(0.230, 0.120, 0.420);
  vec3 col = mix(blue, deep, smoothstep(0.05, 1.15, dist));
  col = mix(col, violet, 0.38 * exp(-dist * 1.9) * (0.55 + 0.45 * sin(ang * 2.2 + t * 0.04)));

  vec3 shaftCol = mix(vec3(0.62, 0.80, 1.00), vec3(0.58, 0.46, 1.00), smoothstep(0.25, 1.25, dist));
  col += shaftCol * shafts * 0.9;

  // Sun: white-gold core with a cool halo
  col += vec3(1.00, 0.90, 0.70) * exp(-dist * dist * 22.0) * 1.6;
  col += vec3(0.50, 0.58, 1.00) * exp(-dist * 3.0) * 0.28;

  // Caustics: bright net shimmer near the surface
  if (uDetail > 0.5) {
    vec2 cp = p * vec2(5.0, 9.0) + vec2(t * 0.12, t * 0.04);
    float c = fbm(cp + fbm(cp * 0.7 - t * 0.08));
    col += vec3(0.65, 0.82, 1.00) * pow(1.0 - abs(c * 2.0 - 1.0), 7.0) * 0.22 * exp(-dist * 2.4);
  }

  // Motes drifting slowly upward, twinkling as they cross a shaft
  vec2 g = p * 26.0 + vec2(sin(t * 0.1 + p.y * 3.0) * 0.4, t * 0.35);
  vec2 gi = floor(g), gf = fract(g);
  float h = hash(gi);
  vec2 mp = vec2(hash(gi + 1.3), hash(gi + 7.1)) * 0.7 + 0.15;
  float mote = step(0.94, h) * smoothstep(0.07, 0.0, length(gf - mp)) * (0.5 + 0.5 * sin(t * 1.3 + h * 40.0));
  col += vec3(0.75, 0.85, 1.00) * mote * (0.25 + shafts * 1.5) * exp(-dist * 0.9);

  col = 1.0 - exp(-col * 1.35);                        // soft tone map keeps the sun from clipping hard
  col = mix(ground, col, uDim);
  col += (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0; // dither against banding
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
  return s;
}
const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
if (!vs || !fs) return;
const prog = gl.createProgram();
gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
gl.useProgram(prog);

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'a');
gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
const U = n => gl.getUniformLocation(prog, n);
const uRes = U('uRes'), uTime = U('uTime'), uDim = U('uDim'), uSun = U('uSun'), uDetail = U('uDetail');

// Rendered below screen resolution and scaled up by CSS: the image is soft by nature, the GPU cost drops a lot.
function resize() {
  const scale = small.matches ? 0.35 : 0.5;
  const w = Math.max(1, Math.round(innerWidth * scale)), h = Math.max(1, Math.round(innerHeight * scale));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  gl.uniform2f(uRes, w, h);
  gl.uniform2f(uSun, small.matches ? 0.92 : 0.72, small.matches ? -0.16 : -0.12);
  gl.uniform1f(uDetail, small.matches ? 0 : 1);
}

// Full strength over the hero, dimmer behind the dense middle, lifting again behind the footer.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function dimFor(y) {
  const vh = innerHeight, max = document.documentElement.scrollHeight - vh;
  return 1 - 0.5 * smooth(vh * 0.4, vh * 1.6, y) + 0.32 * smooth(max - vh * 0.9, max, y);
}

let dim = dimFor(scrollY), last = 0, start = performance.now(), running = false;
function draw(now) {
  const target = dimFor(scrollY);
  dim += (target - dim) * 0.08;
  gl.uniform1f(uDim, dim);
  gl.uniform1f(uTime, reduceMotion.matches ? 18 : (now - start) / 1000 + 18);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  canvas.classList.add('is-live');
}
function frame(now) {
  running = false;
  if (document.hidden || reduceMotion.matches) return;
  if (now - last >= 33) { last = now; draw(now); } // ~30fps is plenty for slow light
  loop();
}
function loop() { if (!running) { running = true; requestAnimationFrame(frame); } }
function still() { dim = dimFor(scrollY); draw(performance.now()); }

resize();
addEventListener('resize', () => { resize(); if (reduceMotion.matches) still(); });
small.addEventListener('change', resize);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
addEventListener('scroll', () => { if (reduceMotion.matches) still(); }, { passive: true });
reduceMotion.addEventListener('change', () => (reduceMotion.matches ? still() : loop()));
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); canvas.classList.remove('is-live'); });
reduceMotion.matches ? still() : loop();
})();
