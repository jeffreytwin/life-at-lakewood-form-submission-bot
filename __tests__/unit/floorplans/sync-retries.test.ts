import { describe, it, expect, vi, beforeEach } from "vitest";

// Richmond American's Estates at Rivers Edge (Jeff, 2026-10-24: "is not
// retried until I do it myself"): a run that fails is run once more before
// the cycle completes.

type Call = [string, unknown[]];
const db = vi.hoisted(() => {
  const state = {
    settings: {} as Record<string, unknown>,
    /** What each query of the connections answers, by the filter that tells them apart. */
    retries: [] as Record<string, unknown>[],
    rereads: [] as Record<string, unknown>[],
    saved: [] as Record<string, unknown>[],
  };
  const respond = (table: string, calls: Call[]) => {
    const used = (m: string) => calls.some(([name]) => name === m);
    if (table === "system_settings") {
      const update = calls.find(([name]) => name === "update");
      if (update) {
        const row = update[1][0] as Record<string, unknown>;
        if (row.fp_nightly_state) state.saved.push(structuredClone(row.fp_nightly_state as Record<string, unknown>));
        // The tick's lock is taken.
        return { data: used("or") ? [{ id: 1 }] : null, error: null };
      }
      return { data: state.settings, error: null };
    }
    if (table === "fp_builder_communities") {
      if (used("or")) return { data: [], error: null }; // owedRuns: every connection has had its run
      if (used("ilike")) return { data: state.rereads, error: null }; // secondReadingsOwed
      if (used("gte") && used("gt")) return { data: state.retries, error: null }; // retriesOwed
      return { data: [], error: null }; // the digest's failing connections
    }
    return { data: [], count: 0, error: null };
  };
  const from = vi.fn((table: string) => {
    const calls: Call[] = [];
    const api: Record<string, unknown> = {};
    for (const m of ["select", "update", "eq", "or", "not", "gte", "gt", "lt", "ilike", "like", "order", "limit", "is", "in"]) {
      api[m] = (...args: unknown[]) => {
        calls.push([m, args]);
        return api;
      };
    }
    api.single = async () => respond(table, calls);
    api.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(respond(table, calls)).then(resolve, reject);
    return api;
  });
  return { state, from };
});
vi.mock("@/lib/supabase/client", () => ({ supabase: { from: db.from } }));

const runs = vi.hoisted(() => ({ holdRun: vi.fn(), runHeld: vi.fn(), sweepCutOffRuns: vi.fn() }));
vi.mock("@/lib/floorplans/runs", () => runs);
vi.mock("@/lib/floorplans/sync", () => ({ readsThroughBrowser: () => false }));
vi.mock("@/lib/floorplans/ai-usage", () => ({ totalsSince: async () => null }));
vi.mock("@/lib/floorplans/writeback", () => ({ applyPendingChange: vi.fn() }));

import { runNightlyTick } from "@/lib/floorplans/nightly";
import { runContext } from "@/lib/floorplans/run-context";

const estates = { id: "estates", extractor_params: null, fp_builders: { name: "Richmond American Homes", active: true, extraction_method: "render_claude" } };
const startedAt = "2026-10-24T06:00:00Z";
const cycle = (extra: Record<string, unknown> = {}) => ({
  fp_nightly_enabled: true,
  fp_nightly_hour: 2,
  fp_digest_phone: null,
  fp_nightly_state: { cycleDate: "2026-10-24", startedAt, ran: 101, failed: 1, ...extra },
});
const lastSaved = () => db.state.saved[db.state.saved.length - 1];

let seen: { id: string; secondReading: boolean; retriedWhenRun: unknown }[] = [];
beforeEach(() => {
  db.state.saved = [];
  db.state.retries = [];
  db.state.rereads = [];
  seen = [];
  runs.sweepCutOffRuns.mockResolvedValue(0);
  runs.holdRun.mockResolvedValue(true);
  runs.runHeld.mockImplementation(async (id: string) => {
    seen.push({ id, secondReading: Boolean(runContext()?.secondReading), retriedWhenRun: lastSaved()?.retried });
    return { status: "ok", detail: "ok: 15 plans" };
  });
});

describe("a run that failed in the cycle", () => {
  it("is run once more, marked before it runs, and no longer counted as failed once it comes back well", async () => {
    db.state.settings = cycle();
    db.state.retries = [estates];
    const result = await runNightlyTick();
    expect(seen).toEqual([{ id: "estates", secondReading: false, retriedWhenRun: ["estates"] }]);
    expect(result).toMatchObject({ complete: true, failed: 0 });
    expect(lastSaved()).toMatchObject({ retried: ["estates"], failed: 0 });
    expect(lastSaved().completedAt).toBeTruthy();
  });

  it("is not run again once it has had its second run", async () => {
    db.state.settings = cycle({ retried: ["estates"] });
    db.state.retries = [estates];
    expect(await runNightlyTick()).toMatchObject({ complete: true, failed: 1 });
    expect(seen).toEqual([]);
  });

  it("stays counted as failed when its second run fails too", async () => {
    db.state.settings = cycle();
    db.state.retries = [estates];
    runs.runHeld.mockResolvedValue({ status: "partial", detail: "partial: 5 of the 15 plans found last time" });
    expect(await runNightlyTick()).toMatchObject({ complete: true, failed: 1 });
  });

  it("is run before the second readings, so what its run holds is read a second time the same night", async () => {
    db.state.settings = cycle();
    db.state.retries = [estates];
    db.state.rereads = [{ ...estates, id: "legacy-preserve" }];
    await runNightlyTick();
    expect(seen.map((s) => [s.id, s.secondReading])).toEqual([
      ["estates", false],
      ["legacy-preserve", true],
    ]);
  });

  it("waits for the next tick while a person's Run has it", async () => {
    db.state.settings = cycle();
    db.state.retries = [estates];
    runs.holdRun.mockResolvedValue(false);
    expect(await runNightlyTick()).toMatchObject({ complete: false, busy: 1 });
    expect(seen).toEqual([]);
  });
});
