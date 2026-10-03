import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { homeGuardsOf, type RemovalGuard } from "@/lib/floorplans/removal-guards";

// Lennar's Columbia at Prosperity Lakes, removed with 12449 Teal Topaz Trl on 9/30 (Jeff, 2026-10-03).
const guard = (id: string, run_id: string | null, proposed_record: RemovalGuard["proposed_record"]): RemovalGuard => ({ id, run_id, proposed_record });

describe("the Remove button's rejections of a plan's homes", () => {
  const guards = [
    guard("columbia", "hub-remove-1790790255185", { quickMoveIn: false }),
    guard("12449-teal-topaz-trl", "hub-remove-1790790255185", { quickMoveIn: true, relatedPlanKey: "columbia" }),
    guard("12545-teal-topaz-trl", "hub-remove-1790790255185", { quickMoveIn: true, relatedPlanKey: "concord" }),
    guard("12433-teal-topaz-trl", "run-2026-10-01", { quickMoveIn: true, relatedPlanKey: "columbia" }),
  ];

  it("are those of the homes built from the plan", () => {
    expect(homeGuardsOf(guards, "columbia").map((g) => g.id)).toEqual(["12449-teal-topaz-trl"]);
  });

  it("leave a rejection a person made", () => {
    expect(homeGuardsOf(guards, "columbia").some((g) => g.id === "12433-teal-topaz-trl")).toBe(false);
  });

  it("never include the plan's own", () => {
    expect(homeGuardsOf([...guards, guard("columbia-2", "hub-remove-1", { quickMoveIn: false, relatedPlanKey: "columbia" })], "columbia").map((g) => g.id)).toEqual([
      "12449-teal-topaz-trl",
    ]);
  });

  it("are none for a plan no home went with", () => {
    expect(homeGuardsOf(guards, "osprey")).toEqual([]);
    expect(homeGuardsOf([guard("x", null, null)], "columbia")).toEqual([]);
  });
});
