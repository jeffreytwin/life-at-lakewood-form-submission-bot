/**
 * Business hours utilities.
 *
 * Business hours are defined as 8:30am – 5:30pm US Eastern time,
 * Monday through Friday, excluding US federal holidays.
 */

const BUSINESS_START_MINUTES = 8 * 60 + 30;   // 08:30
const BUSINESS_END_MINUTES = 17 * 60 + 30;    // 17:30

/**
 * Get the year, month (1-12), day, weekday (0=Sun..6=Sat), hour, and
 * minute of a Date as seen in US Eastern time.
 */
function getEasternParts(d: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hours: number;
  minutes: number;
} {
  // Use en-US formatter in America/New_York to extract each component.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  let hours = parseInt(get("hour"), 10);
  // Intl sometimes returns "24" for midnight when hour12:false is set.
  if (hours === 24) hours = 0;

  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    weekday: weekdayMap[get("weekday")] ?? 0,
    hours,
    minutes: parseInt(get("minute"), 10),
  };
}

/** Nth weekday of a given month (e.g., 3rd Monday of January). */
function nthWeekdayOfMonth(
  year: number,
  month: number, // 1-12
  weekday: number, // 0=Sun..6=Sat
  n: number
): { year: number; month: number; day: number } {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = first.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return { year, month, day };
}

/** Last weekday of a given month (e.g., last Monday of May). */
function lastWeekdayOfMonth(
  year: number,
  month: number, // 1-12
  weekday: number
): { year: number; month: number; day: number } {
  // Find the last day of the month
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay));
  const lastWeekdayNum = last.getUTCDay();
  const offset = (lastWeekdayNum - weekday + 7) % 7;
  return { year, month, day: lastDay - offset };
}

/**
 * Observed-date rule for fixed-date federal holidays:
 * if the holiday falls on Saturday, it's observed Friday;
 * if it falls on Sunday, it's observed Monday.
 */
function observed(
  year: number,
  month: number,
  day: number
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay();
  if (dow === 6) return { year, month, day: day - 1 }; // Sat -> Fri
  if (dow === 0) return { year, month, day: day + 1 }; // Sun -> Mon
  return { year, month, day };
}

/**
 * Return all US federal holiday dates (including observed dates) for a given
 * year, as a Set of "YYYY-MM-DD" strings.
 */
function federalHolidaysFor(year: number): Set<string> {
  const dates: { year: number; month: number; day: number }[] = [
    observed(year, 1, 1),                             // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3),                 // MLK Day (3rd Mon of Jan)
    nthWeekdayOfMonth(year, 2, 1, 3),                 // Presidents' Day (3rd Mon of Feb)
    lastWeekdayOfMonth(year, 5, 1),                   // Memorial Day (last Mon of May)
    observed(year, 6, 19),                            // Juneteenth
    observed(year, 7, 4),                             // Independence Day
    nthWeekdayOfMonth(year, 9, 1, 1),                 // Labor Day (1st Mon of Sep)
    nthWeekdayOfMonth(year, 10, 1, 2),                // Columbus Day (2nd Mon of Oct)
    observed(year, 11, 11),                           // Veterans Day
    nthWeekdayOfMonth(year, 11, 4, 4),                // Thanksgiving (4th Thu of Nov)
    observed(year, 12, 25),                           // Christmas
  ];

  return new Set(
    dates.map(
      ({ year: y, month: m, day: d }) =>
        `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    )
  );
}

// Cache the computed holiday sets by year.
const holidayCache: Map<number, Set<string>> = new Map();

function holidaysFor(year: number): Set<string> {
  let set = holidayCache.get(year);
  if (!set) {
    set = federalHolidaysFor(year);
    holidayCache.set(year, set);
  }
  return set;
}

/**
 * Return true if the given Date falls within business hours —
 * Mon-Fri, 8:30am-5:30pm US Eastern time, excluding US federal holidays.
 */
export function isBusinessHours(d: Date): boolean {
  const parts = getEasternParts(d);

  // Weekend check
  if (parts.weekday === 0 || parts.weekday === 6) return false;

  // Federal holiday check
  const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  if (holidaysFor(parts.year).has(dateKey)) return false;

  // Time-of-day check
  const mins = parts.hours * 60 + parts.minutes;
  return mins >= BUSINESS_START_MINUTES && mins < BUSINESS_END_MINUTES;
}
