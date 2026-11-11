"""Synthesizes the reel's micro sound effects as 48 kHz mono WAVs (numpy only)."""
import numpy as np, wave, os
SR = 48000
OUT = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)
def t(d): return np.arange(int(SR * d)) / SR
def env(n, a=0.002, r=0.08):
    x = np.arange(n) / SR
    return np.minimum(1, x / a) * np.exp(-x / r)
def lp(x, k):  # one-pole lowpass, k in (0,1]
    y = np.zeros_like(x); s = 0.0
    for i, v in enumerate(x): s += k * (v - s); y[i] = s
    return y
def save(name, x, gain=0.8):
    x = x / (np.max(np.abs(x)) + 1e-9) * gain
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())
# pop: bubbly pitch drop
tt = t(.12); f = 900 * np.exp(-tt * 28) + 260
save('pop', np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(tt), .001, .035))
# click: tiny tap
tt = t(.04); save('click', (np.sin(2*np.pi*2400*tt) * .6 + rng.standard_normal(len(tt)) * .4) * env(len(tt), .0005, .006), .6)
# whoosh: band-limited noise swell
tt = t(.35); n = rng.standard_normal(len(tt)); w = lp(n, .08) - lp(n, .01)
save('whoosh', w * np.sin(np.pi * tt / .35) ** 2, .55)
# ding: bright two-partial chime
tt = t(.9); x = np.sin(2*np.pi*1318*tt) + .5*np.sin(2*np.pi*1976*tt) + .25*np.sin(2*np.pi*2637*tt)
save('ding', x * env(len(tt), .002, .25), .6)
# scribble: marker strike (filtered noise with jitter)
tt = t(.22); n = lp(rng.standard_normal(len(tt)), .35); am = .6 + .4 * np.sin(2*np.pi*38*tt)
save('scribble', n * am * np.sin(np.pi * tt / .22), .45)
# boing: rising playful blip for the sleepy face / question
tt = t(.3); f = 300 + 500 * tt / .3 + 40 * np.sin(2*np.pi*14*tt)
save('boing', np.sin(2*np.pi*np.cumsum(f)/SR) * env(len(tt), .003, .12), .5)
# thud: soft kick for big number slams
tt = t(.25); f = 140 * np.exp(-tt * 18) + 45
save('thud', np.sin(2*np.pi*np.cumsum(f)/SR) * env(len(tt), .001, .09), .9)
# sparkle: quick arpeggio for the end
tt = t(.6); x = np.zeros(len(tt))
for i, fr in enumerate([1046, 1318, 1568, 2093]):
    s = int(i * .07 * SR); seg = t(.6 - i * .07)
    x[s:s + len(seg)] += np.sin(2*np.pi*fr*seg) * env(len(seg), .001, .12)
save('sparkle', x, .55)
print('ok')
