import { describe, expect, it } from "vitest";
import { cycleInProgress, nightlyDue } from "@/lib/floorplans/nightly";
import { RUN_HELD_MS, runGoing } from "@/lib/floorplans/run-state";

// September: Eastern time is four hours behind UTC.
const at = (iso: string) => new Date(iso);
const on = { fp_nightly_enabled: true, fp_nightly_hour: 2 };

describe("the sync cycle (Sync now, Jeff 2026-09-25)", () => {
  it("is going from its start until it completes", () => {
    expect(cycleInProgress(null)).toBe(false);
    expect(cycleInProgress({ startedAt: "2026-09-25T17:00:00Z" })).toBe(true);
    expect(cycleInProgress({ startedAt: "2026-09-25T17:00:00Z", completedAt: "2026-09-25T17:40:00Z" })).toBe(false);
  });

  it("owes tonight's cycle once the hour has come, until a cycle begun since then completes", () => {
    const lastNight = { startedAt: "2026-09-24T06:00:00Z", completedAt: "2026-09-24T07:04:00Z" };
    expect(nightlyDue(lastNight, on, at("2026-09-25T05:30:00Z"))).toBe(false); // 1:30 ET
    expect(nightlyDue(lastNight, on, at("2026-09-25T06:01:00Z"))).toBe(true); // 2:01 ET
    const tonight = { startedAt: "2026-09-25T06:00:19Z", completedAt: "2026-09-25T07:04:20Z" };
    expect(nightlyDue(tonight, on, at("2026-09-25T17:00:00Z"))).toBe(false);
  });

  it("counts a Sync now pressed after the hour as tonight's, and not one pressed before it", () => {
    const afternoon = { startedAt: "2026-09-25T17:00:00Z", completedAt: "2026-09-25T17:30:00Z", manual: true };
    expect(nightlyDue(afternoon, on, at("2026-09-25T20:00:00Z"))).toBe(false);
    const early = { startedAt: "2026-09-25T05:00:00Z", completedAt: "2026-09-25T05:40:00Z", manual: true }; // 1:00 ET
    expect(nightlyDue(early, on, at("2026-09-25T06:05:00Z"))).toBe(true);
  });

  it("owes nothing while a cycle is going or with the nightly sync off", () => {
    expect(nightlyDue({ startedAt: "2026-09-25T17:00:00Z", manual: true }, on, at("2026-09-26T06:30:00Z"))).toBe(false);
    expect(nightlyDue(null, { ...on, fp_nightly_enabled: false }, at("2026-09-25T06:30:00Z"))).toBe(false);
  });
});

describe("a run's mark (runs.ts)", () => {
  it("says a run is going until it is older than any function lives", () => {
    const now = Date.parse("2026-09-25T17:10:00Z");
    expect(runGoing(null, now)).toBe(false);
    expect(runGoing("2026-09-25T17:08:00Z", now)).toBe(true);
    expect(runGoing(new Date(now - RUN_HELD_MS - 1).toISOString(), now)).toBe(false);
  });
});
