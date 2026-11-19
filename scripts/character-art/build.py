"""Builds the character animations that are drawn by this script rather than
by hand: each character's own cardboard-box animations, and the holiday
versions of the standing and box animations.

    python3 scripts/character-art/build.py

Reads the everyday GIFs in public/ and writes public/characters/<id>/...
Run it again after changing a hat, the box, or a standing animation."""
import json
import math
import os
import sys
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from lib import read_gif, write_gif, track, track_eyes, from_rows  # noqa: E402
import santa_hat as santa  # noqa: E402
import pilgrim_hat as pilgrim  # noqa: E402
import top_hats  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUBLIC = os.path.join(ROOT, "public")

# What the script has to be told about each animation, measured on its first
# frame: the size one hat pixel should be drawn at (`block`), the patch of
# face it follows from frame to frame, and where a hat band sits (`band_bottom`
# is its lower edge at the forehead, `head_x` its middle). `turns` is for an
# animation where the head tips over as well as moving; `lean` is a head that
# starts out tipped, in degrees anticlockwise. `eyes` follows the head by its
# blue eyes instead of by the patch of face. `tuck` is how many cells further
# than the band, left and right, hair is tucked under the hat. `stray` clears a tuft
# of brown hair that hangs out under the back of the band. `front` is the run of frames
# (first, last) in which something is held up beside the head (a pistol in
# each hand) and has to stay in front of the hat. `prop_x` says where the
# middle of the head would be for setting the pumpkins or presents down, for a
# pose with no room for them in the usual place. `head_w` sizes the box.
CHARACTERS = {
    "snake": dict(
        head_w=118,
        standing=dict(file="standing-there.gif", block=6, face=(40, 110, 150, 185),
                      band_bottom=112, head_x=97),
        celebrating=dict(file="celebration.gif", block=8, face=(50, 130, 195, 225),
                         band_bottom=130, head_x=126, turns=True),
        sneaking=dict(file="sneaking.gif", block=14, face=(75, 170, 335, 300),
                      band_bottom=166, head_x=211),
    ),
    "ocelot": dict(
        head_w=165,
        standing=dict(file="Revolver Ocelot - Standing V2.gif", block=8, face=(110, 160, 240, 250),
                      band_bottom=160, head_x=182),
        celebrating=dict(file="Revolver Ocelot - Celebration.gif", block=8, face=(110, 160, 240, 250),
                         band_bottom=160, head_x=182, turns=True, front=(20, 59)),
        sneaking=dict(file="Revolver Ocelot - Crawling.gif", block=8, face=(58, 262, 185, 350),
                      band_bottom=262, head_x=127),
    ),
    "liquid": dict(
        head_w=160,
        standing=dict(file="Liquid Snake - Standing.gif", block=8, face=(105, 160, 235, 250),
                      band_bottom=162, head_x=174),
        celebrating=dict(file="Liquid Snake - Celebration.gif", block=8, face=(105, 160, 235, 250),
                         band_bottom=162, head_x=174, eyes=True),
        sneaking=dict(file="Liquid Snake - Crawling.gif", block=7, face=(95, 250, 205, 325),
                      band_bottom=252, head_x=155, lean=10),
    ),
    "bigboss": dict(
        head_w=165,
        standing=dict(file="Big Boss - Standing V3.gif", block=8, face=(85, 175, 235, 255),
                      band_bottom=144, head_x=158, tuck=(2, 9), stray=True),
        celebrating=dict(file="Big Boss - Celebration.gif", block=8, face=(85, 170, 235, 250),
                         band_bottom=140, head_x=160, turns=True, tuck=(2, 9), stray=True),
        sneaking=dict(file="Big Boss - Crawling.gif", block=8, face=(60, 205, 225, 290),
                      band_bottom=207, head_x=139, tuck=(2, 9), stray=True),
    ),
}

