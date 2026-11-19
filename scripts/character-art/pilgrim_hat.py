"""The pilgrim hat: a tall dark crown with a flat top, a wide flat brim, and
a brown band with a gold buckle. Drawn in fat pixels."""
from PIL import Image

COLOURS = {
    # The felt is a slate grey, not black. The dashboard behind it is very
    # nearly black, so anything darker than this (the shaded side most of
    # all) melts into it and the hat looks as if a piece is missing.
    "K": (74, 72, 90, 255),      # felt
    "H": (128, 126, 150, 255),   # felt, lit edge
    "D": (52, 50, 66, 255),      # felt, shaded side
    "B": (122, 78, 44, 255),     # band
    "b": (88, 54, 32, 255),      # band in shadow
    "G": (238, 190, 60, 255),    # buckle
    "Y": (255, 232, 130, 255),   # buckle, lit
}

CROWN_ROWS = 11
BRIM_WIDTH = 28


def _rows():
    rows = []
    for i in range(CROWN_ROWS):
        # The crown widens a little from its flat top down to the brim.
        inset = 8 - round(i * 3 / (CROWN_ROWS - 1))
        x0, x1 = inset, BRIM_WIDTH - 1 - inset
        row = ["."] * BRIM_WIDTH
        banded = i >= CROWN_ROWS - 3
        for x in range(x0, x1 + 1):
            row[x] = "B" if banded else "K"
        row[x0] = "B" if banded else "H"
        for x in (x1 - 1, x1):
            row[x] = "b" if banded else "D"
        if i == 0:
            for x in range(x0, x1 - 1):
                row[x] = "H"
        if banded:
            # The buckle: a gold square with the band showing through it.
            j = i - (CROWN_ROWS - 3)
            for x in range(11, 16):
                row[x] = "G"
            if j == 1:
                row[12] = row[13] = row[14] = "B"
            if j == 0:
                row[11] = row[12] = "Y"
        rows.append("".join(row))
    rows.append("H" * (BRIM_WIDTH - 2) + "DD")
    rows.append("." + "K" * (BRIM_WIDTH - 4) + "DD" + ".")
    return rows


ROWS = _rows()
WIDTH = BRIM_WIDTH
# The part that sits on the head: the brim, the bottom two rows. The head is
# as wide as the middle 22 cells of it; the brim stands out 3 cells each side.
BAND_LEFT, BAND_WIDTH, BAND_ROWS = 3, 22, 2
# The hat sits tipped back a little: every TIP columns towards the back of
# the head (the right), the whole hat drops a cell.
TIP = 9
# A stiff hat: nothing on it swings, and when the head under it tips over
# the whole hat is turned as one piece.
SWING = 0
STIFF = True

# --- the pumpkins that sit beside the character in November -----------------

_PROP = {
    "O": (240, 140, 40, 255),    # pumpkin
    "o": (206, 102, 28, 255),    # its ribs
    "D": (150, 68, 24, 255),     # in shadow
    "L": (255, 184, 88, 255),    # lit
    "G": (88, 120, 52, 255),     # stem
    "g": (60, 84, 40, 255),
}
# The small pumpkin is a paler, yellower one with a dark edge where it stands
# against the big one, so it reads as a second pumpkin and not as a bulge on
# the first.
_PALE = {
    "O": (250, 200, 84, 255),
    "o": (224, 160, 52, 255),
    "D": (120, 62, 24, 255),
    "L": (255, 232, 150, 255),
    "G": (88, 120, 52, 255),
    "g": (60, 84, 40, 255),
}
_BIG = [
    "......Gg.....",
    ".....Gg......",
    ".....Gg......",
    "..LOOoOOoOO..",
    ".LOOoOOOOoOO.",
    "LOOOoOOOOoOOD",
    "LOOOoOOOOoOOD",
    "OOOOoOOOOoOOD",
    "OOOOoOOOOoOOD",
    ".OOOoOOOOoOD.",
    "..DDDDDDDDD..",
]
_SMALL = [
    "....Gg....",
    "...Gg.....",
    "..LOOoOO..",
    ".LOOoOOoOD",
    "LOOOoOOoOD",
    "LOOOoOOoOD",
    "OOOOoOOoOD",
    ".OOOoOOoD.",
    "..DDDDDD..",
]


def _art(rows, colours, block):
    im = Image.new("RGBA", (len(rows[0]) * block, len(rows) * block), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                im.paste(colours[ch], (x * block, y * block, (x + 1) * block, (y + 1) * block))
    return im


def prop(block):
    """Two pumpkins: a big orange one, and a small pale one set down in front
    of it and well to the side, so that both can be seen for what they are."""
    big, small = _art(_BIG, _PROP, block), _art(_SMALL, _PALE, block)
    aside = 7 * block
    im = Image.new("RGBA", (big.width + aside, big.height), (0, 0, 0, 0))
    im.alpha_composite(big, (aside, 0))
    im.alpha_composite(small, (0, big.height - small.height))
    return im


def drop(col):
    """How many cells lower the hat sits at this column than at its front.
    The steps are placed to fall clear of the buckle and well in from the
    corner of the flat top; a step a single cell in from the corner reads as
    a pixel sticking up."""
    return max(0, col + 2) // TIP


def draw(block, bounce=0, flat=False):
    """The hat, with each cell `block` pixels across. Tipped back in steps,
    or `flat` (level, no steps) for a caller that will turn it itself."""
    rows = len(ROWS) + (0 if flat else drop(WIDTH - 1))
    im = Image.new("RGBA", (WIDTH * block, rows * block), (0, 0, 0, 0))
    for y, row in enumerate(ROWS):
        for x, ch in enumerate(row):
            if ch != ".":
                px, py = x * block, (y + (0 if flat else drop(x))) * block
                im.paste(COLOURS[ch], (px, py, px + block, py + block))
    return im
