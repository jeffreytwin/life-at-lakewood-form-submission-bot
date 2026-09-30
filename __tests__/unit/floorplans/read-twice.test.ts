import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { readTwice, RUN_READ_MS, timeForAnotherRead } from "@/lib/floorplans/sync";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// Neal Signature's Waterbury Park, drawn once without its plan cards (Jeff, 2026-09-30).
const where = { builder: "Neal Signature Homes", community: "Waterbury Park" };
const plan = { planKey: "seaside", name: "Seaside" } as NormalizedPlan;
const noPause = async () => {};

describe("a run that read nothing reads once more before it fails", () => {
  it("reads again after a first read that found no plans, and takes the second", async () => {
    const read = vi.fn<() => Promise<NormalizedPlan[]>>().mockResolvedValueOnce([]).mockResolvedValueOnce([plan]);
    expect(await readTwice(read, Date.now(), where, noPause)).toEqual([plan]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads again after a first read that failed", async () => {
    const read = vi.fn<() => Promise<NormalizedPlan[]>>().mockRejectedValueOnce(new Error("page timed out")).mockResolvedValueOnce([plan]);
    expect(await readTwice(read, Date.now(), where, noPause)).toEqual([plan]);
  });

  it("reads once when the first read found plans", async () => {
    const read = vi.fn<() => Promise<NormalizedPlan[]>>().mockResolvedValue([plan]);
    await readTwice(read, Date.now(), where, noPause);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("fails as before when the second read fails too", async () => {
    const read = vi.fn<() => Promise<NormalizedPlan[]>>().mockResolvedValue([]);
    expect(await readTwice(read, Date.now(), where, noPause)).toEqual([]);
    const broken = vi.fn<() => Promise<NormalizedPlan[]>>().mockRejectedValue(new Error("fetch: 500"));
    await expect(readTwice(broken, Date.now(), where, noPause)).rejects.toThrow("fetch: 500");
    expect(broken).toHaveBeenCalledTimes(2);
  });

  it("does not read again when the run's reading time is nearly spent", async () => {
    const late = Date.now() - RUN_READ_MS + 30_000;
    expect(timeForAnotherRead(late)).toBe(false);
    const read = vi.fn<() => Promise<NormalizedPlan[]>>().mockResolvedValue([]);
    expect(await readTwice(read, late, where, noPause)).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
