import type { LeadEvent } from "@/lib/lead-events";

export interface BotCharacterGifs {
  standing: string;
  inBox: string;
  getInBox: string;
  gettingOutOfBox: string;
  celebrating: string;
  /** Shown when quiet hours are active and the character is in resting state. */
  sneaking: string;
}

export type CharacterId = "snake" | "ocelot" | "liquid";

export const ALL_CHARACTER_IDS: CharacterId[] = ["snake", "ocelot", "liquid"];

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
  gifs: BotCharacterGifs;
  /** Multiplier applied to the routing-toggle character size. Defaults to 1.0. */
  gifSizeScale?: number;
  /** How long to hold the celebration GIF on screen, in ms. Defaults to 3000. */
  celebrationDurationMs?: number;
}
