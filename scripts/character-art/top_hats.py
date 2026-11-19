"""The two tall stiff hats: the green St. Patrick's Day hat and the
stars-and-stripes Uncle Sam hat, each with the things that sit on the ground
beside the character while it is worn. Drawn in fat pixels.

Both are made the same way (a crown, a band round the foot of it, a brim),
so one small class builds either from a description."""
import math

from PIL import Image


def art(rows, colours, block):
    """A picture from rows of letters, one letter a cell, `.` see-through."""
    width = max(len(r) for r in rows)
    im = Image.new("RGBA", (width * block, len(rows) * block), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                im.paste(colours[ch], (x * block, y * block, (x + 1) * block, (y + 1) * block))
    return im


class TopHat:
    """A stiff hat with a brim. What build.py asks of any hat is here: its
    rows of cells, where the head sits under it, how it is tipped, how to
    draw it, and what to set down beside the character."""

    BRIM_WIDTH = 28
    # The head is as wide as the middle 22 cells of the brim, which stands
    # out 3 cells each side and is the bottom two rows of the hat.
    BAND_LEFT, BAND_WIDTH, BAND_ROWS = 3, 22, 2
    # Tipped back a little: every TIP columns towards the back of the head
    # (the right), the whole hat drops a cell.
    TIP = 9
    # Nothing on it swings, and when the head under it tips over the whole
    # hat is turned as one piece.
    SWING = 0
    STIFF = True
    # What stands beside the character moves by itself, so `prop` is asked
    # for a fresh picture for every frame: prop(block, ms, whole), where `ms`
    # is how far into the animation the frame comes and `whole` its length.
    PROP_MOVES = True

    def __init__(self, rows, colours, prop):
        self.ROWS = rows
        self.WIDTH = self.BRIM_WIDTH
        self.colours = colours
        self.prop = prop

    def drop(self, col):
        """How many cells lower the hat sits at this column than at its
        front. The steps fall clear of the buckle and well in from the
        corner of the top, where a step reads as a pixel sticking up."""
        return max(0, col + 2) // self.TIP

    def draw(self, block, bounce=0, flat=False):
        """The hat, with each cell `block` pixels across. Tipped back in
        steps, or `flat` (level) for a caller that will turn it itself."""
        rows = len(self.ROWS) + (0 if flat else self.drop(self.WIDTH - 1))
        im = Image.new("RGBA", (self.WIDTH * block, rows * block), (0, 0, 0, 0))
        for y, row in enumerate(self.ROWS):
            for x, ch in enumerate(row):
                if ch != ".":
                    px, py = x * block, (y + (0 if flat else self.drop(x))) * block
                    im.paste(self.colours[ch], (px, py, px + block, py + block))
        return im


def _crown(height, top_inset, foot_inset, paint):
    """Rows for a crown `height` cells tall, drawn in from the brim's ends by
    `top_inset` cells at the top and `foot_inset` at the foot. `paint(i, x,
    x0, x1)` gives the letter for row i, column x, between its ends."""
    rows = []
    for i in range(height):
        inset = round(top_inset + (foot_inset - top_inset) * i / (height - 1))
        x0, x1 = inset, TopHat.BRIM_WIDTH - 1 - inset
        row = ["."] * TopHat.BRIM_WIDTH
        for x in range(x0, x1 + 1):
            row[x] = paint(i, x, x0, x1)
        rows.append("".join(row))
    return rows


# --- St. Patrick's Day: a green hat with a black band and a gold buckle -----

_GREEN = {
    "G": (44, 150, 72, 255),     # felt
    "L": (104, 204, 118, 255),   # felt, lit edge
    "D": (28, 104, 54, 255),     # felt, shaded side
    "K": (50, 50, 62, 255),      # band
    "k": (34, 34, 44, 255),      # band in shadow
    "Y": (238, 190, 60, 255),    # buckle
    "y": (255, 232, 130, 255),   # buckle, lit
}
_GREEN_CROWN = 11


def _green_paint(i, x, x0, x1):
    banded = i >= _GREEN_CROWN - 3
    if banded:
        j = i - (_GREEN_CROWN - 3)
        if 11 <= x <= 15:
            if j == 1 and 12 <= x <= 14:
                return "K"
            return "y" if (j == 0 and x <= 12) else "Y"
        return "k" if x >= x1 - 1 else "K"
    if i == 0 and x < x1 - 1:
        return "L"
    if x == x0:
        return "L"
    return "D" if x >= x1 - 1 else "G"


_GREEN_ROWS = _crown(_GREEN_CROWN, 7, 7, _green_paint) + [
    "L" * (TopHat.BRIM_WIDTH - 2) + "DD",
    "." + "G" * (TopHat.BRIM_WIDTH - 4) + "DD" + ".",
]

_CLOVER = [
    "...LGG...",
    "...GGG...",
    "...GGD...",
    "LGG.d.LGG",
    "GGGdddGGG",
    "GGD.s.GGD",
    "....s....",
    "...ss....",
    "...s.....",
]
_CLOVER_DARK = {"G": (40, 140, 66, 255), "L": (96, 196, 110, 255), "D": (26, 96, 50, 255),
                "d": (26, 96, 50, 255), "s": (30, 110, 56, 255)}
_CLOVER_LIGHT = {"G": (86, 184, 92, 255), "L": (150, 226, 140, 255), "D": (50, 136, 70, 255),
                 "d": (50, 136, 70, 255), "s": (40, 124, 62, 255)}


def _lean(picture, block, by):
    """The picture bent over sideways as a stem bends: its foot stays put and
    each row of cells above leans further, the top by `by` pixels."""
    rows = picture.height // block
    out = Image.new("RGBA", picture.size, (0, 0, 0, 0))
    half = max(1, block // 2)
    for r in range(rows):
        up = (rows - 1 - r) / max(1, rows - 1)
        shift = round(by * up ** 1.6 / half) * half
        out.alpha_composite(picture.crop((0, r * block, picture.width, (r + 1) * block)), (0, r * block), (0, 0)) if shift == 0 else \
            out.paste(picture.crop((0, r * block, picture.width, (r + 1) * block)), (shift, r * block))
    return out


def _clovers(block, ms=0, whole=0):
    """A bunch of three clovers standing at different heights: a dark one
    either side and a lighter one between and in front of them, so each
    one's three leaves can be made out. They sway in the wind, each a
    little out of step with the others, and come back to where they began
    at the end of the animation so that it loops without a jump."""
    dark, light = art(_CLOVER, _CLOVER_DARK, block), art(_CLOVER, _CLOVER_LIGHT, block)
    # About one sway a second, and a whole number of them in the loop.
    sways = max(1, round(whole / 1100)) if whole else 0
    turn = 2 * math.pi * sways * ms / whole if whole else 0
    margin = 2
    im = Image.new("RGBA", ((22 + 2 * margin) * block, 13 * block), (0, 0, 0, 0))
    for leaf, palette, x, y, late in ((dark, _CLOVER_DARK, 0, 2, 0.0), (dark, _CLOVER_DARK, 13, 0, 1.3),
                                      (light, _CLOVER_LIGHT, 6, 4, 0.6)):
        # Each stem runs on down to the ground, however tall the clover.
        tall = Image.new("RGBA", ((9 + 2 * margin) * block, im.height - y * block), (0, 0, 0, 0))
        foot = (margin + 3) * block
        tall.paste(palette["s"], (foot, len(_CLOVER) * block, foot + block, tall.height))
        tall.alpha_composite(leaf, (margin * block, 0))
        # The wind blows mostly one way: a lean, and a sway about it.
        by = (0.5 + 1.1 * math.sin(turn - late)) * block if whole else 0
        im.alpha_composite(_lean(tall, block, by), (x * block, y * block))
    return im


stpatrick = TopHat(_GREEN_ROWS, _GREEN, _clovers)


# --- the Fourth of July: Uncle Sam's hat -------------------------------------

_SAM = {
    "R": (206, 44, 52, 255),     # red stripe
    "r": (150, 28, 40, 255),     # red, shaded side
    "W": (246, 244, 238, 255),   # white stripe, brim
    "w": (196, 202, 216, 255),   # white in shadow
    "B": (44, 78, 170, 255),     # blue band
    "b": (30, 54, 124, 255),     # blue in shadow
    "S": (255, 255, 255, 255),   # star
}
_SAM_CROWN = 13


def _sam_paint(i, x, x0, x1):
    shaded = x >= x1 - 1
    if i >= _SAM_CROWN - 4:
        # The band: blue, with a row of white stars along the middle of it.
        j = i - (_SAM_CROWN - 4)
        if j == 1 and not shaded and (x - x0 - 1) % 3 == 0:
            return "S"
        return "b" if shaded else "B"
    red = ((x - x0) // 2) % 2 == 0
    if red:
        return "r" if shaded else "R"
    return "w" if shaded else "W"


_SAM_ROWS = _crown(_SAM_CROWN, 7, 7, _sam_paint) + [
    "W" * (TopHat.BRIM_WIDTH - 2) + "ww",
    "." + "w" * (TopHat.BRIM_WIDTH - 2) + ".",
]

_ROCKET = [
    "..C..",
    ".CCC.",
    "CCCCC",
    ".WWW.",
    ".AAA.",
    ".WWW.",
    ".AAA.",
    ".WWW.",
    ".fff.",
    "..t.Y",
    "..t.o",
    "..t..",
    "..t..",
    "..t..",
    "..t..",
]
_STICK = (150, 110, 70, 255)


def _rocket_colours(cap, stripe):
    return {"C": cap, "A": stripe, "W": (246, 244, 238, 255), "f": (70, 70, 84, 255),
            "t": _STICK, "Y": (255, 226, 96, 255), "o": (250, 150, 40, 255)}


# The spark at the end of each fuse, turn and turn about: which cells
# beside the stick are alight, and how brightly.
_SPARKS = [
    {(4, 9): "Y", (4, 10): "o"},
    {(4, 9): "S", (3, 9): "Y", (4, 8): "o", (4, 10): "Y"},
    {(4, 9): "Y", (4, 8): "Y", (4, 10): "o", (3, 10): "o"},
    {(4, 9): "o", (4, 7): "o", (4, 10): "Y"},
]
_SPARK_COLOURS = {"Y": (255, 226, 96, 255), "o": (250, 150, 40, 255), "S": (255, 255, 240, 255)}


def _fireworks(block, ms=0, whole=0):
    """Three rockets on sticks, planted in the ground at different heights:
    red, white and blue. Each fuse is lit and fizzes, the three of them out
    of step with one another."""
    red, blue = (206, 44, 52, 255), (44, 78, 170, 255)
    bare = [row.replace("Y", ".").replace("o", ".") for row in _ROCKET]
    im = Image.new("RGBA", (17 * block, len(_ROCKET) * block), (0, 0, 0, 0))
    tick = int(ms // 90)
    for k, ((cap, stripe), x, sunk) in enumerate((((red, blue), 0, 3), ((blue, red), 6, 0), ((red, red), 12, 4))):
        rows = bare[: len(bare) - sunk]
        rocket = art(rows, _rocket_colours(cap, stripe), block)
        for (cx, cy), glow in _SPARKS[(tick + 2 * k + (k * tick) // 3) % len(_SPARKS)].items():
            rocket.paste(_SPARK_COLOURS[glow], (cx * block, cy * block, (cx + 1) * block, (cy + 1) * block))
        im.alpha_composite(rocket, (x * block, sunk * block))
    return im


unclesam = TopHat(_SAM_ROWS, _SAM, _fireworks)
