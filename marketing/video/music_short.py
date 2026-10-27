# Beat bed for the short cut (120 BPM, beat = 0.5s) + two extra SFX. Stdlib only.
# Section times come from out/timeline_short.json (written by render_short.js):
# full groove 0-1.0, tape-stop 1.0-1.5, build 1.5-drop (no kick), groove drop-end, final hit at end + ring-out.
import math, random, wave, array, os, json

SR = 44100
TL = json.load(open("out/timeline_short.json"))
DUR, DROP, END = TL["dur"], TL["drop"], TL["end"]
N = int(DUR * SR)
BEAT = 0.5
os.makedirs("sfx", exist_ok=True)
rng = random.Random(3)
NOISE = [rng.uniform(-1, 1) for _ in range(SR)]

def write(name, buf, gain):
    peak = max(1e-9, max(abs(s) for s in buf))
    k = gain / peak
    data = array.array('h', (int(max(-1, min(1, s * k)) * 32767) for s in buf))
    with wave.open(os.path.join("sfx", name), 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(name, round(len(buf) / SR, 2))

out = [0.0] * N

def add(at, samples, vol):
    s0 = int(at * SR)
    for i, v in enumerate(samples):
        j = s0 + i
        if 0 <= j < N: out[j] += v * vol

def kick():
    n = int(0.32 * SR); ph = 0.0; o = []
    for i in range(n):
        t = i / SR
        f = 45 + 95 * math.exp(-t * 32)
        ph += 2 * math.pi * f / SR
        o.append(math.sin(ph) * math.exp(-t * 9) + (NOISE[i] * math.exp(-t * 400) * 0.3))
    return o

def clap():
    n = int(0.16 * SR); o = []; prev = 0.0
    for i in range(n):
        t = i / SR
        x = NOISE[(i * 7) % SR]; hp = x - prev; prev = x
        burst = max(math.exp(-((t - d) if t >= d else 9) * 60) for d in (0, 0.011, 0.022))
        o.append(hp * burst * 0.6 + hp * math.exp(-t * 22) * 0.4)
    return o

def hat(open_=False):
    n = int((0.09 if open_ else 0.035) * SR); o = []; prev = 0.0
    for i in range(n):
        x = NOISE[(i * 13 + 99) % SR]; hp = x - prev; prev = x
        o.append(hp * math.exp(-i / SR * (30 if open_ else 110)))
    return o

K, CL, HT, HO = kick(), clap(), hat(), hat(True)

def full(t):  return (0 <= t < 1.0) or (DROP <= t < END)
def build(t): return 1.5 <= t < DROP

# drums on an 8th-note grid
for s in range(int(DUR / (BEAT / 2))):
    t = s * BEAT / 2
    on_beat = s % 2 == 0
    beat_i = s // 2
    if full(t):
        if on_beat: add(t, K, 0.95)
        if on_beat and beat_i % 2 == 1: add(t, CL, 0.42)
        if not on_beat: add(t, HO if beat_i % 4 == 3 else HT, 0.22)
    elif build(t):
        if not on_beat: add(t, HT, 0.16)
        if t >= 2.5: add(t, HT, 0.12)  # hats double up into the drop
add(END, K, 1.1)

# chords: Am F C G, one per 2s bar, bars anchored on the drop
CH = [((55.0,), (220.0, 261.63, 329.63)), ((43.65,), (174.61, 220.0, 261.63)),
      ((65.41,), (261.63, 329.63, 392.0)), ((49.0,), (196.0, 246.94, 293.66))]
def chord_at(t):
    return CH[int(math.floor((t - DROP) / 2.0)) % 4]

bph = 0.0; pph = [0.0] * 3; last = None
for i in range(N):
    t = i / SR
    root, triad = chord_at(t)
    if t >= END: root, triad = CH[0]
    if t < 1.0 or 1.5 <= t < END or t >= END:
        # bass: 3-harmonic saw-ish, sidechain pump on every beat
        bph += 2 * math.pi * root[0] / SR
        b = math.sin(bph) + 0.45 * math.sin(2 * bph) + 0.2 * math.sin(3 * bph)
        ib = (t % BEAT) / BEAT
        pump = 0.25 + 0.75 * min(1.0, ib / 0.35) if full(t) else (0.55 if build(t) else 1.0)
        bv = 0.32 if full(t) else (0.18 if build(t) else 0.0)
        if t >= END: bv = 0.36 * math.exp(-(t - END) * 1.6); pump = 1.0
        # pad: detuned triad, quiet, swells in build, rings out at the end
        p = 0.0
        for k, f in enumerate(triad):
            pph[k] += 2 * math.pi * f * (1.003 if k == 1 else 1.0) / SR
            p += math.sin(pph[k]) + 0.3 * math.sin(2 * pph[k])
        pv = 0.05 if full(t) else (0.04 + 0.05 * (t - 1.5) / 2.0 if build(t) else 0.0)
        if t >= END: pv = 0.16 * math.exp(-(t - END) * 1.3)
        out[i] += b * bv * pump + p * pv * (pump if full(t) else 1.0)

# tape-stop window 1.0-1.5: fade the tail of the groove fast
for i in range(int(1.0 * SR), int(1.5 * SR)):
    out[i] *= max(0.0, 1 - (i / SR - 1.0) / 0.08)
# tiny fades at both ends
for i in range(int(0.004 * SR)): out[i] *= i / (0.004 * SR)
for i in range(int(0.3 * SR)): out[N - 1 - i] *= i / (0.3 * SR)
write("music_short.wav", out, 0.8)

# rewind: falling sweep with a 28 Hz stutter + hiss, 0.5s
n = int(0.5 * SR); ph = 0.0; o = []
for i in range(n):
    t = i / n
    ph += 2 * math.pi * (900 * (1 - t) ** 2 + 70) / SR
    st = 0.55 + 0.45 * math.sin(2 * math.pi * 28 * i / SR)
    o.append((math.sin(ph) * 0.7 + NOISE[i] * 0.25) * st * min(1, t / 0.02) * (1 - t) ** 0.5)
write("rewind.wav", o, 0.7)

# notif: two-note phone ding, 0.3s
n = int(0.3 * SR); o = []
for i in range(n):
    t = i / SR
    f = 1046.5 if t < 0.08 else 1568.0
    tt = t if t < 0.08 else t - 0.08
    o.append(math.sin(2 * math.pi * f * t) * math.exp(-tt * 18) * min(1, tt / 0.003))
write("notif.wav", o, 0.6)