def _brown(r, g, b):
    # Down to the near-black outline the hair is drawn with, which is still
    # a little redder than it is blue; a navy or grey bandana never is.
    brown = (r > 28) & (r < 135) & (r - b > 6) & (r >= g)
    # And the outline itself where it is all but black, so long as it is not
    # bluish, which the darkest folds of a bandana are.
    outline = (np.maximum(np.maximum(r, g), b) < 46) & (r >= b - 2)
    return brown | outline


def _grey(r, g, b):
    return (r > 125) & (r < 215) & (abs(r - b) < 40)


def _blond(r, g, b):
    # Skin is close to blond, but redder: more red over green than hair has.
    return (r > 180) & (r - g < 40) & (g - b > 40)


# What colour each character's hair is, so that stray locks of it can be
# told from a bandana, a pistol or a hand.
HAIR = {"snake": _brown, "bigboss": _brown, "ocelot": _grey, "liquid": _blond}

HATS = {"santa": santa, "pilgrim": pilgrim, "stpatrick": top_hats.stpatrick, "unclesam": top_hats.unclesam}

SHADOW = (86, 86, 98, 255)


# --- hats -------------------------------------------------------------------

def swing(heights, durations, block):
    """How far the hat's bobble hangs off its resting place in each frame, in
    pixels, down being positive. The bobble trails the head: it catches up
    with where the head has gone a moment late, so it lifts as the head dips
    and flops as the head comes back up."""
    lag = 140.0  # ms for the bobble to catch most of the way up
    at = float(heights[0])
    out = [0.0] * len(heights)
    # Round the loop a few times, so the last frame leads into the first.
    for _ in range(4):
        for i, (y, ms) in enumerate(zip(heights, durations)):
            at += (y - at) * (1 - 2.718281828 ** (-ms / lag))
            out[i] = at - y
    reach = max(abs(v) for v in out) or 1.0
    # However gently a character moves, the bobble swings a good cell and a half.
    return [v / reach * 1.5 * block for v in out]


def _crowd(solid, reach=6):
    """For every pixel, how many solid pixels lie within `reach` of it."""
    total = np.pad(solid.astype(np.int32), reach + 1).cumsum(0).cumsum(1)
    h, w = solid.shape
    k = 2 * reach + 1
    return (total[k:k + h, k:k + w] - total[:h, k:k + w] - total[k:k + h, :w] + total[:h, :w])


# Spare canvas above and beside the frame while the hat is drawn; trimmed off
# afterwards down to whatever the hat actually needed.
ROOM = 320
SIDE = 160
FOLLOWED = {}


