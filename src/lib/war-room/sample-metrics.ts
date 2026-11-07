/**
 * Sample numbers for the War Room until the Salesforce and ad-spend Zaps
 * exist (Jeff, 2026-11-07). Everything the page measures goals against
 * comes from `monthlyMetrics` below; when real reports arrive, only that
 * function changes.
 *
 * The figures are a typical full month for each calendar month. They are
 * laid onto whatever year it is: months after this one are left out, and
 * this month is scaled down to the days gone so far, so the sample reads
 * like a year in progress whenever the page is opened.
 */

export interface MonthMetrics {
  /** "2026-03" */
  month: string;
  /** Contracts signed (pending deals) */
  contracts: number;
  /** Closed transactions */
  closings: number;
  /** Gross commission before agent splits */
  preSplit: number;
  /** Company dollar after agent splits */
  postSplit: number;
  adSpend: number;
  /** Costs other than ad spend */
  otherExpenses: number;
  /** postSplit − adSpend − otherExpenses */
  profit: number;
}

// One typical full month for January through December.
const CLOSINGS = [9, 10, 14, 15, 16, 15, 12, 13, 12, 15, 16, 18];
const CONTRACTS = [12, 14, 16, 15, 14, 13, 12, 13, 15, 14, 15, 10];
const AVG_PRE_SPLIT = [17800, 18200, 18600, 18100, 19000, 18800, 18300, 18500, 18700, 18400, 18900, 19200];
const AD_SPEND = [36000, 37000, 39000, 40000, 41000, 40000, 38000, 38000, 39000, 40000, 42000, 42000];
const OTHER_EXPENSES = 9000;
const COMPANY_SHARE = 0.472;

const round100 = (n: number) => Math.round(n / 100) * 100;

/** The parts of a date in Eastern time. */
export function easternParts(now: Date): { year: number; month: number; day: number } {
  const [year, month, day] = now
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" })
    .split("-")
    .map(Number);
  return { year, month, day };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Months of `year` up to `now`, the current one partial. */
export function monthlyMetrics(year: number, now: Date): MonthMetrics[] {
  const today = easternParts(now);
  if (year > today.year) return [];
  const lastMonth = year < today.year ? 12 : today.month;
  const out: MonthMetrics[] = [];
  for (let m = 1; m <= lastMonth; m++) {
    const i = m - 1;
    const share = year === today.year && m === today.month ? today.day / daysInMonth(year, m) : 1;
    const closings = Math.round(CLOSINGS[i] * share);
    const preSplit = round100(closings * AVG_PRE_SPLIT[i]);
    const postSplit = round100(preSplit * COMPANY_SHARE);
    const adSpend = round100(AD_SPEND[i] * share);
    const otherExpenses = round100(OTHER_EXPENSES * share);
    out.push({
      month: `${year}-${String(m).padStart(2, "0")}`,
      contracts: Math.round(CONTRACTS[i] * share),
      closings,
      preSplit,
      postSplit,
      adSpend,
      otherExpenses,
      profit: postSplit - adSpend - otherExpenses,
    });
  }
  return out;
}
