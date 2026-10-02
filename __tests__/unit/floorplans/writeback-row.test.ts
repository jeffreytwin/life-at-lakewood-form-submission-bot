import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { wixRowFor, type ProposedRecord, type WixRowContext } from "@/lib/floorplans/writeback";

const button = "wix:image://v1/d0be81_f37e576d0a224925bac66562ec8cd2bc~mv2.png/Virtual%20Tour%20Button%20-%20Parrish.png";
const rec = (over: Partial<ProposedRecord> = {}): ProposedRecord => ({
  planKey: "siesta-oakfield-trails-signature", name: "Siesta (Oakfield Trails Signature)", price: 496240, priceDisplay: "$496,240",
  beds: "4", baths: "3", sqft: 2534, garages: "2 car", homeType: "Single Family Home", quickMoveIn: false,
  sourceUrl: null, galleryImages: [], ...over,
});
const ctx = (tourImage: string | null): WixRowContext => ({
  communityName: "Oakfield", builderName: "Ashton Woods", urlSlug: "siesta", gallery: [], blueprints: [], tourImage,
  basePlanName: null, refs: { builderId: null, villageId: null },
});
// What Wix is sent: an undefined field is not.
const sent = (row: Record<string, unknown>) => JSON.parse(JSON.stringify(row)) as Record<string, unknown>;

describe("wixRowFor: the virtual tour link and its button go together (Jeff, 2026-10-02)", () => {
  // Both Siestas at Oakfield lost Plant's and Brickell's tours and kept the button.
  const row = { virtualTourLink: "https://my.matterport.com/show/?m=N1ZYSGXAVVS", virtualTourImageV2: button, score: 7 };

  it("takes the button off a row whose tour comes off", () => {
    const out = sent(wixRowFor(row, rec({ virtualTourUrl: null }), ctx(null)));
    expect(out).not.toHaveProperty("virtualTourLink");
    expect(out).not.toHaveProperty("virtualTourImageV2");
    // A field the pipeline does not own stays.
    expect(out.score).toBe(7);
  });

  it("gives a row with a tour its button", () => {
    const out = sent(wixRowFor({}, rec({ virtualTourUrl: "https://my.matterport.com/show/?m=PGRgMuog2b1" }), ctx(button)));
    expect(out).toMatchObject({ virtualTourLink: "https://my.matterport.com/show/?m=PGRgMuog2b1", virtualTourImageV2: button });
  });
});
