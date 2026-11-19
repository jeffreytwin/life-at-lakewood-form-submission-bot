import type { LeadEvent, LeadEventType } from "@/lib/lead-events";

export interface BotCharacterGifs {
  standing: string;
  inBox: string;
  getInBox: string;
  gettingOutOfBox: string;
  celebrating: string;
  /** Shown when quiet hours are active and the character is in resting state. */
  sneaking: string;
}

/** The holidays the characters dress up for. See holidays.ts for the dates. */
export type HolidayId = "santa" | "pilgrim" | "unclesam" | "stpatrick";

/**
 * What a character says while wearing one holiday's hat, mixed in with
 * their everyday lines. See holiday-lines.ts.
 */
export interface HolidayLines {
  /** Extra greetings, added to the everyday ones. */
  welcome: string[];
  /** Holiday versions of an event's line, said about half the time. */
  events: Partial<Record<LeadEventType, (event: LeadEvent) => string>>;
}

export type CharacterId ="snake" | "ocelot" | "liquid" | "bigboss";

export const ALL_CHARACTER_IDS: CharacterId[] = ["snake", "ocelot", "liquid", "bigboss"];

export type DayKey =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export const ALL_DAYS: DayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export type CharacterSchedule = Record<DayKey, CharacterId>;

export interface BotCharacter {
  id: CharacterId;
  displayName: string;
  welcomeMessages: string[];
  welcomeSound: string;
  getMessage: (event: LeadEvent) => string;
  /**
   * Which holiday a line this character just said belongs to, or null for
   * an everyday line. Pass the event when the line came from getMessage.
   * Only a character with a hat on has this; everyone else's lines are
   * all everyday ones.
   */
  holidayOfLine?: (line: string, event?: LeadEvent) => HolidayId | null;
  gifs: BotCharacterGifs;
  /**
   * Hatted versions of the animations, by holiday. Only the animations that
   * have been drawn with the hat are listed; the rest stay as they are.
   */
  holidayGifs?: Partial<Record<HolidayId, Partial<BotCharacterGifs>>>;
  /** Multiplier applied to the routing-toggle character size. Defaults to 1.0. */
  gifSizeScale?: number;
  /** Optional scale just for the quiet-hours (sneaking) GIF. Falls back to gifSizeScale. */
  sneakingSizeScale?: number;
  /** How long to hold the celebration GIF on screen, in ms. Defaults to 3000. */
  celebrationDurationMs?: number;
  /**
   * CSS object-position for cover-cropped avatar renders (schedule editor,
   * agent rows, modal photo). Defaults to "center". Snake's sprites place
   * the character in the lower portion of the frame, so anchoring his
   * crop to the bottom keeps him visible.
   */
  avatarObjectPosition?: string;
  /**
   * CSS transform applied to the avatar <img> on top of object-position.
   * Useful when a character's sprite is framed differently from Snake's
   * and needs a small physical offset to land in the same visual spot.
   */
  avatarTransform?: string;
}
