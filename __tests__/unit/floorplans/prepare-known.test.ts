import { describe, expect, it, vi } from "vitest";

// preparePlans reads the builder's settings, its stand-in rules and the
// remembered photo rooms: none of them here.
vi.mock("@/lib/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const step of ["select", "eq", "in", "match", "is", "order", "limit"]) chain[step] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null });
  return { supabase: { from: () => chain } };
});

import { fieldChanges, type CanonicalRecord } from "@/lib/floorplans/diff";
import { knownRecordsOf } from "@/lib/floorplans/home-identity";
import { preparePlans } from "@/lib/floorplans/sync";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const scope = { site: { id: "site" }, community: { id: "community", name: "Palm Grove" }, builder: { id: "builder", name: "Neal Communities" } };

const plan = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "the-waterway",
  name: "The Waterway",
  price: 600000,
  priceDisplay: "$600,000",
  beds: "3",
  baths: "2",
  sqft: 2000,
  garages: "2 car",
  homeType: "Single-Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://www.davidweekleyhomes.com/the-waterway",
  galleryImages: [],
  blueprintImages: [],
  description: "The Waterway opens its great room to a covered lanai, with the owner's retreat off the back of the home.",
  ...over,
});

const dw = (id: string) => `https://www.davidweekleyhomes.com/media/ElevationRendering/${id}.jpg?h=800`;

describe("photos the record has keep its order in every gallery (David Weekley's Waterway, 2026-10-13)", () => {
  it("does not propose a small gallery's own photos in the page's order that night", async () => {
    const record = plan({ galleryImages: [dw("a"), dw("b"), dw("c")] });
    const [read] = await preparePlans([plan({ galleryImages: [dw("a"), dw("c"), dw("b")] })], scope, {
      rewordDescriptions: false,
      known: new Map([[record.planKey, record]]),
    });
    expect(read.galleryImages).toEqual([dw("a"), dw("b"), dw("c")]);
    expect(fieldChanges(record as CanonicalRecord, read).map((c) => c.label)).not.toContain("photos");
  });

  it("still proposes another of the record's photos the builder put in front", async () => {
    const record = plan({ galleryImages: [dw("a"), dw("b"), dw("c")] });
    const [read] = await preparePlans([plan({ galleryImages: [dw("c"), dw("b"), dw("a")] })], scope, {
      rewordDescriptions: false,
      known: new Map([[record.planKey, record]]),
    });
    expect(read.galleryImages).toEqual([dw("c"), dw("a"), dw("b")]);
    expect(fieldChanges(record as CanonicalRecord, read).map((c) => c.label)).toContain("photos");
    // A home shows its lead alone, and that is what changed.
    const home = (gallery: string[]) => plan({ quickMoveIn: true, galleryImages: gallery });
    const [lead] = await preparePlans([home([dw("c"), dw("b"), dw("a")])], scope, {
      rewordDescriptions: false,
      known: new Map([[record.planKey, home([dw("a"), dw("b"), dw("c")])]]),
    });
    expect(fieldChanges(home([dw("a"), dw("b"), dw("c")]) as CanonicalRecord, lead).map((c) => c.label)).toContain("photos");
  });

  it("still brings in a new photo where the page put it, and leads with a new lead", async () => {
    const record = plan({ galleryImages: [dw("a"), dw("b"), dw("c")] });
    const [read] = await preparePlans([plan({ galleryImages: [dw("new"), dw("b"), dw("a"), dw("c")] })], scope, {
      rewordDescriptions: false,
      known: new Map([[record.planKey, record]]),
    });
    expect(read.galleryImages).toEqual([dw("new"), dw("a"), dw("b"), dw("c")]);
    expect(fieldChanges(record as CanonicalRecord, read).map((c) => c.label)).toContain("photos");
  });

  it("keeps the page's order for a plan the site does not have yet", async () => {
    const [read] = await preparePlans([plan({ galleryImages: [dw("c"), dw("a")] })], scope, { rewordDescriptions: false, known: new Map() });
    expect(read.galleryImages).toEqual([dw("c"), dw("a")]);
  });
});

describe("a home read under another name keeps what its record knows about its photos (2131 Sylvester Palm Lane, 2026-10-13)", () => {
  const page = "https://nealcommunities.com/new-homes/palm-grove/sandcastle-2-7/2131-sylvester-palm-lane-dream2-224/";
  const villa = "https://images.nealcommunities.com/wp-content/uploads/2026/09/29135754/Villa-30-1638-1848-BW5-scaled.jpg?auto=format%2Ccompress&fit=max&w=1000";
  const viewer = "https://planviewer.cpsusa.com/nealcom/api/attachment/2013209";
  const kitchen = "https://images.nealcommunities.com/wp-content/uploads/2026/09/29135801/2131-kitchen.jpg";
  const filedKey = "2131-sylvester-palm-lane-lakewood-ranch-fl-34212";
  const home = (over: Partial<NormalizedPlan>) =>
    plan({ planKey: "2131-sylvester-palm-lane", name: "2131 Sylvester Palm Lane", quickMoveIn: true, sourceUrl: page, description: null, ...over });
  const record = home({ planKey: filedKey, galleryImages: [viewer, kitchen], copiesOf: { [villa]: viewer } });
  const filed = [{ plan_key: filedKey, record }];

  it("finds the home's record by the home it is, not only by its key", () => {
    const known = new Map([[filedKey, record]]);
    expect(knownRecordsOf([home({})], known, filed)).toEqual([record]);
    expect(knownRecordsOf([home({})], known, [])).toEqual([undefined]);
    expect(knownRecordsOf([plan({ planKey: "elsewhere" })], known, filed)).toEqual([undefined]);
  });

  it("spells the copy its record took out as the photo it copies, so its lead is not proposed again", async () => {
    const [read] = await preparePlans([home({ galleryImages: [villa, kitchen] })], scope, {
      rewordDescriptions: false,
      known: new Map([[filedKey, record]]),
      filed,
    });
    expect(read.galleryImages).toEqual([viewer, kitchen]);
    expect(fieldChanges(record as CanonicalRecord, { ...read, planKey: filedKey }).map((c) => c.label)).not.toContain("photos");
  });
});
