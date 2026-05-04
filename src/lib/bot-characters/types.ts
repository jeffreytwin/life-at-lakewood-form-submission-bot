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
}
