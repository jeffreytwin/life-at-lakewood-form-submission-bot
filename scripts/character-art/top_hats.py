"""The two tall stiff hats: the green St. Patrick's Day hat and the
stars-and-stripes Uncle Sam hat, each with the things that sit on the ground
beside the character while it is worn. Drawn in fat pixels.

Both are made the same way (a crown, a band round the foot of it, a brim),
so one small class builds either from a description."""
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


def _clovers(block):
    """A bunch of three clovers standing at different heights: a dark one
    either side and a lighter one between and in front of them, so each
    one's three leaves can be made out."""
    dark, light = art(_CLOVER, _CLOVER_DARK, block), art(_CLOVER, _CLOVER_LIGHT, block)
    im = Image.new("RGBA", (22 * block, 13 * block), (0, 0, 0, 0))
    for leaf, palette, x, y in ((dark, _CLOVER_DARK, 0, 2), (dark, _CLOVER_DARK, 13, 0), (light, _CLOVER_LIGHT, 6, 4)):
        # Each stem runs on down to the ground, however tall the clover.
        foot = (x + 3) * block
        im.paste(palette["s"], (foot, (y + len(_CLOVER)) * block, foot + block, im.height))
        im.alpha_composite(leaf, (x * block, y * block))
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


def _fireworks(block):
    """Three rockets on sticks, planted in the ground at different heights:
    red, white and blue, each with a lit fuse."""
    red, blue = (206, 44, 52, 255), (44, 78, 170, 255)
    im = Image.new("RGBA", (17 * block, len(_ROCKET) * block), (0, 0, 0, 0))
    for (cap, stripe), x, sunk in (((red, blue), 0, 3), ((blue, red), 6, 0), ((red, red), 12, 4)):
        rows = _ROCKET[: len(_ROCKET) - sunk]
        rocket = art(rows, _rocket_colours(cap, stripe), block)
        im.alpha_composite(rocket, (x * block, sunk * block))
    return im


unclesam = TopHat(_SAM_ROWS, _SAM, _fireworks)
