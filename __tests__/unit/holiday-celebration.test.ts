import { describe, it, expect } from "vitest";
import { HOLIDAYS } from "@/lib/bot-characters";
import {
  FIREWORK_COLORS,
  HOLIDAY_FALLS,
  HOLIDAY_FIREWORK_COLORS,
  fireworkColors,
  makePieces,
} from "@/lib/holiday-celebration";

/**
 * Jeff, 2026-11-19: a celebration in a holiday's window is the holiday's
 * own. Leaves for Thanksgiving, snow for Christmas, clovers and gold coins
 * for St. Patrick's Day, red, white and blue fireworks for the 4th of July.
 */
describe("holiday celebrations", () => {
  it("gives every holiday in the calendar its own celebration", () => {
    for (const { id } of HOLIDAYS) {
      expect(Boolean(HOLIDAY_FALLS[id]) !== Boolean(HOLIDAY_FIREWORK_COLORS[id]), id).toBe(true);
    }
    expect(HOLIDAY_FALLS.pilgrim).toBeDefined();
    expect(HOLIDAY_FALLS.santa).toBeDefined();
    expect(HOLIDAY_FALLS.stpatrick?.kinds.length).toBeGreaterThan(1);
  });

  it("sends the 4th of July fireworks up in red, white and blue only", () => {
    expect(fireworkColors("unclesam")).toEqual(["#ff004d", "#fff1e8", "#29adff"]);
  });

  it("keeps the everyday fireworks on an ordinary day", () => {
    expect(fireworkColors(null)).toBe(FIREWORK_COLORS);
  });

  it("draws every picture as a full rectangle with a color for each pixel", () => {
    for (const fall of Object.values(HOLIDAY_FALLS)) {
      for (const kind of fall.kinds) {
        for (const rows of kind.frames) {
          expect(new Set(rows.map((r) => r.length)).size).toBe(1);
          // A coin's frames are the same size, so it turns in place.
          expect(rows.length).toBe(kind.frames[0].length);
          expect(rows[0].length).toBe(kind.frames[0][0].length);
          for (const palette of kind.palettes) {
            for (const ch of rows.join("").replace(/\./g, "")) expect(palette[ch], ch).toMatch(/^#/);
          }
        }
      }
    }
  });

  it("starts every piece above the screen and falling, across its width", () => {
    for (const fall of Object.values(HOLIDAY_FALLS)) {
      const pieces = makePieces(fall, 1200, 800);
      expect(pieces).toHaveLength(fall.count);
      for (const p of pieces) {
        expect(p.y).toBeLessThan(0);
        expect(p.vy).toBeGreaterThan(0);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1200);
      }
    }
  });
});
