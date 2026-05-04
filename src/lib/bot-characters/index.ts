import { snake } from "./snake";
import { ocelot } from "./ocelot";
import type { BotCharacter } from "./types";

export type { BotCharacter, BotCharacterGifs } from "./types";

/**
 * Day-of-week lookup using America/New_York time. 0 = Sunday, 6 = Saturday.
 */
function easternDayOfWeek(at: Date = new Date()): number {
  // Intl gives us the weekday in the target tz without parsing pitfalls.
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(at);
  switch (weekday) {
    case "Sun": return 0;
    case "Mon": return 1;
    case "Tue": return 2;
    case "Wed": return 3;
    case "Thu": return 4;
    case "Fri": return 5;
    case "Sat": return 6;
    default: return 0;
  }
}

/**
 * Revolver Ocelot takes the watch on Monday, Wednesday, and Friday (Eastern).
 * Solid Snake handles every other day.
 */
export function getActiveCharacter(at: Date = new Date()): BotCharacter {
  const day = easternDayOfWeek(at);
  const isOcelotDay = day === 1 || day === 3 || day === 5;
  return isOcelotDay ? ocelot : snake;
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
}

/**
 * Map a raw agent record to its on-screen identity. On Ocelot days, the
 * "Solid Snake Bot" agent is displayed as "Revolver Ocelot Bot" with the
 * Ocelot Standing GIF in place of its photo. The DB row itself is never
 * mutated — only how it's rendered.
 */
export function getDisplayAgent(agent: AgentDisplayInput): AgentDisplay {
  const character = getActiveCharacter();
  if (character.id === "ocelot" && agent.name === "Solid Snake Bot") {
    return {
      name: "Revolver Ocelot Bot",
      photo_url: ocelot.gifs.standing,
      photo_thumb_url: ocelot.gifs.standing,
    };
  }
  return {
    name: agent.name,
    photo_url: agent.photo_url,
    photo_thumb_url: agent.photo_thumb_url ?? null,
  };
}
