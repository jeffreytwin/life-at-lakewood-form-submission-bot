import { describe, it, expect, vi } from "vitest";

// Every lookup finds a rejected change identical to the one asked about.
const chain: Record<string, unknown> = {};
for (const m of ["select", "eq", "is", "in", "match", "limit"]) chain[m] = () => chain;
chain.then = (done: (r: unknown) => unknown) => done({ data: [{ id: "r1", proposed_record: null }], error: null });
vi.mock("@/lib/supabase/client", () => ({ supabase: { from: () => chain } }));

const { stillRejected } = await import("@/lib/floorplans/sync");

const asked = { siteId: "s", communityId: "c", builderId: "b", planKey: "brooke", changeType: "update" as const };

describe("a price rejected before is proposed again (Jeff, 2026-10-15: reflect the current price from the builder)", () => {
  it("does not hold back a price at a value a person rejected", async () => {
    expect(await stillRejected({ ...asked, fieldChanged: "price", newValue: "$954,900" })).toBe(false);
  });

  it("still holds back any other field's rejected change", async () => {
    expect(await stillRejected({ ...asked, fieldChanged: "photos", newValue: "3 photos · 1a2b3c4d" })).toBe(true);
    expect(await stillRejected({ ...asked, fieldChanged: "sqft", newValue: "3,145" })).toBe(true);
  });
});
