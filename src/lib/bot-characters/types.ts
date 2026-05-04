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

export interface BotCharacter {
  id: "snake" | "ocelot";
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
