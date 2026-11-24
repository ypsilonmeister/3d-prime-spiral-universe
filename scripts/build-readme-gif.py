#!/usr/bin/env python3
"""Assemble PNG frames from capture-readme-gif.mjs into a size-limited GIF.
Usage: build-readme-gif.py <framesDir> <out.gif> [colors]
Frames are cropped to the central curve + large N read-out (side panels dropped) to keep the file small."""
import glob, sys
from PIL import Image

frames_dir, out = sys.argv[1], sys.argv[2]
colors = int(sys.argv[3]) if len(sys.argv) > 3 else 64
CROP = (225, 0, 535, 400)  # for 800x500 captures
paths = sorted(glob.glob(f"{frames_dir}/frame-*.png"))
imgs = []
for p in paths:
    im = Image.open(p).convert("RGB")
    im = im.crop(CROP)
    imgs.append(im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
durations = [350] * len(imgs)
durations[0] = 900      # hold at N=10
durations[-1] = 1800    # hold at N=1000
imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(len(imgs), "frames")
