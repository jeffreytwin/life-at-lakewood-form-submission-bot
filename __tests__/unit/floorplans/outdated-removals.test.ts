import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { outdatedRemovals } from "@/lib/floorplans/sync";

// Calusa Country Club's removals queued for Lennar's "Future release" plans,
// then kept after all (Jeff, 2026-10-09).
describe("a removal queued for a plan the builder lists again", () => {
  it("is outdated when the run read the plan, and stands when it did not", () => {
    const removals = [
      { id: "1", plan_key: "the-stanford" },
      { id: "2", plan_key: "angelina" },
      { id: "3", plan_key: "pelican" },
    ];
    const read = new Set(["the-stanford", "angelina", "the-richmond"]);
    expect(outdatedRemovals(removals, read).map((r) => r.id)).toEqual(["1", "2"]);
    expect(outdatedRemovals(removals, new Set())).toEqual([]);
  });
});
