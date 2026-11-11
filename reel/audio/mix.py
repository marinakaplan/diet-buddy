"""Mixes audio/vo.wav with the micro sound effects listed in audio/sfx-events.json -> audio/mix.wav."""
import json, os, wave, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); SFXDIR = os.path.join(os.path.dirname(HERE), 'sfx'); SR = 48000
def read(p):
    with wave.open(p) as w:
        assert w.getframerate() == SR
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
        return x.reshape(-1, w.getnchannels()).mean(1)
ev = json.load(open(os.path.join(HERE, 'sfx-events.json')))
out = np.zeros(int(ev['dur'] * SR) + SR)
vo = read(os.path.join(HERE, 'vo.wav')); out[:len(vo)] += vo
cache = {}
for t, name, g in ev['sfx']:
    s = cache.setdefault(name, read(os.path.join(SFXDIR, name + '.wav')))
    i = max(0, int(t * SR)); seg = s[: len(out) - i]
    out[i:i + len(seg)] += seg * g * 0.42          # effects sit under the voice
out = out[: int(ev['dur'] * SR)]
fade = int(.4 * SR); out[-fade:] *= np.linspace(1, 0, fade)
peak = np.max(np.abs(out)); out = out / peak * 0.95 if peak > 0.95 else out
with wave.open(os.path.join(HERE, 'mix.wav'), 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out * 32767).astype(np.int16).tobytes())
print('mixed', len(ev['sfx']), 'effects,', round(len(out) / SR, 2), 's')
