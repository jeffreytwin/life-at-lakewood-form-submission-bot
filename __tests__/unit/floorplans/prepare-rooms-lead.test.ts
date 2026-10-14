import { describe, expect, it, vi } from "vitest";

// D.R. Horton's Jordyn II at Legacy Preserve, its photos looked at (Jeff, 2026-09-28).
const at = (n: string) => `https://cdn.drhorton.com/3278/${n}.jpg`;
const front = at("jordyn_ii-h-stone-3car-gen3-elev_ind");
const rooms: Record<string, string> = {
  [front]: "front",
  [at("rear")]: "front",
  [at("08")]: "kitchen",
  [at("10")]: "bedroom",
  [at("11")]: "bedroom",
  [at("14")]: "bedroom",
  [at("16")]: "bathroom",
};

// What fp_photo_rooms remembers; nothing else is read here.
vi.mock("@/lib/supabase/client", () => {
  const query = (table: string) => {
    let urls: string[] = [];
    const chain: Record<string, unknown> = {};
    for (const step of ["select", "eq", "match", "is", "order", "limit"]) chain[step] = () => chain;
    chain.in = (_column: string, values: string[]) => {
      urls = values;
      return chain;
    };
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({
        data: table === "fp_photo_rooms" ? urls.filter((u) => rooms[u]).map((u) => ({ source_url: u, room: rooms[u] })) : [],
        error: null,
      });
    return chain;
  };
  return { supabase: { from: (table: string) => query(table) } };
});

import { fieldChanges, type CanonicalRecord } from "@/lib/floorplans/diff";
import { withLookedAtRooms, type PhotoLabel } from "@/lib/floorplans/photo-rooms";
import { preparePlans } from "@/lib/floorplans/sync";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const scope = { site: { id: "site" }, community: { id: "community", name: "Legacy Preserve" }, builder: { id: "builder", name: "D.R. Horton" } };

const plan = (galleryImages: string[]): NormalizedPlan => ({
  planKey: "jordyn-ii",
  name: "Jordyn II",
  price: 500000,
  priceDisplay: "$500,000",
  beds: "5",
  baths: "3",
  sqft: 2800,
  garages: "3 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://www.drhorton.com/florida/sarasota/legacy-preserve/jordyn-ii",
  galleryImages,
  blueprintImages: [],
});

// The record as the rooms ordered it.
const looked = new Map(Object.entries(rooms) as [string, PhotoLabel][]);
const record = withLookedAtRooms(plan([front, at("rear"), at("08"), at("10"), at("11"), at("14"), at("16")]), looked);
const read = async (page: string[]) =>
  (await preparePlans([plan(page)], scope, { rewordDescriptions: false, known: new Map([[record.planKey, record]]) }))[0];

describe("the page's lead, where the rooms decide what leads", () => {
  it("leads nothing when the rooms put the front first: a bedroom the page showed first keeps its place among the bedrooms", async () => {
    const run = await read([at("14"), front, at("rear"), at("08"), at("10"), at("11"), at("16")]);
    expect(run.galleryImages).toEqual(record.galleryImages);
    expect(fieldChanges(record as CanonicalRecord, run).map((c) => c.label)).not.toContain("photos");
  });

  it("keeps the front the record leads with when the page leads with another picture of the front (eight homes, 2026-10-14)", async () => {
    const run = await read([at("rear"), front, at("08"), at("10"), at("11"), at("14"), at("16")]);
    expect(run.galleryImages).toEqual(record.galleryImages);
    expect(fieldChanges(record as CanonicalRecord, run).map((c) => c.label)).not.toContain("photos");
    // A home shows its lead alone: the same holds.
    const home = { ...record, quickMoveIn: true };
    const [lead] = await preparePlans([{ ...plan([at("rear"), front, at("08"), at("10"), at("11"), at("14"), at("16")]), quickMoveIn: true }], scope, {
      rewordDescriptions: false,
      known: new Map([[home.planKey, home]]),
    });
    expect(lead.galleryImages[0]).toBe(front);
    expect(fieldChanges(home as CanonicalRecord, lead).map((c) => c.label)).not.toContain("photos");
  });
});
