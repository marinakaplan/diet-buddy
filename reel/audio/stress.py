"""Rough stress check for a two-syllable word: compares loudness and pitch of the first vs second
syllable inside [start, end]. Usage: python3 stress.py file start end"""
import sys, subprocess, numpy as np
SR = 16000
p, a, b = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', p, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
x = np.frombuffer(raw, np.int16).astype(np.float32)[int(a * SR):int(b * SR)] / 32768
n, h = int(.03 * SR), int(.01 * SR)
fr = [x[i:i + n] for i in range(0, len(x) - n, h)]
rms = np.array([np.sqrt(np.mean(f ** 2)) for f in fr])
def f0(f):
    f = f * np.hanning(len(f)); ac = np.fft.irfft(np.abs(np.fft.rfft(f, 2 * len(f))) ** 2)[:len(f)]
    lo, hi = SR // 450, SR // 120; k = lo + np.argmax(ac[lo:hi]); return SR / k if ac[k] > .35 * ac[0] else np.nan
pit = np.array([f0(f) for f in fr])
# split at the energy dip between the two vowels (the consonant /f/)
mid = len(rms) // 4 + np.argmin(rms[len(rms) // 4: 3 * len(rms) // 4])
for name, sl in (('syllable 1 (יָ)', slice(0, mid)), ('syllable 2 (פָה)', slice(mid, None))):
    print(f'{name}: peak loudness {20*np.log10(rms[sl].max()+1e-9):6.1f} dB   pitch {np.nanmax(pit[sl]) if np.any(~np.isnan(pit[sl])) else float("nan"):6.0f} Hz   length {len(rms[sl])*10} ms')
