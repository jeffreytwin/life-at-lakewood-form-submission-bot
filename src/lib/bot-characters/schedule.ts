import {
  ALL_DAYS,
  ALL_CHARACTER_IDS,
  type CharacterId,
  type CharacterSchedule,
  type DayKey,
} from "./types";

/**
 * Default schedule used when system_settings.bot_character_schedule is null
 * (e.g. brand-new install) or has missing/invalid keys. Liquid takes
 * Mon/Wed/Sat per the latest spec; Ocelot keeps Friday from his earlier run;
 * Snake fills the rest.
 */
export const DEFAULT_SCHEDULE: CharacterSchedule = {
  sunday: "snake",
  monday: "liquid",
  tuesday: "snake",
  wednesday: "liquid",
  thursday: "snake",
  friday: "ocelot",
  saturday: "liquid",
};

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === "string" && (ALL_CHARACTER_IDS as string[]).includes(value);
}

/**
 * Defensive normalization: any unknown character id or missing day falls back
 * to the default. Lets us tolerate older rows or partial saves.
 */
export function normalizeSchedule(raw: unknown): CharacterSchedule {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
  const out = { ...DEFAULT_SCHEDULE };
  for (const day of ALL_DAYS) {
    const v = obj[day];
    if (isCharacterId(v)) out[day] = v;
  }
  return out;
}

const dayKeyByGetDay: DayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * Day-of-week in America/New_York time, returned as our DayKey.
 */
export function easternDayKey(at: Date = new Date()): DayKey {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(at);
  switch (weekday) {
    case "Sun": return "sunday";
    case "Mon": return "monday";
    case "Tue": return "tuesday";
    case "Wed": return "wednesday";
    case "Thu": return "thursday";
    case "Fri": return "friday";
    case "Sat": return "saturday";
    default: return dayKeyByGetDay[0];
  }
}

// ---------------------------------------------------------------------------
// Client-side cache + subscription
// ---------------------------------------------------------------------------

let cachedSchedule: CharacterSchedule | null = null;
let inflight: Promise<CharacterSchedule> | null = null;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => {
    try { fn(); } catch { /* ignore subscriber errors */ }
  });
}

/**
 * Returns whatever schedule the cache currently holds. Falls back to default
 * before the first fetch resolves so synchronous callers always have something
 * sensible to render.
 */
export function getCachedSchedule(): CharacterSchedule {
  return cachedSchedule ?? DEFAULT_SCHEDULE;
}

/**
 * Kick off (or reuse) a single fetch of the schedule from /api/internal/settings.
 * Subsequent calls return the cached schedule.
 */
export async function ensureScheduleLoaded(): Promise<CharacterSchedule> {
  if (cachedSchedule) return cachedSchedule;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/internal/settings");
      if (res.ok) {
        const data = await res.json();
        cachedSchedule = normalizeSchedule(data?.bot_character_schedule ?? null);
      } else {
        cachedSchedule = { ...DEFAULT_SCHEDULE };
      }
    } catch {
      cachedSchedule = { ...DEFAULT_SCHEDULE };
    }
    notify();
    inflight = null;
    return cachedSchedule;
  })();

  return inflight;
}

/**
 * Replace the cached schedule and notify subscribers. Call this after PATCHing
 * /api/internal/settings so other components on the page re-render immediately.
 */
export function setCachedSchedule(schedule: CharacterSchedule): void {
  cachedSchedule = normalizeSchedule(schedule);
  notify();
}

export function subscribeToSchedule(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
