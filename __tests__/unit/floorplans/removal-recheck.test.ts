import { describe, expect, it } from "vitest";
import { decideRemovals, looksSuspicious, recheckOwed, RECHECK_AFTER_MS } from "@/lib/floorplans/removal-recheck";

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
  it("queues a sold home or two as before", () => {
    expect(decideRemovals(homes("12589-oak-hill-way", "12362-oak-hill-way"), onFile, nothingHeld, NOW)).toEqual({ queue: ["12589-oak-hill-way", "12362-oak-hill-way"], hold: [], recheckAt: null, confirmed: 0 });
  });

  it("holds a bunch for a re-check an hour later, queuing none", () => {
    const d = decideRemovals([...plans("a", "b"), ...homes("c", "d")], onFile, nothingHeld, NOW);
    expect(d.queue).toEqual([]);
    expect(d.hold).toEqual(["a", "b", "c", "d"]);
    expect(d.recheckAt).toBe(iso(NOW + HOUR));
  });

  it("queues on the re-check what is still missing, and lets go of what was read again", () => {
    const held = { keys: ["a", "b", "c", "d"], recheckAt: iso(NOW) };
    expect(decideRemovals(plans("b"), onFile, held, NOW + 1000)).toEqual({ queue: ["b"], hold: [], recheckAt: null, confirmed: 1 });
    expect(decideRemovals([], onFile, held, NOW + 1000)).toEqual({ queue: [], hold: [], recheckAt: null, confirmed: 0 });
    expect(decideRemovals(plans("a", "b", "c", "d"), onFile, held, NOW + 1000).queue).toEqual(["a", "b", "c", "d"]);
  });

  it("decides nothing on a run before the hour is up", () => {
    const held = { keys: ["a", "b", "c"], recheckAt: iso(NOW + HOUR) };
    const d = decideRemovals(plans("a", "b", "e"), onFile, held, NOW + 10 * 60 * 1000);
    expect(d.queue).toEqual([]);
    expect(d.hold).toEqual(["a", "b", "e"]);
    expect(d.recheckAt).toBe(held.recheckAt);
  });

  it("starts afresh when every held plan was read again before the hour", () => {
    const held = { keys: ["a", "b", "c"], recheckAt: iso(NOW + HOUR) };
    expect(decideRemovals(plans("z"), onFile, held, NOW).queue).toEqual(["z"]);
  });

  it("holds a new bunch the re-check finds, besides queuing what it confirmed", () => {
    const held = { keys: ["a", "b", "c"], recheckAt: iso(NOW) };
    const d = decideRemovals(plans("a", "x", "y", "z"), onFile, held, NOW);
    expect(d.queue).toEqual(["a"]);
    expect(d.hold).toEqual(["x", "y", "z"]);
    expect(d.recheckAt).toBe(iso(NOW + HOUR));
  });
});

describe("whether a connection is owed its re-check", () => {
  const row = { removals_held: ["a", "b", "c"], removal_recheck_at: iso(NOW), last_run_at: iso(NOW - HOUR), last_run_status: "suspicious: 17 plans" };

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
