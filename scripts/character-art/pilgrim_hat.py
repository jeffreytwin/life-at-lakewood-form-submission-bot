"""The pilgrim hat: a tall dark crown with a flat top, a wide flat brim, and
a brown band with a gold buckle. Drawn in fat pixels."""
from PIL import Image

COLOURS = {
    # The felt is charcoal, not black, with a lit edge, so the hat still
    # shows against the dashboard's dark background.
    "K": (54, 52, 64, 255),      # felt
    "H": (104, 102, 122, 255),   # felt, lit edge
    "D": (30, 28, 36, 255),      # felt, shaded side
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
# A stiff hat: nothing on it swings.
SWING = 0


def drop(col):
    """How many cells lower the hat sits at this column than at its front.
    The steps are placed to fall clear of the buckle and well in from the
    corner of the flat top; a step a single cell in from the corner reads as
    a pixel sticking up."""
    return max(0, col + 2) // TIP


def draw(block, bounce=0):
    """The hat, tipped back, with each cell `block` pixels across."""
    rows = len(ROWS) + drop(WIDTH - 1)
    im = Image.new("RGBA", (WIDTH * block, rows * block), (0, 0, 0, 0))
    for y, row in enumerate(ROWS):
        for x, ch in enumerate(row):
            if ch != ".":
                px, py = x * block, (y + drop(x)) * block
                im.paste(COLOURS[ch], (px, py, px + block, py + block))
    return im
