import { describe, expect, it } from "vitest";
import {
  addToTally,
  batchDelay,
  cascadeDelay,
  clearedIn,
  countWritten,
  easternDay,
  emptyTally,
  exitDuration,
  foldDuration,
  isWritten,
  progressOf,
  readTally,
  tallyLine,
  takeFromTally,
  withHeld,
  writeSettled,
} from "@/lib/floorplans/leaving-rows";

/**
 * Jeff, 2026-09-29: getting the pending floor plans done should be fun.
 * Approve, Reject and Remove each play their own way out of the list and
 * the day's tally fills toward an empty queue. These are the rules the page
 * leans on to do that without ever showing a plan as done when it is not.
 */
const row = (id: string, created_at: string, plan_key = id) => ({
  id,
  site_id: "s1",
  community_id: "c1",
  builder_id: "b1",
  plan_key,
  change_type: "update" as const,
  status: "pending",
  created_at,
});

describe("withHeld", () => {
  it("puts a row still leaving the screen back in its place, newest first", () => {
    const fresh = [row("a", "2026-09-29T12:00:00Z"), row("c", "2026-09-29T10:00:00Z")];
    const held = [row("b", "2026-09-29T11:00:00Z")];
    expect(withHeld(fresh, held).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("orders rows queued in the same moment by id, as the list route does", () => {
    const at = "2026-09-29T12:00:00Z";
    const fresh = [row("a1", at), row("a3", at)];
    expect(withHeld(fresh, [row("a2", at)]).map((r) => r.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("never lists a row twice when the server still has it", () => {
    const fresh = [row("a", "2026-09-29T12:00:00Z")];
    expect(withHeld(fresh, [row("a", "2026-09-29T12:00:00Z")])).toHaveLength(1);
  });

  it("hands back the server's list untouched when nothing is held", () => {
    const fresh = [row("a", "2026-09-29T12:00:00Z")];
    expect(withHeld(fresh, [])).toBe(fresh);
  });
});

describe("countWritten", () => {
  it("counts the plans written to Wix, a draft included", () => {
    expect(
      countWritten([
        { planKey: "a", status: "synced" },
        { planKey: "b", status: "synced_draft" },
        { planKey: "c", status: "failed" },
        { planKey: "d", status: "blocked" },
        { planKey: "e", status: "deferred" },
      ])
    ).toBe(2);
  });

  it("counts nothing from a failed request", () => {
    expect(countWritten(undefined)).toBe(0);
    expect(countWritten([null, "synced", { status: 1 }])).toBe(0);
  });
});

describe("an Approve All write, asked about", () => {
  it("is written once synced, a draft included", () => {
    expect(isWritten("synced")).toBe(true);
    expect(isWritten("synced_draft")).toBe(true);
    expect(isWritten("failed")).toBe(false);
    expect(isWritten(undefined)).toBe(false);
  });

  it("is still under way while marked approved, which is before the write lands", () => {
    expect(writeSettled("approved")).toBe(false);
    expect(writeSettled("approving")).toBe(false);
    expect(writeSettled(undefined)).toBe(false);
    for (const done of ["synced", "failed", "pending", "rejected"]) expect(writeSettled(done)).toBe(true);
  });
});

describe("a batch's rows, one after another (Jeff, 2026-09-30)", () => {
  const starts = (exit: Parameters<typeof batchDelay>[0], count: number) =>
    Array.from({ length: count }, (_, i) => batchDelay(exit, i, count));

  it("plays a lone row at once", () => {
    for (const exit of ["approve", "reject", "remove", "leave"] as const) expect(batchDelay(exit, 0, 1)).toBe(0);
  });

  it("stacks a rejected batch like a held-down menu key, over in a second and a half however big", () => {
    const small = starts("reject", 5);
    expect(small[1] - small[0]).toBeLessThanOrEqual(60);
    const page = starts("reject", 50);
    expect(page[49]).toBeLessThanOrEqual(1500);
    expect(page[1]).toBeGreaterThan(0);
  });

  it("sends approvals one at a time, spread across the gap to the next read", () => {
    const three = starts("approve", 3);
    expect(three[1] - three[0]).toBeGreaterThanOrEqual(300);
    expect(starts("approve", 20)[19]).toBeLessThanOrEqual(2700);
  });

  it("blows a removal's quick move-ins up one after another", () => {
    expect(starts("remove", 3)).toEqual([0, 400, 800]);
  });
});

describe("timing", () => {
  it("sends a batch out as a wave that stops growing after ten rows", () => {
    expect(cascadeDelay(0)).toBe(0);
    expect(cascadeDelay(1)).toBeGreaterThan(0);
    expect(cascadeDelay(10)).toBe(cascadeDelay(40));
  });

  it("keeps reduced motion to a short fade with no fold", () => {
    expect(exitDuration("remove", true)).toBeLessThan(exitDuration("remove", false));
    expect(foldDuration(true)).toBe(0);
    expect(foldDuration(false)).toBeGreaterThan(0);
  });
});

describe("the day's tally", () => {
  it("reads the day in Lakewood Ranch, not UTC", () => {
    // 10:30 pm on the 29th in Florida is already the 30th in UTC.
    expect(easternDay(new Date("2026-09-30T02:30:00Z"))).toBe("2026-09-29");
    expect(easternDay(new Date("2026-09-30T04:30:00Z"))).toBe("2026-09-30");
  });

  it("adds each kind of clear to its own count", () => {
    let t = addToTally(null, "approve", 3, "2026-09-29");
    t = addToTally(t, "reject", 1, "2026-09-29");
    t = addToTally(t, "remove", 2, "2026-09-29");
    expect(t).toEqual({ day: "2026-09-29", approved: 3, rejected: 1, removed: 2 });
    expect(clearedIn(t)).toBe(6);
  });

  it("takes back a plan counted on the click whose answer did not bear it out (Jeff, 2026-10-01)", () => {
    const t = { day: "2026-09-29", approved: 3, rejected: 1, removed: 0 };
    expect(takeFromTally(t, "approve", 1, "2026-09-29")).toEqual({ ...t, approved: 2 });
    expect(takeFromTally(t, "remove", 1, "2026-09-29")).toEqual(t);
    expect(takeFromTally(null, "reject", 1, "2026-09-29")).toEqual(emptyTally("2026-09-29"));
    expect(takeFromTally(t, "approve", 1, "2026-09-30")).toEqual(emptyTally("2026-09-30"));
  });

  it("starts over on a new day", () => {
    const yesterday = { day: "2026-09-28", approved: 40, rejected: 2, removed: 0 };
    expect(addToTally(yesterday, "approve", 1, "2026-09-29")).toEqual({
      day: "2026-09-29",
      approved: 1,
      rejected: 0,
      removed: 0,
    });
  });

  it("keeps only today's tally from the browser, and nothing it cannot read", () => {
    const kept = JSON.stringify({ day: "2026-09-29", approved: 5, rejected: 1, removed: 0 });
    expect(readTally(kept, "2026-09-29")).toEqual({ day: "2026-09-29", approved: 5, rejected: 1, removed: 0 });
    expect(readTally(kept, "2026-09-30")).toEqual(emptyTally("2026-09-30"));
    expect(readTally("{not json", "2026-09-29")).toEqual(emptyTally("2026-09-29"));
    expect(readTally(JSON.stringify({ day: "2026-09-29", approved: -2, rejected: 0, removed: 0 }), "2026-09-29")).toEqual(
      emptyTally("2026-09-29")
    );
    expect(readTally(null, "2026-09-29")).toEqual(emptyTally("2026-09-29"));
  });

  it("says what was cleared, leaving out the kinds with none", () => {
    expect(tallyLine({ day: "2026-09-29", approved: 12, rejected: 0, removed: 1 })).toBe("12 approved · 1 removed");
    expect(tallyLine(emptyTally("2026-09-29"))).toBe("");
  });

  it("measures progress as cleared over cleared plus waiting", () => {
    expect(progressOf(0, 40)).toBe(0);
    expect(progressOf(10, 30)).toBe(0.25);
    expect(progressOf(12, 0)).toBe(1);
    expect(progressOf(0, 0)).toBe(1);
  });
});
