import { describe, it, expect, vi } from "vitest";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { from } }));

import { neutralizeDescriptions } from "@/lib/floorplans/description";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const plan = (description: string | null): NormalizedPlan => ({
  planKey: "lori",
  name: "Lori",
  price: null,
  priceDisplay: null,
  beds: "3",
  baths: "2",
  sqft: 2000,
  garages: null,
  homeType: null,
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: null,
  galleryImages: [],
  blueprintImages: [],
  description,
});

describe("neutralizeDescriptions past the run's deadline (2026-09-23)", () => {
  it("starts no rewording once the run is out of time, and leaves every plan as it was", async () => {
    const plans = [plan("Our Lori plan features a great room."), plan("The Lori has a den."), plan(null)];
    const out = await neutralizeDescriptions(plans, "Perry Homes", Date.now() - 1);
    expect(out).toEqual(plans);
    expect(from).not.toHaveBeenCalled();
  });
});
