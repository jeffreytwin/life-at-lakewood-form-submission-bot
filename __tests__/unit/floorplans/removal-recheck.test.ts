import { describe, expect, it } from "vitest";
import { decideRemovals, doubleCheckedFlag, looksSuspicious, recheckOwed, RECHECK_AFTER_MS, suspiciousFlag } from "@/lib/floorplans/removal-recheck";

const NOW = Date.parse("2026-10-27T10:00:00Z");
const HOUR = RECHECK_AFTER_MS;
const iso = (ms: number) => new Date(ms).toISOString();
const nothingHeld = { keys: null, recheckAt: null };
const onFile = { plans: 12, homes: 8 };
const plans = (...keys: string[]) => keys.map((key) => ({ key, quickMoveIn: false }));
const homes = (...keys: string[]) => keys.map((key) => ({ key, quickMoveIn: true }));

describe("which removals look like a page that did not load", () => {
  it("is two floor plans at once", () => {
    expect(looksSuspicious({ plans: 1, homes: 0 }, onFile)).toBe(false);
    expect(looksSuspicious({ plans: 2, homes: 0 }, onFile)).toBe(true);
  });

  it("is four quick move-ins at once, or half of them, since homes sell every week", () => {
    expect(looksSuspicious({ plans: 0, homes: 2 }, onFile)).toBe(false);
    expect(looksSuspicious({ plans: 0, homes: 3 }, onFile)).toBe(false);
    expect(looksSuspicious({ plans: 0, homes: 4 }, onFile)).toBe(true);
    expect(looksSuspicious({ plans: 0, homes: 3 }, { plans: 12, homes: 6 })).toBe(true);
    expect(looksSuspicious({ plans: 1, homes: 2 }, onFile)).toBe(false);
  });
});

// A page drew part of its list and its run came through "ok", every plan it
// missed queued for removal; a Run pressed again read them all (Jeff, 2026-10-27).
describe("removals from one run", () => {
  it("queues a sold home or two as before, unflagged", () => {
    expect(decideRemovals(homes("12589-oak-hill-way", "12362-oak-hill-way"), onFile, nothingHeld, new Set(), NOW)).toEqual({
      queue: ["12589-oak-hill-way", "12362-oak-hill-way"],
      suspicious: [],
      confirmed: [],
      hold: [],
      recheckAt: null,
    });
  });

  it("queues a bunch too, flagged as suspicious, with a re-check an hour later", () => {
    const d = decideRemovals([...plans("a", "b"), ...homes("c", "d")], onFile, nothingHeld, new Set(), NOW);
    expect(d.queue).toEqual(["a", "b", "c", "d"]);
    expect(d.suspicious).toEqual(["a", "b", "c", "d"]);
    expect(d.hold).toEqual(["a", "b", "c", "d"]);
    expect(d.recheckAt).toBe(iso(NOW + HOUR));
  });

  it("flags as double-checked on the re-check what is still missing", () => {
    const held = { keys: ["a", "b", "c", "d"], recheckAt: iso(NOW) };
    const queued = new Set(["a", "b", "c", "d"]);
    expect(decideRemovals(plans("b"), onFile, held, queued, NOW + 1000)).toEqual({ queue: ["b"], suspicious: [], confirmed: ["b"], hold: [], recheckAt: null });
    expect(decideRemovals([], onFile, held, queued, NOW + 1000)).toEqual({ queue: [], suspicious: [], confirmed: [], hold: [], recheckAt: null });
  });

  it("confirms nothing on a run before the hour is up; what goes missing meanwhile waits too", () => {
    const held = { keys: ["a", "b", "c"], recheckAt: iso(NOW + HOUR) };
    const d = decideRemovals(plans("a", "b", "e"), onFile, held, new Set(["a", "b", "c"]), NOW + 10 * 60 * 1000);
    expect(d.queue).toEqual(["a", "b", "e"]);
    expect(d.suspicious).toEqual(["e"]);
    expect(d.confirmed).toEqual([]);
    expect(d.hold).toEqual(["a", "b", "e"]);
    expect(d.recheckAt).toBe(held.recheckAt);
  });

  it("starts afresh when every plan waiting was read again before the hour", () => {
    const held = { keys: ["a", "b", "c"], recheckAt: iso(NOW + HOUR) };
    expect(decideRemovals(plans("z"), onFile, held, new Set(), NOW)).toMatchObject({ queue: ["z"], suspicious: [], recheckAt: null });
  });

  it("flags a new bunch the re-check finds, besides confirming the old", () => {
    const held = { keys: ["a", "b", "c"], recheckAt: iso(NOW) };
    const d = decideRemovals(plans("a", "x", "y", "z"), onFile, held, new Set(["a", "b", "c"]), NOW);
    expect(d.confirmed).toEqual(["a"]);
    expect(d.suspicious).toEqual(["x", "y", "z"]);
    expect(d.recheckAt).toBe(iso(NOW + HOUR));
  });

  it("does not flag again, night after night, removals still waiting in the queue", () => {
    const d = decideRemovals(plans("a", "b", "c"), onFile, nothingHeld, new Set(["a", "b", "c"]), NOW);
    expect(d).toEqual({ queue: ["a", "b", "c"], suspicious: [], confirmed: [], hold: [], recheckAt: null });
  });
});

describe("the reviewer's note on a removal", () => {
  it("says what went missing and when it is checked again, then that it was", () => {
    const batch = [...plans("a", "b"), ...homes("c")];
    expect(suspiciousFlag(batch, "2026-10-27T07:14:00Z")).toBe(
      "Suspicious: 2 floor plans and 1 quick move-in went missing at once; the page may not have loaded in full. The sync checks again at 3:14 AM and withdraws any it finds."
    );
    expect(doubleCheckedFlag(plans("a"), "2026-10-27T07:14:00Z")).toBe(
      "Double-checked: 1 floor plan went missing at once at 2:14 AM and was still missing on a re-check at 3:14 AM. Worth confirming on the builder's page before approving."
    );
  });
});

describe("whether a connection is owed its re-check", () => {
  const row = { removals_held: ["a", "b", "c"], removal_recheck_at: iso(NOW), last_run_at: iso(NOW - HOUR), last_run_status: "ok: 17 plans, 3 changes queued, 3 removals to check again at 6:00 AM" };

  it("is once the hour is up and no run has been made since", () => {
    expect(recheckOwed(row, NOW - 1)).toBe(false);
    expect(recheckOwed(row, NOW)).toBe(true);
    expect(recheckOwed({ ...row, last_run_at: iso(NOW + 60_000), last_run_status: "error: page timed out" }, NOW + 120_000)).toBe(false);
  });

  it("is not with nothing held, nor after a re-check cut off by the time limit", () => {
    expect(recheckOwed({ ...row, removals_held: null }, NOW)).toBe(false);
    expect(recheckOwed({ ...row, last_run_status: "cut off: the run was still going when its five minutes ran out" }, NOW)).toBe(false);
  });
});
