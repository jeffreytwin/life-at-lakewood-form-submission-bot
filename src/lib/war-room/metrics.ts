/**
 * The War Room's arithmetic (Jeff, 2026-11-07): how far along each goal
 * is, whether it is on pace for the year, what a period's numbers add up
 * to, and the lines of the Mission Briefing. No database here.
 */

import { daysInMonth, easternParts, type MonthMetrics } from "./sample-metrics";

export type GoalMetric = "transactions" | "pre_split" | "post_split" | "profit";

export const GOAL_METRICS: GoalMetric[] = ["transactions", "pre_split", "post_split", "profit"];

export const GOAL_LABELS: Record<GoalMetric, string> = {
  transactions: "Transactions",
  pre_split: "Pre-Split Revenue",
  post_split: "Post-Split Revenue",
  profit: "Profit",
};

/** Which monthly figure a goal is measured against. */
const GOAL_SOURCE: Record<GoalMetric, keyof Omit<MonthMetrics, "month">> = {
  transactions: "closings",
  pre_split: "preSplit",
  post_split: "postSplit",
  profit: "profit",
};

export interface GoalTarget {
  metric: GoalMetric;
  target: number;
  stretchTarget: number | null;
}

export type PaceStatus = "ahead" | "on_pace" | "behind";

export interface GoalProgress extends GoalTarget {
  label: string;
  actual: number;
  /** actual ÷ target, 0–1+ */
  progress: number;
  /** Share of the year gone, 0–1: where the bar should be today */
  expected: number;
  pace: PaceStatus;
  /** Year-end total at the current rate */
  projected: number;
}

/** Within this much of the expected share counts as on pace. */
const ON_PACE_SLACK = 0.03;

/**
 * Share of `year` gone by `now`, counting today as done. 1 for a past
 * year, 0 for a future one.
 */
export function yearElapsed(year: number, now: Date): number {
  const t = easternParts(now);
  if (year < t.year) return 1;
  if (year > t.year) return 0;
  let dayOfYear = t.day;
  for (let m = 1; m < t.month; m++) dayOfYear += daysInMonth(year, m);
  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  return dayOfYear / daysInYear;
}

export function paceStatus(progress: number, expected: number): PaceStatus {
  if (progress >= expected + ON_PACE_SLACK) return "ahead";
  if (progress >= expected - ON_PACE_SLACK) return "on_pace";
  return "behind";
}

export function goalProgress(goals: GoalTarget[], months: MonthMetrics[], expected: number): GoalProgress[] {
  return goals.map((g) => {
    const key = GOAL_SOURCE[g.metric];
    const actual = months.reduce((sum, m) => sum + m[key], 0);
    const progress = g.target > 0 ? actual / g.target : 0;
    return {
      ...g,
      label: GOAL_LABELS[g.metric],
      actual,
      progress,
      expected,
      pace: paceStatus(progress, expected),
      projected: expected > 0 ? actual / expected : 0,
    };
  });
}

export type StatusPeriod = "month" | "last_month" | "quarter" | "ytd";

export const PERIOD_LABELS: Record<StatusPeriod, string> = {
  month: "This Month",
  last_month: "Last Month",
  quarter: "This Quarter",
  ytd: "Year to Date",
};

export interface PeriodTotals {
  contracts: number;
  closings: number;
  preSplit: number;
  postSplit: number;
  adSpend: number;
  profit: number;
  /** preSplit ÷ adSpend, null with no spend */
  roas: number | null;
}

/** The months a period covers, for a year in progress up to `now`. */
export function monthsInPeriod(months: MonthMetrics[], period: StatusPeriod, now: Date): MonthMetrics[] {
  const { year, month } = easternParts(now);
  const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  switch (period) {
    case "month":
      return months.filter((m) => m.month === key(year, month));
    case "last_month":
      // January's last month is last December, which is another year's numbers.
      return month === 1 ? [] : months.filter((m) => m.month === key(year, month - 1));
    case "quarter": {
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      return months.filter((m) => m.month >= key(year, first) && m.month <= key(year, month));
    }
    case "ytd":
      return months.filter((m) => m.month.startsWith(`${year}-`) && m.month <= key(year, month));
  }
}

export function periodTotals(months: MonthMetrics[]): PeriodTotals {
  const sum = (k: keyof Omit<MonthMetrics, "month">) => months.reduce((s, m) => s + m[k], 0);
  const preSplit = sum("preSplit");
  const adSpend = sum("adSpend");
  return {
    contracts: sum("contracts"),
    closings: sum("closings"),
    preSplit,
    postSplit: sum("postSplit"),
    adSpend,
    profit: sum("profit"),
    roas: adSpend > 0 ? preSplit / adSpend : null,
  };
}

// ============================================================
// MISSION BRIEFING
// ============================================================

export interface BriefingTask {
  title: string;
  /** "2026-11-10" or null */
  dueDate: string | null;
  done: boolean;
}

export type BriefingTone = "ok" | "warn" | "danger" | "next";

export interface BriefingLine {
  tone: BriefingTone;
  text: string;
}

/** "2026-11-07" in Eastern time. */
export function easternDate(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** "2026-11-07" plus `days`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Nov 10" */
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Up to four lines, in the order the art's panel shows them: goals, form
 * submissions, tasks, and the next task coming due.
 */
export function buildBriefing(input: {
  goals: GoalProgress[];
  leadsToday: number | null;
  tasks: BriefingTask[];
  now: Date;
}): BriefingLine[] {
  const lines: BriefingLine[] = [];

  if (input.goals.length > 0) {
    const behind = input.goals
      .filter((g) => g.pace === "behind")
      .sort((a, b) => a.progress - a.expected - (b.progress - b.expected));
    if (behind.length === 0) {
      lines.push({ tone: "ok", text: "All goals on pace for the year" });
    } else {
      // Short enough for the art's screen; the Big Goals card has the numbers.
      const more = behind.length > 1 ? ` & ${behind.length - 1} more` : "";
      lines.push({ tone: "warn", text: `${behind[0].label}${more} behind pace` });
    }
  }

  if (input.leadsToday !== null) {
    lines.push(
      input.leadsToday > 0
        ? { tone: "ok", text: `${plural(input.leadsToday, "new form submission")} today` }
        : { tone: "next", text: "No form submissions yet today" },
    );
  }

  const today = easternDate(input.now);
  const weekEnd = addDays(today, 6);
  const open = input.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.dueDate !== null && t.dueDate < today);
  const dueThisWeek = open.filter((t) => t.dueDate !== null && t.dueDate >= today && t.dueDate <= weekEnd);
  if (overdue.length > 0) {
    const also = dueThisWeek.length > 0 ? `, ${dueThisWeek.length} more this week` : "";
    lines.push({ tone: "danger", text: `${plural(overdue.length, "task")} overdue${also}` });
  } else if (dueThisWeek.length > 0) {
    lines.push({ tone: "warn", text: `${plural(dueThisWeek.length, "task")} due this week` });
  } else {
    lines.push({ tone: "ok", text: "No tasks due this week" });
  }

  const next = open
    .filter((t) => t.dueDate !== null && t.dueDate >= today)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0))[0];
  if (next) {
    // The date first: a long title is cut short on the art's screen.
    const when = next.dueDate === today ? "Due today" : shortDate(next.dueDate!);
    lines.push({ tone: "next", text: `${when}: ${next.title}` });
  }

  return lines;
}
