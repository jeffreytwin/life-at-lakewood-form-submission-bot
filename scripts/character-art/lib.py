"""Shared helpers for the character art scripts: reading and writing the
sprite GIFs, following a character's head from frame to frame, and drawing
chunky pixel shapes that sit well beside the sprites."""
from PIL import Image, ImageDraw, ImageSequence
import numpy as np


def read_gif(path):
    """Every frame fully drawn (RGBA), and how long each one stays up, in ms."""
    im = Image.open(path)
    frames, durations = [], []
    for fr in ImageSequence.Iterator(im):
        frames.append(fr.convert("RGBA").copy())
        # A GIF that names no frame time plays at 100ms in every browser.
        durations.append(fr.info.get("duration") or 100)
    return frames, durations


def _to_palette(frame):
    """One RGBA frame as a 256-colour GIF frame, index 255 kept for see-through."""
    a = np.array(frame)
    clear = a[..., 3] < 128
    rgb = a[..., :3]
    colours = np.unique(rgb[~clear].reshape(-1, 3), axis=0) if (~clear).any() else np.zeros((1, 3), np.uint8)
    if len(colours) <= 255:
        # Few enough colours to keep every one exactly as drawn.
        key = (rgb[..., 0].astype(np.int32) << 16) | (rgb[..., 1].astype(np.int32) << 8) | rgb[..., 2]
        ckey = (colours[:, 0].astype(np.int32) << 16) | (colours[:, 1].astype(np.int32) << 8) | colours[:, 2]
        idx = np.searchsorted(ckey, key).clip(0, len(ckey) - 1).astype(np.uint8)
        pal = np.zeros((256, 3), np.uint8)
        pal[: len(colours)] = colours
        p = Image.fromarray(idx, "P")
        p.putpalette(pal.tobytes())
    else:
        p = frame.convert("RGB").quantize(255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = np.array(p)
    out[clear] = 255
    q = Image.fromarray(out, "P")
    q.putpalette(p.getpalette())
    return q


def write_gif(path, frames, durations, loop=True):
    ps = [_to_palette(f) for f in frames]
    extra = {"loop": 0} if loop else {}
    ps[0].save(
        path, save_all=True, append_images=ps[1:], duration=durations,
        disposal=2, transparency=255, optimize=False, **extra,
    )


def _grey(frame):
    a = np.array(frame).astype(np.float32)
    return (a[..., :3].mean(axis=2) + 40) * (a[..., 3] > 127)


def track(frames, box, turns=False, reach=14):
    """Where the patch `box` (x0, y0, x1, y1) of the first frame has got to in
    each frame: a list of (dx, dy, angle). The face is drawn much the same from
    frame to frame, so the best match is where the head went. With `turns`,
    the head may also tip over; `angle` is in degrees, anticlockwise.

    Each frame is searched near where the head was a frame before (heads do
    not jump), but always matched against the first frame, so small errors do
    not pile up over a long animation."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ref = _grey(frames[0])[y0:y1:2, x0:x1:2]
    out = []
    last = (0, 0, 0)
    pad = 64
    for f in frames:
        best, at = None, last
        angles = [last[2] + d for d in (-9, -6, -3, 0, 3, 6, 9)] if turns else [0]
        for ang in angles:
            if abs(ang) > 45:
                continue
            g = f
            if ang:
                # Turn the frame back by the angle, about where the head was.
                g = f.rotate(-ang, resample=Image.NEAREST, center=(cx + last[0], cy + last[1]))
            g = np.pad(_grey(g), pad)
            for dy in range(last[1] - reach, last[1] + reach + 1):
                for dx in range(last[0] - reach, last[0] + reach + 1):
                    yy, xx = y0 + dy + pad, x0 + dx + pad
                    if yy < 0 or xx < 0:
                        continue
                    cut = g[yy:yy + (y1 - y0):2, xx:xx + (x1 - x0):2]
                    if cut.shape != ref.shape:
                        continue
                    # A small pull towards staying put settles ties.
                    d = np.abs(cut - ref).mean() + 0.02 * (abs(dx - last[0]) + abs(dy - last[1])) + 0.05 * abs(ang - last[2])
                    if best is None or d < best:
                        best, at = d, (dx, dy, ang)
        last = at
        out.append(at)
    return out


class Pixels:
    """A small drawing grid whose every cell becomes one fat sprite pixel."""

    def __init__(self, w, h):
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def scaled(self, block):
        w, h = self.im.size
        return self.im.resize((round(w * block), round(h * block)), Image.NEAREST)


def from_rows(rows, colours, block):
    """A picture from rows of letters, one letter a cell, `.` see-through."""
    im = Image.new("RGBA", (len(rows[0]), len(rows)), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                im.putpixel((x, y), colours[ch])
    return im.resize((im.width * block, im.height * block), Image.NEAREST)
