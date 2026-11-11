"""Does a word end in a vowel? Reports how much of the word's last 150 ms is voiced (has pitch).
Masculine 'פספסתָּ' (pispasta) ends voiced; feminine 'פספסתְּ' (pispast) ends unvoiced.
Usage: python3 ending.py file start end"""
import sys, subprocess, numpy as np
SR = 16000
p, a, b = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', p, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
seg = x[int(a * SR):int(b * SR)]
n, h = int(.03 * SR), int(.01 * SR)
def voiced(f):
    if np.sqrt(np.mean(f ** 2)) < 0.01: return None          # silence
    f = f * np.hanning(len(f)); ac = np.fft.irfft(np.abs(np.fft.rfft(f, 2 * len(f))) ** 2)[:len(f)]
    lo, hi = SR // 450, SR // 120
    return ac[lo + np.argmax(ac[lo:hi])] > 0.45 * ac[0]
fr = [voiced(seg[i:i + n]) for i in range(0, len(seg) - n, h)]
fr = [v for v in fr if v is not None]                      # drop trailing silence
tail = fr[-15:]
print(f'{p.split("/")[-1]}: last 150 ms of sound voiced {100*sum(tail)/max(1,len(tail)):.0f}%  (last frames: {"".join("v" if v else "." for v in tail)})')
