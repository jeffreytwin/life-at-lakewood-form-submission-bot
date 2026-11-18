"""Builds the character animations that are drawn by this script rather than
by hand: each character's own cardboard-box animations, and the holiday
versions of the standing and box animations.

    python3 scripts/character-art/build.py

Reads the standing GIFs in public/ and writes public/characters/<id>/...
Run it again after changing a hat, the box, or a standing animation."""
import os
import sys
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from lib import read_gif, write_gif, track, from_rows  # noqa: E402
import santa_hat as santa  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
PUBLIC = os.path.join(ROOT, "public")

# What the script has to be told about each standing animation, measured on
# its first frame: the size of one drawn pixel (`block`), the patch of face it
# follows from frame to frame, and where a hat band sits (its bottom edge and
# its middle).
CHARACTERS = {
    "snake": dict(standing="standing-there.gif", block=6, face=(40, 110, 150, 185),
                  band_bottom=112, head_x=97, head_w=118),
    "ocelot": dict(standing="Revolver Ocelot - Standing V2.gif", block=8, face=(110, 160, 240, 250),
                   band_bottom=160, head_x=182, head_w=165),
    "liquid": dict(standing="Liquid Snake - Standing.gif", block=8, face=(105, 160, 235, 250),
                   band_bottom=162, head_x=174, head_w=160),
    "bigboss": dict(standing="Big Boss - Standing V3.gif", block=8, face=(85, 175, 235, 255),
                    band_bottom=144, head_x=158, head_w=165),
}

HATS = {"santa": santa}

SHADOW = (86, 86, 98, 255)


# --- hats -------------------------------------------------------------------

def wear(frames, c, hat):
    """The frames with the hat on. The hat follows the face, and whatever hair
    stood above the band is tucked away under it."""
    b = c["block"]
    art = hat.santa_hat(b)
    rows = len(hat.ROWS)
    left = round(c["head_x"] - (hat.BAND_LEFT + hat.BAND_WIDTH / 2) * b)
    # `band_bottom` is where the band's lower edge meets the forehead, at the
    # front of the hat; the back of it sits lower, the hat being tipped back.
    top = c["band_bottom"] - rows * b
    out = []
    for f, (dx, dy) in zip(frames, track(frames, c["face"])):
        f = f.copy()
        for x in range(f.width):
            col = min(hat.BAND_WIDTH - 1, max(0, (x - left - dx) // b - hat.BAND_LEFT))
            tuck = top + dy + (rows - hat.BAND_ROWS + 1 + hat.drop(col)) * b
            if tuck > 0:
                f.paste((0, 0, 0, 0), (x, 0, x + 1, tuck))
        f.alpha_composite(art, (left + dx, top + dy))
        out.append(f)
    return out


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
    hat_art = hat.santa_hat(small) if hat else None

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
                hx, hy = left + b, top - len(hat.ROWS) * small + small
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
    hat_room = (hat_art.height if hat_art else 0)

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


def main():
    for cid, c in CHARACTERS.items():
        frames, durations = read_gif(os.path.join(PUBLIC, c["standing"]))
        for name, hat in [(None, None)] + list(HATS.items()):
            out = os.path.join(PUBLIC, "characters", cid, *([name] if name else []))
            os.makedirs(out, exist_ok=True)
            stand = wear(frames, c, hat) if hat else frames
            if hat:
                write_gif(os.path.join(out, "standing.gif"), stand, durations)
            get_in, in_box, get_out = box_scenes(stand, c, hat, bare=frames[0])
            write_gif(os.path.join(out, "get-in-box.gif"), get_in, 100, loop=False)
            write_gif(os.path.join(out, "in-box.gif"), [f for f, _ in in_box], [t for _, t in in_box])
            write_gif(os.path.join(out, "getting-out-of-box.gif"), get_out, 100, loop=False)
            print(cid, name or "plain", "done")


if __name__ == "__main__":
    main()
