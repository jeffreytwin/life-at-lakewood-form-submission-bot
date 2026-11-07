import { describe, it, expect } from "vitest";
import {
  addDays,
  buildBriefing,
  goalProgress,
  monthsInPeriod,
  paceStatus,
  periodTotals,
  yearElapsed,
  type GoalProgress,
} from "@/lib/war-room/metrics";
import { monthlyMetrics } from "@/lib/war-room/sample-metrics";
import { easternMidnight } from "@/lib/war-room/store";
import { getCharacter, ALL_CHARACTER_IDS } from "@/lib/bot-characters";

// Saturday, November 7, 2026, mid-morning Eastern.
const NOW = new Date("2026-11-07T15:00:00Z");

describe("yearElapsed", () => {
  it("counts today as gone, in Eastern time", () => {
    // Nov 7 is day 311 of 365.
    expect(yearElapsed(2026, NOW)).toBeCloseTo(311 / 365, 6);
    // 11 p.m. Dec 31 Eastern is already Jan 1 in UTC: still the whole of 2026, not 2027.
    expect(yearElapsed(2026, new Date("2027-01-01T04:00:00Z"))).toBe(1);
  });

  it("is 1 for a past year and 0 for a future one", () => {
    expect(yearElapsed(2025, NOW)).toBe(1);
    expect(yearElapsed(2027, NOW)).toBe(0);
  });
});

describe("paceStatus", () => {
  it("allows a few points either side of the expected share", () => {
    expect(paceStatus(0.85, 0.85)).toBe("on_pace");
    expect(paceStatus(0.83, 0.85)).toBe("on_pace");
    expect(paceStatus(0.77, 0.85)).toBe("behind");
    expect(paceStatus(0.93, 0.85)).toBe("ahead");
  });
});

describe("sample metrics", () => {
  const months = monthlyMetrics(2026, NOW);

  it("stops at this month, scaled to the days gone", () => {
    expect(months.map((m) => m.month)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ]);
    const nov = months[10];
    expect(nov.closings).toBe(Math.round((16 * 7) / 30));
    expect(nov.adSpend).toBeLessThan(15000);
  });

  it("has no months for a year not begun", () => {
    expect(monthlyMetrics(2027, NOW)).toEqual([]);
  });

  it("keeps profit as post-split less spending", () => {
    for (const m of months) expect(m.profit).toBe(m.postSplit - m.adSpend - m.otherExpenses);
  });
});

describe("goalProgress", () => {
  it("adds the year's months up against each target", () => {
    const months = monthlyMetrics(2026, NOW);
    const [tx] = goalProgress([{ metric: "transactions", target: 175, stretchTarget: null }], months, 0.5);
    const closings = months.reduce((s, m) => s + m.closings, 0);
    expect(tx.actual).toBe(closings);
    expect(tx.progress).toBeCloseTo(closings / 175);
    expect(tx.projected).toBeCloseTo(closings / 0.5);
    expect(tx.label).toBe("Transactions");
  });
});

describe("periods", () => {
  const months = monthlyMetrics(2026, NOW);

  it("picks this month, last month, the quarter and the year", () => {
    expect(monthsInPeriod(months, "month", NOW).map((m) => m.month)).toEqual(["2026-11"]);
    expect(monthsInPeriod(months, "last_month", NOW).map((m) => m.month)).toEqual(["2026-10"]);
    expect(monthsInPeriod(months, "quarter", NOW).map((m) => m.month)).toEqual(["2026-10", "2026-11"]);
    expect(monthsInPeriod(months, "ytd", NOW)).toHaveLength(11);
  });

  it("has no last month in January: that's last year's numbers", () => {
    const jan = new Date("2026-01-15T15:00:00Z");
    expect(monthsInPeriod(monthlyMetrics(2026, jan), "last_month", jan)).toEqual([]);
  });

  it("works out ROAS, and none with no spend", () => {
    const t = periodTotals(monthsInPeriod(months, "last_month", NOW));
    expect(t.roas).toBeCloseTo(t.preSplit / t.adSpend);
    expect(periodTotals([]).roas).toBeNull();
  });
});

