import { supabase } from "@/lib/supabase/client";

interface QuietHoursSettings {
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;          // "HH:MM"
  quiet_hours_end: string;            // "HH:MM" — legacy single value
  quiet_hours_end_weekday: string;    // "HH:MM" — Mon-Fri end time
  quiet_hours_end_weekend: string;    // "HH:MM" — Sat-Sun end time
}

/**
 * Fetch quiet hours settings from the database.
 */
export async function getQuietHoursSettings(): Promise<QuietHoursSettings> {
  const { data } = await supabase
    .from("system_settings")
    .select("quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_end_weekday, quiet_hours_end_weekend")
    .eq("id", 1)
    .single();

  const legacyEnd = data?.quiet_hours_end ?? "08:30";

  return {
    quiet_hours_enabled: data?.quiet_hours_enabled ?? true,
    quiet_hours_start: data?.quiet_hours_start ?? "21:00",
    quiet_hours_end: legacyEnd,
    quiet_hours_end_weekday: data?.quiet_hours_end_weekday ?? "06:30",
    quiet_hours_end_weekend: data?.quiet_hours_end_weekend ?? legacyEnd,
  };
}

/**
 * Parse "HH:MM" into { hours, minutes }.
 */
function parseTime(hhmm: string): { hours: number; minutes: number } {
  const [h, m] = hhmm.split(":").map(Number);
  return { hours: h, minutes: m };
}

/**
 * Get the current Eastern Time hour and minute.
 */
function getEasternNow(): { hours: number; minutes: number; date: Date } {
  const now = new Date();
  const eastern = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  return {
    hours: eastern.getHours(),
    minutes: eastern.getMinutes(),
    date: eastern,
  };
}

/**
 * Convert a time value to total minutes since midnight for comparison.
 */
function toMinutes(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}

/**
 * Check if the current time (Eastern) falls within quiet hours.
 * Handles overnight ranges like 21:00 → 08:30.
 */
export function isInQuietHours(startTime: string, endTime: string): boolean {
  const now = getEasternNow();
  const nowMin = toMinutes(now.hours, now.minutes);
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  const startMin = toMinutes(start.hours, start.minutes);
  const endMin = toMinutes(end.hours, end.minutes);

  if (startMin <= endMin) {
    // Same-day range (e.g., 08:00 → 17:00)
    return nowMin >= startMin && nowMin < endMin;
  } else {
    // Overnight range (e.g., 21:00 → 08:30)
    return nowMin >= startMin || nowMin < endMin;
  }
}

/**
 * Get the correct quiet_hours_end for today, accounting for weekday vs weekend.
 *
 * The key insight: if quiet hours start at 9pm Friday and it's currently
 * 11pm Friday, the "end" that matters is Saturday morning — so we look at
 * the *next morning's* day, not "today". For overnight quiet hours where
 * we're in the before-midnight portion (now >= start), the end applies to
 * *tomorrow*. If we're in the after-midnight portion (now < end), the end
 * applies to *today*.
 */
export function getEffectiveQuietHoursEnd(
  settings: QuietHoursSettings
): string {
  const now = getEasternNow();
  const nowMin = toMinutes(now.hours, now.minutes);
  const start = parseTime(settings.quiet_hours_start);
  const startMin = toMinutes(start.hours, start.minutes);

  // Determine which day the "morning end" falls on
  const easternDay = now.date.getDay(); // 0=Sun, 6=Sat

  let endDay: number;
  if (startMin > toMinutes(parseTime(settings.quiet_hours_end_weekday).hours, parseTime(settings.quiet_hours_end_weekday).minutes)) {
    // Overnight range — figure out which half we're in
    if (nowMin >= startMin) {
      // Before midnight: end is tomorrow morning
      endDay = (easternDay + 1) % 7;
    } else {
      // After midnight: end is this morning
      endDay = easternDay;
    }
  } else {
    // Same-day range (unlikely for quiet hours but handle it)
    endDay = easternDay;
  }

  const isWeekend = endDay === 0 || endDay === 6; // Sun or Sat
  return isWeekend
    ? settings.quiet_hours_end_weekend
    : settings.quiet_hours_end_weekday;
}


/**
 * Calculate the deferred expiration time — the next occurrence of quiet_hours_end
 * in Eastern Time, returned as an ISO string.
 *
 * If we're in quiet hours tonight (e.g., 10pm), the end is tomorrow morning.
 * This adds 2 minutes after quiet hours end to give the normal follow-up window.
 */
export function getDeferredExpiresAt(endTime: string): string {
  const now = new Date();
  const eastern = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const end = parseTime(endTime);

  // Build a target date in Eastern time
  const target = new Date(eastern);
  target.setHours(end.hours, end.minutes, 0, 0);

  // If the target time has already passed today (or is right now), push to tomorrow
  if (target <= eastern) {
    target.setDate(target.getDate() + 1);
  }

  // Convert back: calculate the offset between eastern representation and real UTC
  const offsetMs = now.getTime() - eastern.getTime();
  const utcTarget = new Date(target.getTime() + offsetMs);

  return utcTarget.toISOString();
}
