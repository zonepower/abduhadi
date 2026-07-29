#!/usr/bin/env python3
"""Records every manifest clause with Microsoft Edge neural TTS.

Casting:
  karim     ar-SA-HamedNeural   — deep, steady adult male
  layla     ar-SA-ZariyahNeural — female raised into a child register
  shepherd  ar-IQ-BasselNeural  — gravel, dropped low (the game layers its
                                  own growl/ring-mod and cathedral reverb)
  narrator  ar-EG-ShakirNeural  — slow, distant

Per-line emotion bends rate / pitch / volume on top of the character base.
Output: MP3 clips (24 kHz mono) in tools/voices/, named by manifest index.
"""

import asyncio
import json
import os
import sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tools", "voices")

CAST = {
    "karim": {"voice": "ar-SA-HamedNeural", "pitch": -2, "rate": -6, "volume": 0},
    "layla": {"voice": "ar-SA-ZariyahNeural", "pitch": 38, "rate": 10, "volume": 0},
    "shepherd": {"voice": "ar-IQ-BasselNeural", "pitch": -30, "rate": -24, "volume": 5},
    "narrator": {"voice": "ar-EG-ShakirNeural", "pitch": -6, "rate": -14, "volume": -5},
}

# deltas applied on top of the character base
EMOTION = {
    "calm":    (0, 0, 0),
    "soft":    (-4, -8, -12),
    "tense":   (4, 8, 0),
    "afraid":  (12, 12, 0),
    "plead":   (8, -2, 0),
    "cry":     (6, -18, -6),
    "scream":  (22, 18, 12),
    "angry":   (-6, 10, 8),
    "mock":    (2, -8, 0),
    "cold":    (-10, -14, -4),
    "whisper": (-4, -14, -22),
    "hurt":    (-8, -12, -8),
}


async def record(index, clip, semaphore):
    base = CAST[clip["who"]]
    d_pitch, d_rate, d_vol = EMOTION.get(clip["emo"], (0, 0, 0))
    pitch = base["pitch"] + d_pitch
    rate = base["rate"] + d_rate
    volume = base["volume"] + d_vol
    path = os.path.join(OUT, f"{index:03d}.mp3")
    if os.path.exists(path) and os.path.getsize(path) > 400:
        return "cached"
    async with semaphore:
        for attempt in range(4):
            try:
                communicate = edge_tts.Communicate(
                    clip["text"],
                    base["voice"],
                    pitch=f"{pitch:+d}Hz",
                    rate=f"{rate:+d}%",
                    volume=f"{volume:+d}%",
                )
                await communicate.save(path)
                if os.path.getsize(path) > 400:
                    return "ok"
            except Exception as exc:  # noqa: BLE001 — retry any transport error
                if attempt == 3:
                    return f"FAIL {exc}"
                await asyncio.sleep(1.5 * (attempt + 1))
    return "FAIL empty"


async def main():
    with open(os.path.join(ROOT, "tools", "voice-manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    os.makedirs(OUT, exist_ok=True)
    semaphore = asyncio.Semaphore(6)
    results = await asyncio.gather(
        *(record(i, clip, semaphore) for i, clip in enumerate(manifest))
    )
    ok = sum(1 for r in results if r in ("ok", "cached"))
    fails = [(i, r) for i, r in enumerate(results) if r.startswith("FAIL")]
    print(f"recorded {ok}/{len(manifest)}")
    for i, r in fails[:10]:
        print(f"  clip {i}: {r} :: {manifest[i]['text'][:40]}")
    if fails:
        sys.exit(1)


asyncio.run(main())