def wear(frames, durations, c, hat):
    """The frames with the hat on, and how much taller they came out than they
    went in (1 for no taller). The hat follows the face, tips over with it,
    its bobble bounces as the head moves, and whatever hair stood above the
    band is tucked away under it.

    Where the hat would poke out of the picture, the picture grows to hold
    it: upwards, and by the same amount on both sides so the character stays
    in the middle. The page shows every animation as tall as its box allows,
    so a picture may grow sideways only while it stays narrower than tall."""
    b = c["block"]
    rows = len(hat.ROWS)
    W, H = frames[0].size
    left = round(c["head_x"] - (hat.BAND_LEFT + hat.BAND_WIDTH / 2) * b) + SIDE
    top = c["band_bottom"] - rows * b + ROOM
    # Where the head goes is the same whatever hat is on it: follow it once.
    if c["file"] not in FOLLOWED:
        if c.get("eyes"):
            FOLLOWED[c["file"]] = track_eyes(frames)
        else:
            fx0, fy0, fx1, fy1 = c["face"]
            FOLLOWED[c["file"]] = (track(frames, c["face"], turns=c.get("turns", False)),
                                   ((fx0 + fx1) / 2, (fy0 + fy1) / 2))
    moves, (cx, cy) = FOLLOWED[c["file"]]
    cx, cy = cx + SIDE, cy + ROOM
    bounces = swing([dy for _, dy, _ in moves], durations, b)
    size = (W + 2 * SIDE, H + ROOM)
    # Under the hat: the stretch above the band, as wide as the band (and a
    # little wider for a head of hair that sticks out), up to the top of the
    # crown. Hands and whatever else is beside the head stay.
    more_left, more_right = c.get("tuck", (0, 0))
    tuck = Image.new("L", size, 0)
    for col in range(-more_left, hat.BAND_WIDTH + more_right):
        x = left + (hat.BAND_LEFT + col) * b
        y = top + (rows - hat.BAND_ROWS + 1 + hat.drop(hat.BAND_LEFT + min(col, hat.BAND_WIDTH - 1))) * b
        tuck.paste(255, (x, top - b, x + b, y))
    # Just under the back of the band, where a tuft of hair can hang out.
    # Only hair-coloured pixels are taken from here, never the bandana.
    stray = Image.new("L", size, 0)
    if c.get("stray"):
        # Only past the very back of the band: any nearer the face and it
        # would take the sideburn with it.
        for col in range(hat.BAND_WIDTH - 1, hat.BAND_WIDTH + 9):
            x = left + (hat.BAND_LEFT + col) * b
            y = top + (rows - hat.BAND_ROWS + hat.drop(hat.BAND_LEFT + hat.BAND_WIDTH - 1)) * b
            stray.paste(255, (x, y, x + b, y + (hat.BAND_ROWS + 4) * b))
    # Around the hat: from a few cells left of the band to past the hat's
    # right-hand end, and from the top of the picture down to just short of
    # the band's lower edge. Hair that pokes out here is cleared, by colour,
    # so that whatever else is here (a bandana, a hand) is left alone.
    around = Image.new("L", size, 0)
    for col in range(hat.BAND_LEFT - 4, max(hat.WIDTH, hat.BAND_LEFT + hat.BAND_WIDTH) + 2):
        x = left + col * b
        within = min(max(col, hat.BAND_LEFT), hat.BAND_LEFT + hat.BAND_WIDTH - 1)
        # In front of the band the hair is cleared a cell lower still: a
        # lock hanging out under the front of a hat reads as a stray pixel.
        y = top + (rows + (1 if col < hat.BAND_LEFT else -1) + hat.drop(within)) * b
        around.paste(255, (x, -ROOM, x + b, y))
    # The head and everything under it: a strip as wide as the band, all the
    # way down. What stands outside it is beside the head, not part of it.
    strip = Image.new("L", size, 0)
    strip.paste(255, (left - b, 0, left + (hat.BAND_WIDTH + 1) * b, size[1]))
    # A stiff hat on a head that tips over is drawn level and turned whole,
    # which keeps its straight edges straight.
    stiff = getattr(hat, "STIFF", False) and (c.get("turns") or c.get("eyes"))
    tilt = math.degrees(math.atan(1 / hat.TIP))
    tilt_cos, tilt_sin = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
    out = []
    for f, (dx, dy, ang), bounce in zip(frames, moves, bounces):
        big = Image.new("RGBA", size, (0, 0, 0, 0))
        big.paste(f, (SIDE, ROOM))
        turn = ang + c.get("lean", 0)
        at = (cx + dx, cy + dy)
        layer = Image.new("RGBA", size, (0, 0, 0, 0))
        if stiff:
            # Level art, turned once by the head's tip and the hat's own tilt
            # together, about the head. Two turns one after the other would
            # roughen the edges twice; `shift` stands in for the first.
            px, py = left + hat.BAND_LEFT * b + dx - at[0], top + rows * b + dy - at[1]
            shift = (px * tilt_cos + py * tilt_sin - px, -px * tilt_sin + py * tilt_cos - py)
            layer.paste(hat.draw(b, bounce, flat=True), (left + dx + round(shift[0]), top + dy + round(shift[1])))
        else:
            layer.paste(hat.draw(b, bounce), (left + dx, top + dy - hat.SWING * b))
        hide = Image.new("L", size, 0)
        hide.paste(tuck, (dx, dy))
        head = Image.new("L", size, 0)
        head.paste(strip, (dx, 0))
        if stiff:
            layer = layer.rotate(turn - tilt, resample=Image.NEAREST, center=at)
        elif turn:
            layer = layer.rotate(turn, resample=Image.NEAREST, center=at)
        if turn:
            hide = hide.rotate(turn, resample=Image.NEAREST, center=at)
            head = head.rotate(turn, resample=Image.NEAREST, center=at)
        bare = big.copy()
        big.paste((0, 0, 0, 0), (0, 0), hide)
        zone = Image.new("L", size, 0)
        zone.paste(around, (dx, dy))
        if turn:
            zone = zone.rotate(turn, resample=Image.NEAREST, center=at)
        px = np.array(big).astype(np.int32)
        locks = c["hair"](px[..., 0], px[..., 1], px[..., 2]) & (np.array(zone) > 0)
        big.paste((0, 0, 0, 0), (0, 0), Image.fromarray((locks * 255).astype(np.uint8), "L"))
        if c.get("stray"):
            zone = Image.new("L", size, 0)
            zone.paste(stray, (dx, dy))
            if turn:
                zone = zone.rotate(turn, resample=Image.NEAREST, center=at)
            r, g, bl, _ = big.split()
            # Brown: clearly more red than blue, and not bright (not skin).
            brown = ImageChops.subtract(r, bl).point(lambda v: 255 if v > 20 else 0)
            dim = r.point(lambda v: 255 if v < 150 else 0)
            big.paste((0, 0, 0, 0), (0, 0), ImageChops.multiply(zone, ImageChops.multiply(brown, dim)))
        big.alpha_composite(layer)
        first, last = c.get("front", (1, 0))
        if first <= len(out) <= last:
            # Put back whatever the hat covered that is not the head: anything
            # beside it, and anything dark over it. The hair up there is light
            # and a pistol is mostly dark, so dark means held in front. Lone
            # dark specks are hair in shadow and are left alone; the pistol's
            # bright glints come back with the dark around them.
            alpha = bare.getchannel("A")
            dark = bare.convert("L").point(lambda v: 255 if v < 110 else 0)
            dark = ImageChops.multiply(dark, alpha).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(9))
            keep = ImageChops.lighter(dark, Image.eval(head, lambda v: 255 - v))
            big.paste(bare, (0, 0), ImageChops.multiply(keep, alpha))
        # Clearing hair and laying a hat over the rest can leave a crumb or two
        # cut off from everything else. A crumb has little around it now but
        # sat in the thick of something before the hat went on; a spark, a
        # wisp of smoke or the tip of a bandana was always thin, and stays.
        now = _crowd(np.array(big.getchannel("A")) > 127)
        was = _crowd(np.array(bare.getchannel("A")) > 127)
        crumbs = (np.array(big.getchannel("A")) > 127) & (now < 30) & (was > 70)
        if crumbs.any():
            big.paste((0, 0, 0, 0), (0, 0), Image.fromarray((crumbs * 255).astype(np.uint8), "L"))
        out.append(big)
    boxes = [f.getchannel("A").getbbox() for f in out]
    need = min(bb[1] for bb in boxes)
    cut = min(ROOM, need - need % 2)
    tall = H + ROOM - cut
    over = max(0, SIDE - min(bb[0] for bb in boxes), max(bb[2] for bb in boxes) - (SIDE + W))
    wider = min(SIDE, over + over % 2, max(0, (H - W) // 2))
    out = [f.crop((SIDE - wider, cut, SIDE + W + wider, H + ROOM)) for f in out]
    return out, tall / H, wider


def spread(frames, times, least=900, step=None):
    """The same animation with more frames to it, for things beside the
    character that move on their own (clovers in the wind, a fizzing fuse)
    and need frames to move in. A loop shorter than `least` ms is played
    through more than once; with `step`, a frame held longer than that is
    split into several shorter ones. Returns (frames, times)."""
    times = [times] * len(frames) if isinstance(times, int) else list(times)
    if step:
        split = [(f, t / n) for f, t in zip(frames, times) for n in [max(1, round(t / step))] for _ in range(n)]
        frames, times = [f for f, _ in split], [round(t / 10) * 10 for _, t in split]
    again = max(1, -(-least // sum(times)))
    return frames * again, times * again


def beside(frames, hat, block, head_x, height, times=None):
    """The frames with the hat's holiday things (pumpkins, presents, clovers,
    fireworks) set down on the ground beside the character, on the side they
    face, and how far the picture grew to the left to hold them. `height` is
    how tall the everyday picture is: the page shows each animation as tall
    as its box allows, so the picture may only widen while it stays narrower
    than that. Things that move are drawn afresh for every frame, by how far
    through the animation (`times`, each frame's ms) that frame comes."""
    moving = getattr(hat, "PROP_MOVES", False)
    art = hat.prop(block)
    W, H = frames[0].size
    ground = frames[0].getchannel("A").getbbox()[3]
    right = round(head_x - (hat.BAND_WIDTH / 2 + 2) * block)
    x = right - art.width
    need = max(0, -x)
    wider = min(need + need % 2, max(0, (height - W) // 2))
    times = [times] * len(frames) if isinstance(times, int) else times
    whole = sum(times) if moving else 0
    at = 0
    out = []
    for i, f in enumerate(frames):
        if moving:
            art = hat.prop(block, at, whole)
            at += times[i]
        big = Image.new("RGBA", (W + 2 * wider, H), (0, 0, 0, 0))
        big.paste(f, (wider, 0))
        big.alpha_composite(art, (max(0, x + wider), ground - art.height))
        out.append(big)
    return out, wider


# --- the box ----------------------------------------------------------------

BOX = {
    "lid": (178, 140, 116, 255), "lid_dark": (150, 114, 96, 255),
    "edge": (242, 218, 156, 255), "body": (214, 186, 148, 255),
    "lit": (228, 204, 168, 255), "shade": (188, 160, 126, 255),
    "band": (172, 148, 122, 255), "foot": (140, 118, 98, 255),
    "tape": (232, 214, 178, 255), "slot": (58, 42, 38, 255),
    "mark": (176, 150, 120, 255), "eye": (250, 250, 250, 255),
}


def box_art(w, h, block, eyes=None, squash=0):
    """The box, `w` by `h` cells. `eyes` is None for nobody looking out, or
    how far the eyes in the hand slot have slid (-1, 0, 1); "shut" for a blink."""
    h -= squash
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w - 1, h - 1], fill=BOX["body"])
    d.rectangle([0, 0, w - 1, 2], fill=BOX["lid"])
    d.line([(0, 1), (w - 1, 1)], fill=BOX["lid_dark"])
    d.line([(0, 3), (w - 1, 3)], fill=BOX["edge"])
    d.line([(0, 4), (0, h - 2)], fill=BOX["lit"])
    d.rectangle([w - 2, 4, w - 1, h - 2], fill=BOX["shade"])
    d.rectangle([0, h - 5, w - 1, h - 4], fill=BOX["band"])
    d.line([(0, h - 1), (w - 1, h - 1)], fill=BOX["foot"])
    # Packing tape down the middle of the lid and a little way down the front.
    t0 = w // 2 - 1
    d.rectangle([t0, 0, t0 + 2, min(7, h - 6)], fill=BOX["tape"])
    # The hand slot, and the two printed marks the old box had.
    sx, sy = w - 9, 6
    if h > 12:
        d.rectangle([sx, sy, sx + 5, sy + 1], fill=BOX["slot"])
        if eyes is not None and eyes != "shut":
            d.point((sx + 1 + eyes, sy), fill=BOX["eye"])
            d.point((sx + 4 + eyes, sy), fill=BOX["eye"])
        for mx in (2, 5):
            d.rectangle([mx, h - 9, mx + 1, h - 8], outline=BOX["mark"])
    for x, y in ((0, 0), (w - 1, 0)):
        im.putpixel((x, y), (0, 0, 0, 0))
    return im.resize((w * block, h * block), Image.NEAREST)


BANG = from_rows(
    ["WWWWW", "WRRRW", "WRRRW", "WRRRW", "WRRW.", "WRRW.", "WWWW.", "WRRW.", "WWWW."],
    {"W": (255, 255, 255, 255), "R": (214, 30, 40, 255)}, 1)


def box_scenes(standing, c, hat=None, bare=None):
    """The three box animations for one character: climbing in, sitting in it,
    and climbing out. `standing` is the standing animation to start from
    (already wearing the hat, in a hat month)."""
    b = c["block"]
    W, H = standing[0].size
    first = standing[0]
    x0, y0, x1, y1 = first.getchannel("A").getbbox()
    ground = y1 - b  # the feet stand a little inside the drawn shadow
    # The box is sized to the character, not to whatever hat is on top.
    tall = ground - (bare or first).getchannel("A").getbbox()[1]
    bw = max(16, round(c["head_w"] * 1.36 / b))
    bh = round(tall * 0.62 / b)
    left = round(c["head_x"] - bw * b / 2)
    small = max(3, round(b * 0.6))
    hat_art = hat.draw(small) if hat else None

    def shadow(f):
        d = ImageDraw.Draw(f)
        d.rectangle([left - b, y1 - 2 * b, left + bw * b + b - 1, y1 - 1], fill=SHADOW)
        d.rectangle([left, y1 - 3 * b, left + bw * b - 1, y1 + b - 1], fill=SHADOW)

    def crouch(src, amount):
        """The character pressed down towards the ground: 1 is standing tall."""
        if amount >= 0.999:
            return src
        f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        part = src.crop((0, 0, W, y1))
        nh = max(1, round(y1 * amount))
        f.alpha_composite(part.resize((W, nh), Image.NEAREST), (0, y1 - nh))
        return f

    def scene(person=None, lift=None, eyes=None, squash=0, bang=None):
        """One frame. `person` is a character frame or None; `lift` is how far
        (in pixels) the box hangs above the ground, None for no box."""
        f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        if lift is not None and lift < tall * 0.5:
            shadow(f)
        if person is not None:
            if lift is not None and lift < tall * 0.5:
                # Nearly inside: nothing of them shows past the box's sides.
                keep = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                keep.paste(person.crop((left, 0, left + bw * b, H)), (left, 0))
                person = keep
            f.alpha_composite(person)
        top = None
        if lift is not None:
            art = box_art(bw, bh, b, eyes, squash)
            top = round(ground + b - art.height - lift)
            f.alpha_composite(art, (left, top)) if top + art.height > 0 else None
            if hat_art is not None:
                hx, hy = left + b, top - (len(hat.ROWS) + hat.SWING) * small + small
                if hy + hat_art.height > 0:
                    f.alpha_composite(hat_art, (hx, hy))
        if bang is not None:
            art = BANG.resize((BANG.width * b, BANG.height * b), Image.NEAREST)
            at = (round(c["head_x"] - art.width / 2), bang - art.height - b)
            if at[1] < 0:
                # No room overhead (a tall hat): the mark goes beside the head.
                at = (max(0, round(c["head_x"] - c["head_w"] / 2 - b - art.width)), max(0, bang))
            f.alpha_composite(art, at)
        return f

    n = len(standing)
    s = lambda i: standing[i % n]  # noqa: E731
    box_top = ground + b - bh * b
    hat_room = (len(hat.ROWS) - 1) * small if hat else 0

    get_in = [
        scene(s(0)), scene(s(1)),
        scene(s(2), bang=y0),
        scene(crouch(s(2), 0.88), lift=tall * 0.80),
        scene(crouch(s(2), 0.74), lift=tall * 0.42),
        scene(crouch(s(2), 0.62), lift=tall * 0.14),
        scene(lift=0, squash=1),
        scene(crouch(s(2), 0.62), lift=b * 2),
        scene(lift=0),
        scene(lift=0),
        scene(lift=0, eyes=0),
    ]
    in_box = [
        (scene(lift=0, eyes=0), 1600), (scene(lift=0, eyes="shut"), 120),
        (scene(lift=0, eyes=0), 900), (scene(lift=0, eyes=-1), 600),
        (scene(lift=0, eyes=1), 600), (scene(lift=0, eyes=0), 700),
        (scene(crouch(s(0), 0.62), lift=b * 2, eyes=0), 140), (scene(lift=0, eyes=0), 1100),
        (scene(lift=0, eyes="shut"), 120),
    ]
    get_out = [
        scene(lift=0, eyes=0),
        scene(lift=0, eyes=0, bang=box_top - hat_room),
        scene(crouch(s(0), 0.62), lift=b * 2, bang=box_top - hat_room - b * 2),
        scene(crouch(s(0), 0.66), lift=tall * 0.22),
        scene(crouch(s(0), 0.80), lift=tall * 0.55),
        scene(crouch(s(0), 0.92), lift=tall * 0.95),
        scene(s(0), lift=tall * 1.5),
        scene(s(0)), scene(s(1)), scene(s(2)), scene(s(3)),
    ]
    return get_in, in_box, get_out


POSES = {"standing": "standing", "celebrating": "celebrating", "sneaking": "sneaking"}


def main():
    # How much taller than its everyday version each hatted animation is, so
    # the page can give it the extra room and keep the character the same size.
    taller = {}
    for cid, c in CHARACTERS.items():
        plain, durations = read_gif(os.path.join(PUBLIC, c["standing"]["file"]))
        for name, hat in [(None, None)] + list(HATS.items()):
            out = os.path.join(PUBLIC, "characters", cid, *([name] if name else []))
            os.makedirs(out, exist_ok=True)
            stand, box_hat = plain, None
            shift = 0
            if hat:
                for pose in POSES:
                    frames, times = read_gif(os.path.join(PUBLIC, c[pose]["file"]))
                    high = frames[0].height
                    worn, grew, moved = wear(frames, times, dict(c[pose], hair=HAIR[cid]), hat)
                    if pose == "standing":
                        stand, shift = worn, moved
                    at = c[pose].get("prop_x", c[pose]["head_x"] + moved)
                    if getattr(hat, "PROP_MOVES", False):
                        worn, times = spread(worn, times)
                    worn, _ = beside(worn, hat, c[pose]["block"], at, high, times)
                    write_gif(os.path.join(out, f"{pose}.gif"), worn, times)
                    if grew > 1:
                        taller[f"/characters/{cid}/{name}/{pose}.gif"] = round(grew, 4)
                box_hat = hat
            b = c["standing"]["block"]
            box = dict(block=b, head_x=c["standing"]["head_x"] + shift, head_w=c["head_w"])
            scenes = list(box_scenes(stand, box, box_hat, bare=plain[0]))
            scenes[1], waits = [f for f, _ in scenes[1]], [t for _, t in scenes[1]]
            waits = [100, waits, 100]
            if hat:
                if getattr(hat, "PROP_MOVES", False):
                    # Sitting in the box is mostly long holds; give the
                    # things beside it frames to move in.
                    scenes[1], waits[1] = spread(scenes[1], waits[1], step=100)
                scenes = [beside(sc, hat, b, box["head_x"], plain[0].height, t)[0] for sc, t in zip(scenes, waits)]
            write_gif(os.path.join(out, "get-in-box.gif"), scenes[0], waits[0], loop=False)
            write_gif(os.path.join(out, "in-box.gif"), scenes[1], waits[1])
            write_gif(os.path.join(out, "getting-out-of-box.gif"), scenes[2], waits[2], loop=False)
            print(cid, name or "plain", "done", flush=True)
    with open(os.path.join(ROOT, "src", "lib", "bot-characters", "taller.json"), "w") as f:
        json.dump(taller, f, indent=2, sort_keys=True)
        f.write("\n")


if __name__ == "__main__":
    main()
