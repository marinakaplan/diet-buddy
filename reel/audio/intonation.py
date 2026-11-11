"""Rough intonation meter: pitch range (semitones, 10th-90th pct) and pitch movement for voiced frames.
Higher = livelier delivery. Usage: python3 intonation.py file1 [file2 ...]"""
import sys, subprocess, numpy as np
SR = 16000
def load(p):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', p, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768
def f0_track(x, win=0.04, hop=0.01, fmin=120, fmax=450):
    n, h = int(win * SR), int(hop * SR); out = []
    for i in range(0, len(x) - n, h):
        f = x[i:i + n] * np.hanning(n)
        if np.sqrt(np.mean(f ** 2)) < 0.02: out.append(np.nan); continue
        ac = np.fft.irfft(np.abs(np.fft.rfft(f, 2 * n)) ** 2)[:n]
        lo, hi = int(SR / fmax), int(SR / fmin)
        k = lo + np.argmax(ac[lo:hi])
        out.append(SR / k if ac[k] > 0.35 * ac[0] else np.nan)
    return np.array(out)
for p in sys.argv[1:]:
    f = f0_track(load(p)); v = f[~np.isnan(f)]
    st = 12 * np.log2(v / np.median(v))
    move = np.nanmean(np.abs(np.diff(12 * np.log2(f / np.nanmedian(f)))))
    print(f'{p.split("/")[-1]:24s} range {np.percentile(st,90)-np.percentile(st,10):5.2f} st   std {np.std(st):4.2f} st   movement {move:4.3f}')
