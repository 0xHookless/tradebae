import math, wave, array, os, struct, random

SR = 44100
os.makedirs("sfx", exist_ok=True)

def save(name, samples, gain=0.85):
    peak = max(1e-9, max(abs(s) for s in samples))
    scale = gain / peak if peak > gain else 1.0
    data = array.array('h', (int(max(-1, min(1, s * scale)) * 32767) for s in samples))
    with wave.open(os.path.join("sfx", name), 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(name, len(samples) / SR)

def env_exp(n, decay):
    return [math.exp(-decay * i / SR) for i in range(n)]

def sine_sweep(n, f0, f1, curve=1.0):
    out, ph = [], 0.0
    for i in range(n):
        t = i / n
        f = f0 + (f1 - f0) * (t ** curve)
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph))
    return out

def noise(seed=1):
    rng = random.Random(seed)
    return [rng.uniform(-1, 1) for _ in range(SR * 3)]

NOISE = noise(7)

def band_slice(start, n, passes=3, alpha=0.18):
    xs = NOISE[start:start + n]
    for _ in range(passes):
        ys = []
        acc = 0.0
        for x in xs:
            acc += alpha * (x - acc)
            ys.append(acc)
        xs = ys
    return xs

# riser 2.2s: sweep + noise swell
n = int(2.2 * SR)
sweep = sine_sweep(n, 180, 950, 1.6)
hiss = band_slice(0, n, passes=2, alpha=0.5)
samples = []
for i in range(n):
    t = i / n
    v = sweeform = 0.55 * sweep[i] + 0.45 * hiss[i]
    fade = min(1.0, t / 0.02)  # cut attack pop
    samples.append(v * (t ** 1.8) * fade)
save("riser.wav", samples, 0.7)

# boom 0.9s: sub drop + soft noise thud
n = int(0.9 * SR)
sub = sine_sweep(n, 92, 36, 0.7)
thud = band_slice(5000, n, passes=4, alpha=0.3)
e1 = env_exp(n, 5.5)
samples = [sub[i] * e1[i] + thud[i] * e1[i] * 0.35 for i in range(n)]
save("boom.wav", samples, 0.92)

# whoosh 0.55s
n = int(0.55 * SR)
w = band_slice(12000, n, passes=2, alpha=0.4)
samples = [w[i] * math.sin(math.pi * i / n) ** 2 * 1.4 for i in range(n)]
save("whoosh.wav", samples, 0.6)

# tick 0.12s
n = int(0.12 * SR)
tone = sine_sweep(n, 1250, 900, 1.0)
e = env_exp(n, 60)
samples = [tone[i] * e[i] for i in range(n)]
save("tick.wav", samples, 0.55)

# pop 0.28s
n = int(0.28 * SR)
tone = sine_sweep(n, 240, 70, 0.8)
samples = [tone[i] * env_exp(n, 22)[i] for i in range(n)]
save("pop.wav", samples, 0.9)

# chime 1.4s
n = int(1.4 * SR)
a1 = sine_sweep(n, 660, 660); a2 = sine_sweep(n, 988, 986); a3 = sine_sweep(n, 1320, 1318)
e = env_exp(n, 3.2)
samples = [(a1[i] * 0.5 + a2[i] * 0.3 + a3[i] * 0.15) * e[i] for i in range(n)]
save("chime.wav", samples, 0.7)
