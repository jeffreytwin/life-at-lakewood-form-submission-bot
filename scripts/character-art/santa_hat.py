"""The Santa hat, drawn by hand in fat pixels."""
from lib import from_rows

COLOURS = {
    "R": (200, 32, 40, 255),     # red
    "L": (234, 76, 70, 255),     # red, lit side
    "D": (140, 20, 34, 255),     # red, shaded side
    "W": (248, 246, 240, 255),   # fur
    "S": (198, 204, 216, 255),   # fur in shadow
}

# The tail flops over to the right and ends in the bobble. The fur band is
# the bottom four rows, 20 cells wide, starting at column 0.
ROWS = [
    ".........LRRRRDD..........",
    ".......LLRRRRRRRDD........",
    "......LLRRRRRRRRRRDD......",
    ".....LLRRRRRRRRRRRRRDD....",
    "....LLRRRRRRRRRRRRRRRRD...",
    "...LLRRRRRRRRRRRRRDLRRRD..",
    "...LRRRRRRRRRRRRRRD.LRRD..",
    "..LLRRRRRRRRRRRRRRD..WWWW.",
    "..LRRRRRRRRRRRRRRRD.WWWWWW",
    ".LLRRRRRRRRRRRRRRRD.SWWWWW",
    ".LLRRRRRRRRRRRRRRRD.SSWWWW",
    "WWWWWWWWWWWWWWWWWWWW.SSSS.",
    "SWWWWWWWWWWWWWWWWWWW......",
    "SWWWWWWWWWWWWWWWWWWW......",
    ".SSSSSSSSSSSSSSSSSS.......",
]
BAND_LEFT, BAND_WIDTH, BAND_ROWS = 0, 20, 4


def santa_hat(block):
    """The hat with each cell `block` pixels across."""
    return from_rows(ROWS, COLOURS, block)
