// Mux the short cut: SFX only (no music) — every hit from out/timeline_short.json (written by render_short.js).
// Usage: node assemble_short.js [name]  -> out/tradebay_<name>.mp4 (name defaults to 'short'; 'line' for render_line.js)
const { spawnSync } = require('child_process');
const { readFileSync } = require('fs');
const FF = process.env.FFMPEG || 'C:\\Users\\hawdi\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe';
const NAME = process.argv[2] || 'short';
const { dur, events } = JSON.parse(readFileSync(`out/timeline_${NAME}.json`, 'utf8'));
const GAIN = +(process.env.GAIN || 2.0); // SFX-only mix needs more makeup gain than the old music+SFX mix
const VOL = { boom: 0.55, whoosh: 0.45, pop: 0.4, tick: 0.35, notif: 0.5, rewind: 0.8, rip: 0.9, riser: 0.45, chime: 0.5 };

// input 1 is silence for the full length so the mix runs to the end; SFX layered on top
const args = ['-y', '-i', `out/tradebay_${NAME}_nosound.mp4`, '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=mono'];
events.forEach(([n]) => args.push('-i', `sfx/${n}.wav`));
let fc = '';
events.forEach(([n, at], k) => { fc += `[${k + 2}:a]volume=${VOL[n]},adelay=${Math.round(at * 1000)}:all=1[e${k}];`; });
fc += '[1:a]' + events.map((_, k) => `[e${k}]`).join('') +
  `amix=inputs=${events.length + 1}:normalize=0:duration=first,atrim=0:${dur},volume=${GAIN},alimiter=limit=0.89,aformat=channel_layouts=stereo[out]`;
args.push('-filter_complex', fc, '-map', '0:v', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-t', String(dur), '-movflags', '+faststart', `out/tradebay_${NAME}.mp4`);

const r = spawnSync(FF, args, { encoding: 'utf8' });
if (r.status === 0) console.log(`MUX OK (${events.length} sfx)`);
else { console.error(r.stderr.slice(-2000)); process.exit(1); }
