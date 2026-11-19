import type { HolidayId } from "@/lib/bot-characters/types";

/**
 * What a celebration looks like while a holiday's hat is on (Jeff,
 * 2026-11-19), in place of the everyday fireworks:
 *
 *   Thanksgiving       autumn leaves falling
 *   Christmas          snow
 *   St. Patrick's Day  four-leaf clovers and gold coins falling
 *   4th of July        fireworks in red, white and blue only
 *
 * Everything is drawn as square pixels on the fireworks' grid, so it sits
 * with the rest of the dashboard's pixel art. PixelFireworks runs the
 * animation; this file is the pictures and how they move.
 */

/** The grid pixels snap to, as the fireworks draw them. */
export const PX = 4;

/** The everyday fireworks' colors. */
export const FIREWORK_COLORS = [
  "#ff004d", // red
  "#ff77a8", // pink
  "#ffccaa", // peach
  "#ffa300", // orange
  "#ffec27", // yellow
  "#00e436", // green
  "#29adff", // blue
  "#83769c", // lavender
  "#fff1e8", // white
];

const RED_WHITE_BLUE = ["#ff004d", "#fff1e8", "#29adff"];

/**
 * One kind of thing that falls. A picture is rows of characters, one per
 * pixel: "." is empty and any other character is looked up in the palette.
 */
export interface PieceKind {
  /** The picture, or several to flip through as it falls (a coin spinning). */
  frames: string[][];
  /** Colorings to choose between, one per piece. */
  palettes: Record<string, string>[];
  /** Fall speed range, px per frame. */
  speed: [number, number];
  /** How far it drifts side to side, px. */
  sway: [number, number];
  /** How fast it drifts, radians per frame. */
  swaySpeed: [number, number];
  /** Frames each picture is held for, when there are several. */
  frameHold?: number;
}

const MAPLE_LEAF = [
  "..X.X..",
  ".XXXXX.",
  "XXXXXXX",
  ".XXXXX.",
  "..XXX..",
  "...S...",
  "...S...",
];

const OVAL_LEAF = [
  "....XX.",
  "..XXXX.",
  ".XXXVX.",
  ".XXVX..",
  ".XVX...",
  "S......",
];

const leafPalette = (leaf: string, vein: string) => ({ X: leaf, V: vein, S: "#7a4a2b" });
const LEAF_PALETTES = [
  leafPalette("#ffa300", "#c2570c"), // orange
  leafPalette("#e8590c", "#9a3412"), // burnt orange
  leafPalette("#c1272d", "#7f1d1d"), // red
  leafPalette("#ffcc33", "#c98a00"), // gold
  leafPalette("#ab5236", "#6b2f1c"), // brown
];

const SNOW_PALETTES = [{ X: "#fff1e8" }, { X: "#ffffff" }, { X: "#c9e8ff" }];

const SNOWFLAKE = [
  "..X..",
  "X.X.X",
  ".XXX.",
  "X.X.X",
  "..X..",
];

const CLOVER = [
  ".XX.XX.",
  "XXXXXXX",
  ".XXDXX.",
  "XXXXXXX",
  ".XX.XX.",
  "...S...",
  "..S....",
];

const CLOVER_PALETTES = [
  { X: "#00e436", D: "#008751", S: "#008751" },
  { X: "#3ecf5c", D: "#0f7a3a", S: "#0f7a3a" },
  { X: "#00b140", D: "#006b3c", S: "#006b3c" },
];

// A coin turning: face on, part turned, edge on, part turned.
const COIN_FACE = [
  ".XXXX.",
  "XHHXXD",
  "XHXXXD",
  "XXXXXD",
  "XXXXDD",
  ".DDDD.",
];
const COIN_TURNED = [
  "..XX..",
  ".XHXD.",
  ".XHXD.",
  ".XXXD.",
  ".XXDD.",
  "..DD..",
];
const COIN_EDGE = [
  "..X...",
  "..XD..",
  "..XD..",
  "..XD..",
  "..XD..",
  "..D...",
];
const COIN_PALETTE = { X: "#ffec27", H: "#fff8c4", D: "#e0a100" };

const maple: PieceKind = {
  frames: [MAPLE_LEAF],
  palettes: LEAF_PALETTES,
  speed: [1.6, 3.2],
  sway: [30, 80],
  swaySpeed: [0.02, 0.045],
};
const oval: PieceKind = { ...maple, frames: [OVAL_LEAF] };

