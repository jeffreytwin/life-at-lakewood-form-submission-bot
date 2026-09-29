import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/floorplans/writeback", () => ({ applyPendingChange: vi.fn() }));

import { homesOf } from "@/lib/floorplans/remove-plan";

// The Towns at Firethorn, sold out (Jeff, 2026-09-29): Marigold and the one home built from it.
const row = (plan_key: string, record: Record<string, unknown>) => ({ id: plan_key, plan_key, wix_record_id: `wix-${plan_key}`, record });

describe("the homes built from a plan", () => {
  const filed = [
    row("marigold", { name: "Marigold", quickMoveIn: false }),
    row("13203-stable-place", { name: "13203 Stable Place", quickMoveIn: true, relatedPlanKey: "marigold" }),
    row("13321-commons-avenue", { name: "13321 Commons Avenue", quickMoveIn: true, relatedPlanKey: "magnolia" }),
    row("magnolia", { name: "Magnolia", quickMoveIn: false }),
  ];

  it("are the homes that name the plan by its key", () => {
    expect(homesOf("marigold", filed).map((r) => r.plan_key)).toEqual(["13203-stable-place"]);
  });

  it("are none for a plan no home is built from", () => {
    expect(homesOf("anastasia", filed)).toEqual([]);
  });

  it("never include a plan", () => {
    expect(homesOf("magnolia", [...filed, row("magnolia-2", { quickMoveIn: false, relatedPlanKey: "magnolia" })]).map((r) => r.plan_key)).toEqual([
      "13321-commons-avenue",
    ]);
  });
});
