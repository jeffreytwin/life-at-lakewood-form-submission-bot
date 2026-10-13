import { beforeEach, describe, expect, it, vi } from "vitest";

// What reaches fp_unconfirmed_changes, and what a failed write does.
const written: { op: string; rows?: unknown }[] = [];
let failUpsert = false;

vi.mock("@/lib/supabase/client", () => {
  const chain = (op: string, rows?: unknown) => {
    const result = { error: op === "upsert" && failUpsert ? { message: "permission denied" } : null };
    const c: Record<string, unknown> = {};
    for (const step of ["match", "in", "eq", "lt"]) c[step] = () => c;
    c.then = (resolve: (value: typeof result) => unknown) => {
      written.push({ op, rows });
      return resolve(result);
    };
    return c;
  };
  return {
    supabase: {
      from: () => ({
        upsert: (rows: unknown) => chain("upsert", rows),
        update: (rows: unknown) => chain("update", rows),
        delete: () => chain("delete"),
      }),
    },
  };
});

import { keepSightings, type Confirmation } from "@/lib/floorplans/confirm-reads";

const ids = { site_id: "s", community_id: "c", builder_id: "b", plan_key: "the-truman" };
const gate: Confirmation = {
  confirmed: [],
  held: [],
  remember: [
    { label: "photos", newValue: "1 photo · e3422460", runs: 2, firstSeenAt: "2026-10-12T07:00:00.000Z" },
    { label: "description", newValue: "New words… · 22222222", runs: 1, firstSeenAt: "2026-10-14T07:00:00.000Z" },
  ],
  interrupted: ["blueprints"],
  forget: [],
};

beforeEach(() => {
  written.length = 0;
  failUpsert = false;
});

describe("keepSightings", () => {
  it("writes every column on every row it keeps, the start of each count with it", async () => {
    expect(await keepSightings(ids, gate, "run-2")).toBe(true);
    const upsert = written.find((w) => w.op === "upsert")!.rows as Record<string, unknown>[];
    expect(upsert.map((r) => Object.keys(r).sort())).toEqual([Object.keys(upsert[0]).sort(), Object.keys(upsert[0]).sort()]);
    expect(upsert.map((r) => r.first_seen_at)).toEqual(["2026-10-12T07:00:00.000Z", "2026-10-14T07:00:00.000Z"]);
    expect(written.find((w) => w.op === "update")!.rows).toEqual({ new_value: null, run_id: "run-2" });
  });

  it("says so when what it held could not be kept, so the run queues it instead", async () => {
    failUpsert = true;
    expect(await keepSightings(ids, gate, "run-2")).toBe(false);
  });
});
