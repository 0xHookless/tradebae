# Extra SFX for render_line.js: paper rip. Stdlib only. -> sfx/rip.wav
import math, random, wave, array, os

SR = 44100
os.makedirs("sfx", exist_ok=True)
rng = random.Random(11)
n = int(0.42 * SR)
out, prev, lp = [], 0.0, 0.0
for i in range(n):
    t = i / SR
    x = rng.uniform(-1, 1)
    hp = x - prev; prev = x                       # bright paper fibre noise
    lp += 0.25 * (x - lp)                         # body
    crackle = 1.0 if rng.random() < 0.35 else 0.15  # torn fibres: irregular micro-gaps
    env = min(1, t / 0.006) * math.exp(-t * 7.5)
    out.append((hp * 0.7 + lp * 0.6) * crackle * env)
peak = max(abs(s) for s in out)
data = array.array('h', (int(s / peak * 0.75 * 32767) for s in out))
with wave.open("sfx/rip.wav", "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
print("rip.wav", round(n / SR, 2))