describe("buildBriefing", () => {
  const goal = (over: Partial<GoalProgress>): GoalProgress => ({
    metric: "transactions",
    label: "Transactions",
    target: 175,
    stretchTarget: null,
    actual: 135,
    progress: 0.77,
    expected: 0.85,
    pace: "behind",
    projected: 158,
    ...over,
  });

  it("names the goal furthest behind", () => {
    const lines = buildBriefing({
      goals: [
        goal({}),
        goal({ metric: "profit", label: "Profit", progress: 0.6, expected: 0.85 }),
        goal({ metric: "pre_split", label: "Pre-Split Revenue", progress: 0.9, pace: "ahead" }),
      ],
      leadsToday: 17,
      tasks: [],
      now: NOW,
    });
    expect(lines[0]).toEqual({ tone: "warn", text: "Profit & 1 more behind pace" });
    expect(lines[1]).toEqual({ tone: "ok", text: "17 new form submissions today" });
  });

  it("says when every goal is on pace", () => {
    const lines = buildBriefing({ goals: [goal({ pace: "on_pace" })], leadsToday: 1, tasks: [], now: NOW });
    expect(lines[0].text).toBe("All goals on pace for the year");
    expect(lines[1].text).toBe("1 new form submission today");
  });

  it("counts tasks due in the next seven days and names the next one", () => {
    const lines = buildBriefing({
      goals: [],
      leadsToday: null,
      tasks: [
        { title: "Launch YouTube pre-roll", dueDate: "2026-11-10", done: false },
        { title: "Add villages to Google Ads", dueDate: "2026-11-12", done: false },
        { title: "Stillwater exclusions", dueDate: "2026-11-18", done: false },
        { title: "Floor plan system", dueDate: "2026-11-06", done: true },
        { title: "Someday", dueDate: null, done: false },
      ],
      now: NOW,
    });
    expect(lines).toEqual([
      { tone: "warn", text: "2 tasks due this week" },
      { tone: "next", text: "Nov 10: Launch YouTube pre-roll" },
    ]);
  });

  it("puts overdue tasks first", () => {
    const lines = buildBriefing({
      goals: [],
      leadsToday: 0,
      tasks: [
        { title: "Late", dueDate: "2026-11-05", done: false },
        { title: "Today", dueDate: "2026-11-07", done: false },
      ],
      now: NOW,
    });
    expect(lines).toEqual([
      { tone: "next", text: "No form submissions yet today" },
      { tone: "danger", text: "1 task overdue, 1 more this week" },
      { tone: "next", text: "Due today: Today" },
    ]);
  });
});

describe("dates", () => {
  it("adds days across a month end", () => {
    expect(addDays("2026-11-28", 6)).toBe("2026-12-04");
  });

  it("finds midnight Eastern in both halves of the year, and on the clock-change day", () => {
    expect(easternMidnight("2026-10-31")).toBe("2026-10-31T04:00:00.000Z"); // EDT
    expect(easternMidnight("2026-11-01")).toBe("2026-11-01T04:00:00.000Z"); // clocks fall back at 2 a.m.
    expect(easternMidnight("2026-11-07")).toBe("2026-11-07T05:00:00.000Z"); // EST
    expect(easternMidnight("2026-03-08")).toBe("2026-03-08T05:00:00.000Z"); // clocks spring ahead at 2 a.m.
    expect(easternMidnight("2026-03-09")).toBe("2026-03-09T04:00:00.000Z"); // EDT
  });
});

describe.each(ALL_CHARACTER_IDS)("%s on a finished War Room task", (id) => {
  it("names the task", () => {
    const msg = getCharacter(id).getMessage({ type: "war_room_task_done", leadName: "Launch YouTube pre-roll" });
    expect(msg).toContain("Launch YouTube pre-roll");
  });
});
