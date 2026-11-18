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


def track(frames, box, reach=36):
    """How far the patch `box` (x0, y0, x1, y1) of the first frame has moved in
    each later frame: a list of (dx, dy). The head is drawn the same from
    frame to frame, so the best match is where the head went."""
    x0, y0, x1, y1 = box

    def grey(f):
        a = np.array(f).astype(np.float32)
        return (a[..., :3].mean(axis=2) + 40) * (a[..., 3] > 127)

    ref = grey(frames[0])[y0:y1, x0:x1]
    out = []
    last = (0, 0)
    for f in frames:
        g = np.pad(grey(f), reach + 8)
        best, at = None, last
        # Look near where the head was a frame ago first; heads do not jump.
        for dy in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                if abs(dy - last[1]) > 8 or abs(dx - last[0]) > 8:
                    continue
                yy, xx = y0 + dy + reach + 8, x0 + dx + reach + 8
                d = np.abs(g[yy:yy + (y1 - y0), xx:xx + (x1 - x0)] - ref).mean()
                if best is None or d < best:
                    best, at = d, (dx, dy)
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
