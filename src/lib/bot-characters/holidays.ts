import taller from "./taller.json";
import { HOLIDAY_LINES } from "./holiday-lines";
import type { BotCharacter, BotCharacterGifs, CharacterId, HolidayId } from "./types";

/**
 * The holiday calendar: which hat the characters wear on which dates, in
 * Eastern time, the same clock the day-of-week schedule runs on. Both ends
 * of a range are included, and the dates are [month, day].
 *
 * All four hats are drawn. A holiday added here before its artwork exists
 * changes nothing: a character with no hatted animation for it keeps its
 * everyday one. The artwork is drawn by scripts/character-art/build.py into
 * public/characters/<id>/<holiday>/.
 */
export const HOLIDAYS: { id: HolidayId; from: [number, number]; to: [number, number] }[] = [
  { id: "stpatrick", from: [3, 1], to: [3, 31] },
  { id: "unclesam", from: [6, 15], to: [7, 4] },
  { id: "pilgrim", from: [11, 1], to: [11, 30] },
  { id: "santa", from: [12, 1], to: [12, 31] },
];

const HOLIDAY_IDS = HOLIDAYS.map((h) => h.id);

/** The holiday on at this moment, or null for an ordinary day. */
export function holidayOn(at: Date = new Date()): HolidayId | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
  }).formatToParts(at);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const today = month * 100 + day;
  for (const h of HOLIDAYS) {
    if (today >= h.from[0] * 100 + h.from[1] && today <= h.to[0] * 100 + h.to[1]) return h.id;
  }
  return null;
}

/**
 * The holiday to dress for right now. Adding `?hat=santa` to any dashboard
 * address tries a hat on outside its dates (`?hat=none` takes it off), so a
 * hat can be looked over before its month comes round.
 */
export function currentHoliday(at: Date = new Date()): HolidayId | null {
  if (typeof window !== "undefined") {
    const asked = new URLSearchParams(window.location.search).get("hat");
    if (asked === "none") return null;
    if (asked && (HOLIDAY_IDS as string[]).includes(asked)) return asked as HolidayId;
  }
  return holidayOn(at);
}

/** Where build.py puts one character's animations for one holiday. */
export function holidayGifs(id: CharacterId, holiday: HolidayId): Partial<BotCharacterGifs> {
  const dir = `/characters/${id}/${holiday}`;
  return {
    standing: `${dir}/standing.gif`,
    celebrating: `${dir}/celebrating.gif`,
    sneaking: `${dir}/sneaking.gif`,
    inBox: `${dir}/in-box.gif`,
    getInBox: `${dir}/get-in-box.gif`,
    gettingOutOfBox: `${dir}/getting-out-of-box.gif`,
  };
}

/**
 * The character as they look and sound for the given holiday: the same
 * character with the hatted animations swapped in wherever one has been
 * drawn, and the holiday's lines mixed in with their everyday ones. The
 * lines go with the hat, so a character with no hat for a holiday says
 * nothing about it.
 *
 * Give it the plain character, not one already dressed. `random` picks
 * between the everyday line and the holiday one, and is there for tests.
 */
export function dressFor(
  character: BotCharacter,
  holiday: HolidayId | null,
  random: () => number = Math.random
): BotCharacter {
  const hatted = holiday ? character.holidayGifs?.[holiday] : undefined;
  if (!holiday || !hatted) return character;
  const lines = HOLIDAY_LINES[character.id]?.[holiday];
  const dressed = { ...character, gifs: { ...character.gifs, ...hatted } };
  if (!lines) return dressed;
  return {
    ...dressed,
    welcomeMessages: [...character.welcomeMessages, ...lines.welcome],
    getMessage: (event) => {
      const festive = lines.events[event.type];
      return festive && random() < 0.5 ? festive(event) : character.getMessage(event);
    },
  };
}

/**
 * How much taller than usual to show an animation, 1 for most. A hat can
 * stand higher than the everyday picture had room for, so build.py makes
 * that picture taller and records by how much. Giving it the same extra
 * height on the page keeps the character the size they always are.
 */
export function heightScale(src: string): number {
  return (taller as Record<string, number>)[src] ?? 1;
}
