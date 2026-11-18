"""The Santa hat, drawn by hand in fat pixels."""
from PIL import Image

COLOURS = {
    "R": (200, 32, 40, 255),     # red
    "L": (234, 76, 70, 255),     # red, lit side
    "D": (140, 20, 34, 255),     # red, shaded side
    "W": (248, 246, 240, 255),   # fur
    "S": (198, 204, 216, 255),   # fur in shadow
}

# The crown stands over the fur band; its tail droops over to the right and
# ends in the bobble. The fur band is the bottom four rows, 22 cells wide,
# starting at column 0. Short rows are see-through to the right.
ROWS = [
    "..........LRRRRRRDD",
    "........LLRRRRRRRRRDDD",
    "......LLRRRRRRRRRRRRRRDDD",
    ".....LLRRRRRRRRRRRRRRRRRRDD",
    "....LLRRRRRRRRRRRRRRRRRRRRRDD",
    "...LLRRRRRRRRRRRRRRRDDLRRRRRDD",
    "...LRRRRRRRRRRRRRRRRRD..LRRRRD",
    "..LLRRRRRRRRRRRRRRRRRD...LRRRD",
    "..LRRRRRRRRRRRRRRRRRRD...WWWWW",
    ".LLRRRRRRRRRRRRRRRRRRD..WWWWWWW",
    ".LLRRRRRRRRRRRRRRRRRRD..WWWWWWW",
    ".LRRRRRRRRRRRRRRRRRRRD..SWWWWWW",
    "WWWWWWWWWWWWWWWWWWWWWW..SSWWWWW",
    "SWWWWWWWWWWWWWWWWWWWWW...SSSSS",
    "SWWWWWWWWWWWWWWWWWWWWW",
    ".SSSSSSSSSSSSSSSSSSSS",
]
WIDTH = max(len(r) for r in ROWS)
BAND_LEFT, BAND_WIDTH, BAND_ROWS = 0, 22, 4
# The hat sits tipped back: every TIP columns towards the back of the head
# (the right), the whole hat drops a cell.
TIP = 6
# The droop is everything right of this column. It is the part that bounces.
DROOP_FROM = 21
# How far the bobble may swing either way, in cells.
SWING = 2


def drop(col):
    """How many cells lower the hat sits at this column than at its front."""
    return max(0, col) // TIP


def santa_hat(block, bounce=0):
    """The hat, tipped back, with each cell `block` pixels across. `bounce` is
    how far the bobble has swung down (up, if negative) in pixels; the tail
    bends with it, most at the bobble and not at all where it leaves the crown.

    The picture has SWING cells of spare room above and below the hat, so it
    is the same size however far the bobble has swung."""
    bounce = max(-SWING * block, min(SWING * block, bounce))
    rows = len(ROWS) + drop(WIDTH - 1) + 2 * SWING
    im = Image.new("RGBA", (WIDTH * block, rows * block), (0, 0, 0, 0))
    half = max(1, block // 2)
    for x in range(WIDTH):
        bend = 0
        if x > DROOP_FROM:
            share = (x - DROOP_FROM) / (WIDTH - 1 - DROOP_FROM)
            bend = round(bounce * share / half) * half
        for y, row in enumerate(ROWS):
            if x < len(row) and row[x] != ".":
                px, py = x * block, (y + drop(x) + SWING) * block + bend
                im.paste(COLOURS[row[x]], (px, py, px + block, py + block))
    return im
