import { snake } from "./snake";
import { ocelot } from "./ocelot";
import { liquid } from "./liquid";
import {
  DEFAULT_SCHEDULE,
  easternDayKey,
  ensureScheduleLoaded,
  getCachedSchedule,
  normalizeSchedule,
  setCachedSchedule,
  subscribeToSchedule,
} from "./schedule";
import type { BotCharacter } from "./types";
import type { CharacterId, CharacterSchedule, DayKey } from "./types";

export type {
  BotCharacter,
  BotCharacterGifs,
  CharacterId,
  CharacterSchedule,
  DayKey,
} from "./types";
export { ALL_CHARACTER_IDS, ALL_DAYS } from "./types";
export {
  DEFAULT_SCHEDULE,
  ensureScheduleLoaded,
  getCachedSchedule,
  normalizeSchedule,
  setCachedSchedule,
  subscribeToSchedule,
  easternDayKey,
} from "./schedule";

const CHARACTERS: Record<CharacterId, BotCharacter> = {
  snake,
  ocelot,
  liquid,
};

export function getCharacter(id: CharacterId): BotCharacter {
  return CHARACTERS[id];
}

/**
 * Pick the character on duty for the given moment, using the cached
 * schedule (or the hardcoded default if the cache hasn't populated yet).
 */
export function getActiveCharacter(at: Date = new Date()): BotCharacter {
  const schedule = getCachedSchedule();
  const day = easternDayKey(at);
  const id = schedule[day] ?? DEFAULT_SCHEDULE[day];
  return CHARACTERS[id] ?? snake;
}

/**
 * Resolve the character for a specific day from a (possibly partial) schedule.
 * Used by the schedule editor UI.
 */
export function characterForDay(schedule: CharacterSchedule, day: DayKey): BotCharacter {
  const id = schedule[day] ?? DEFAULT_SCHEDULE[day];
  return CHARACTERS[id] ?? snake;
}

interface AgentDisplayInput {
  name: string;
  photo_url: string | null;
  photo_thumb_url?: string | null;
}

interface AgentDisplay {
  name: string;
  photo_url: string | null;
  photo_thumb_url: string | null;
  /** Pass through to CSS `object-position` on the rendered <img>. */
  photoObjectPosition: string;
  /** Pass through to CSS `transform` on the rendered <img>. Defaults to "none". */
  photoTransform: string;
}

const BOT_AGENT_NAME = "Solid Snake Bot";

const BOT_DISPLAY_BY_CHARACTER: Record<CharacterId, { name: string; photo: string | null }> = {
  snake: { name: BOT_AGENT_NAME, photo: null }, // null → use the agent row's own photo
  ocelot: { name: "Revolver Ocelot Bot", photo: ocelot.gifs.standing },
  liquid: { name: "Liquid Snake Bot", photo: liquid.gifs.standing },
};

const DEFAULT_OBJECT_POSITION = "center";

/**
 * Map a raw agent record to its on-screen identity. The "Solid Snake Bot"
 * row is rebadged as today's character — Snake leaves the photo alone but
 * still hands back his avatar object-position, Ocelot and Liquid swap in
 * their name and Standing GIF. The DB row itself is never mutated; only
 * how it's rendered.
 */
export function getDisplayAgent(agent: AgentDisplayInput): AgentDisplay {
  if (agent.name !== BOT_AGENT_NAME) {
    return {
      name: agent.name,
      photo_url: agent.photo_url,
      photo_thumb_url: agent.photo_thumb_url ?? null,
      photoObjectPosition: DEFAULT_OBJECT_POSITION,
      photoTransform: "none",
    };
  }
  const character = getActiveCharacter();
  const swap = BOT_DISPLAY_BY_CHARACTER[character.id];
  return {
    name: swap.name,
    photo_url: swap.photo ?? agent.photo_url,
    photo_thumb_url: swap.photo ?? agent.photo_thumb_url ?? null,
    photoObjectPosition: character.avatarObjectPosition ?? DEFAULT_OBJECT_POSITION,
    photoTransform: character.avatarTransform ?? "none",
  };
}
