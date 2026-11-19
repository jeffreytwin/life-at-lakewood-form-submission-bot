import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ALL_CHARACTER_IDS, HOLIDAYS, dressFor, getCharacter, holidayOn } from "@/lib/bot-characters";

/** Noon Eastern on the given date, well clear of either midnight. */
const noon = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d, 17));

describe("the holiday calendar", () => {
  it("puts each hat on for its dates and no others", () => {
    expect(holidayOn(noon(12, 1))).toBe("santa");
    expect(holidayOn(noon(12, 31))).toBe("santa");
    expect(holidayOn(noon(1, 1))).toBeNull();
    expect(holidayOn(noon(11, 1))).toBe("pilgrim");
    expect(holidayOn(noon(11, 30))).toBe("pilgrim");
    expect(holidayOn(noon(10, 31))).toBeNull();
    expect(holidayOn(noon(3, 17))).toBe("stpatrick");
    expect(holidayOn(noon(4, 1))).toBeNull();
    expect(holidayOn(noon(6, 14))).toBeNull();
    expect(holidayOn(noon(6, 15))).toBe("unclesam");
    expect(holidayOn(noon(7, 4))).toBe("unclesam");
    expect(holidayOn(noon(7, 5))).toBeNull();
  });

  it("changes hats at midnight Eastern, not midnight UTC", () => {
    // 11pm Eastern on November 30th is already December 1st in UTC.
    expect(holidayOn(new Date("2026-12-01T04:00:00Z"))).toBe("pilgrim");
    expect(holidayOn(new Date("2026-12-01T05:00:00Z"))).toBe("santa");
  });
});

describe("dressing a character", () => {
  it("swaps in the hatted animations", () => {
    for (const id of ALL_CHARACTER_IDS) {
      const plain = dressFor(getCharacter(id), null);
      const santa = dressFor(plain, "santa");
      expect(santa.gifs.standing).toBe(`/characters/${id}/santa/standing.gif`);
      expect(santa.gifs.inBox).toBe(`/characters/${id}/santa/in-box.gif`);
      expect(santa.gifs.celebrating).toBe(`/characters/${id}/santa/celebrating.gif`);
      expect(santa.gifs.sneaking).toBe(`/characters/${id}/santa/sneaking.gif`);
    }
  });

  it("has every hat in the calendar drawn for every character", () => {
    for (const id of ALL_CHARACTER_IDS) {
      const plain = dressFor(getCharacter(id), null);
      for (const { id: holiday } of HOLIDAYS) {
        expect(dressFor(plain, holiday).gifs.standing).toBe(`/characters/${id}/${holiday}/standing.gif`);
      }
    }
  });

  it("only names animations that exist", () => {
    for (const id of ALL_CHARACTER_IDS) {
      const plain = dressFor(getCharacter(id), null);
      for (const c of [plain, ...HOLIDAYS.map((h) => dressFor(plain, h.id))]) {
        for (const src of Object.values(c.gifs)) {
          expect(existsSync(join(process.cwd(), "public", src)), src).toBe(true);
        }
      }
    }
  });
});