const snowSpeck: PieceKind = {
  frames: [["X"]],
  palettes: SNOW_PALETTES,
  speed: [1.5, 2.8],
  sway: [6, 24],
  swaySpeed: [0.015, 0.04],
};
const snowDot: PieceKind = { ...snowSpeck, frames: [["XX", "XX"]], speed: [1.6, 3] };
const snowflake: PieceKind = { ...snowSpeck, frames: [SNOWFLAKE], speed: [1.5, 2.4], sway: [14, 36] };

const clover: PieceKind = {
  frames: [CLOVER],
  palettes: CLOVER_PALETTES,
  speed: [1.8, 3.2],
  sway: [20, 60],
  swaySpeed: [0.02, 0.04],
};
const coin: PieceKind = {
  frames: [COIN_FACE, COIN_TURNED, COIN_EDGE, COIN_TURNED],
  palettes: [COIN_PALETTE],
  speed: [3, 5],
  sway: [0, 8],
  swaySpeed: [0.02, 0.04],
  frameHold: 6,
};

/** A holiday whose celebration falls from the top of the screen. */
export interface Fall {
  count: number;
  /** A piece is one of these, chosen evenly; list a kind twice to see more of it. */
  kinds: PieceKind[];
}

export const HOLIDAY_FALLS: Partial<Record<HolidayId, Fall>> = {
  pilgrim: { count: 70, kinds: [maple, oval] },
  santa: { count: 180, kinds: [snowSpeck, snowSpeck, snowDot, snowDot, snowflake] },
  stpatrick: { count: 70, kinds: [clover, clover, coin] },
};

/** Fireworks colors for a holiday that keeps the fireworks but in its own colors. */
export const HOLIDAY_FIREWORK_COLORS: Partial<Record<HolidayId, string[]>> = {
  unclesam: RED_WHITE_BLUE,
};

/** The colors the fireworks go up in today. */
export function fireworkColors(holiday: HolidayId | null): string[] {
  return (holiday && HOLIDAY_FIREWORK_COLORS[holiday]) || FIREWORK_COLORS;
}

export interface Piece {
  kind: PieceKind;
  palette: Record<string, string>;
  /** The line it falls along; the drift is either side of this. */
  x: number;
  y: number;
  vy: number;
  sway: number;
  swaySpeed: number;
  phase: number;
  /** Frames it has been falling, for the drift and for turning. */
  age: number;
}

/** How long the pieces keep arriving from the top, in frames at 60 a second. */
const ARRIVE_FRAMES = 200;
/** The screen height the fall speeds are written for; a taller screen falls faster to match. */
const SPEEDS_FOR_HEIGHT = 720;

/**
 * The pieces for one celebration, spread across the width of the screen and
 * started above it at different heights, so they arrive over a few seconds
 * and not as one sheet.
 */
export function makePieces(
  fall: Fall,
  width: number,
  height: number,
  random: () => number = Math.random
): Piece[] {
  const within = ([lo, hi]: [number, number]) => lo + random() * (hi - lo);
  const pieces: Piece[] = [];
  for (let i = 0; i < fall.count; i++) {
    const kind = fall.kinds[Math.floor(random() * fall.kinds.length)];
    const vy = within(kind.speed) * Math.max(1, height / SPEEDS_FOR_HEIGHT);
    pieces.push({
      kind,
      palette: kind.palettes[Math.floor(random() * kind.palettes.length)],
      x: random() * width,
      // Above the top by as far as it falls in the time it waits its turn.
      y: -kind.frames[0].length * PX - random() * ARRIVE_FRAMES * vy,
      vy,
      sway: within(kind.sway),
      swaySpeed: within(kind.swaySpeed),
      phase: random() * Math.PI * 2,
      // Not all from nothing, or every coin would turn in step.
      age: random() * 120,
    });
  }
  return pieces;
}

/**
 * Moves every piece on by `step` frames and draws it. Says whether any piece
 * is still above the bottom of the screen.
 */
export function drawPieces(
  ctx: CanvasRenderingContext2D,
  pieces: Piece[],
  step: number,
  height: number
): boolean {
  let anyLeft = false;
  for (const p of pieces) {
    if (p.y > height) continue;
    p.age += step;
    p.y += p.vy * step;
    if (p.y > height) continue;
    anyLeft = true;
    const frames = p.kind.frames;
    const rows = frames[Math.floor(p.age / (p.kind.frameHold ?? 1)) % frames.length];
    const left = Math.round((p.x + Math.sin(p.phase + p.age * p.swaySpeed) * p.sway) / PX) * PX;
    const top = Math.round(p.y / PX) * PX;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const color = p.palette[row[c]];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(left + c * PX, top + r * PX, PX, PX);
      }
    }
  }
  return anyLeft;
}
