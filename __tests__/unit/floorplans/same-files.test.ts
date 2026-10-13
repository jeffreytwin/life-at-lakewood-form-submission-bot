import { beforeEach, describe, expect, it, vi } from "vitest";

// What fp_media_map holds: the digest of the bytes each import fetched.
const stored = new Map<string, string>();

vi.mock("@/lib/supabase/client", () => {
  const query = () => {
    let urls: string[] = [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: (_column: string, values: string[]) => {
        urls = values;
        return chain;
      },
      then: (resolve: (value: { data: { source_url: string; content_hash: string }[]; error: null }) => unknown) =>
        resolve({ data: urls.filter((u) => stored.has(u)).map((u) => ({ source_url: u, content_hash: stored.get(u)! })), error: null }),
    };
    return chain;
  };
  return { supabase: { from: () => query() } };
});

import { fieldChanges } from "@/lib/floorplans/diff";
import { replacedPictures, sameFiles, spelledAsRecord, withSameFilesAsRecord, type FileCheckBudget } from "@/lib/floorplans/same-files";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// Addresses from the queue (Jeff, 2026-10-13).
const bluebell = (tag: string) => `https://mhc-p-001.sitecorecontenthub.cloud/api/public/content/04f3167648194c8bb838e1eb528776d3?v=${tag}`;
const kitchen = "https://mhc-p-001.sitecorecontenthub.cloud/api/public/content/7d898facded74779b704fdc60f7dbeaf?v=7dde5c3d";
const buttonwood = "https://simplydwellhomes.com/wp-content/uploads/2026/06/Buttonwood_2.jpg";
const buttonwood2 = "https://simplydwellhomes.com/wp-content/uploads/2026/06/Buttonwood_2-2.jpg";
const lennar = (folder: string) => `https://cdn.lennar.com/api/images/contentassets/${folder}/tpu_2551_fp_concord_mod1_firstfloor_overlay_12_27_22.svg`;

const plan = (over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "bluebell",
  name: "Bluebell",
  price: 400000,
  priceDisplay: "$400,000",
  beds: "3",
  baths: "2",
  sqft: 1800,
  garages: "2 car",
  homeType: "Single-Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: "https://www.meritagehomes.com/bluebell",
  galleryImages: [kitchen],
  blueprintImages: [bluebell("66df58e6")],
  ...over,
});

const budget = (left = 10): FileCheckBudget => ({ left, until: Date.now() + 60_000 });
const labels = (current: NormalizedPlan, run: NormalizedPlan) => fieldChanges(current, run).map((c) => c.label);

beforeEach(() => stored.clear());

describe("the same file at a new address is the record's picture", () => {
  it("names the pictures a run would put in place of the record's", () => {
    expect(replacedPictures(plan(), plan({ blueprintImages: [bluebell("81a8654b")] }), "blueprintImages")).toEqual({
      added: [bluebell("81a8654b")],
      gone: [bluebell("66df58e6")],
    });
    expect(replacedPictures(plan(), plan(), "blueprintImages")).toEqual({ added: [], gone: [] });
    // A home: its lead alone, and no drawings.
    const home = (gallery: string[]) => plan({ quickMoveIn: true, galleryImages: gallery });
    expect(replacedPictures(home([buttonwood2, kitchen]), home([buttonwood, kitchen]), "galleryImages")).toEqual({ added: [buttonwood], gone: [buttonwood2] });
    expect(replacedPictures(home([buttonwood2]), home([buttonwood]), "blueprintImages")).toEqual({ added: [], gone: [] });
  });

  it("pairs one replaced picture with one replacement of the same bytes", () => {
    const hashes = new Map([
      [bluebell("81a8654b"), ["h1"]],
      [bluebell("66df58e6"), ["h1"]],
      [kitchen, ["h2"]],
    ]);
    expect([...sameFiles([bluebell("81a8654b")], [bluebell("66df58e6")], hashes)]).toEqual([[bluebell("81a8654b"), bluebell("66df58e6")]]);
    expect(sameFiles([bluebell("81a8654b")], [kitchen], hashes).size).toBe(0);
    expect(sameFiles(["https://unfetched.example.com/a.jpg"], [bluebell("66df58e6")], hashes).size).toBe(0);
  });

  it("spells the replacement as the record does, each picture once, its caption kept", () => {
    const run = plan({ galleryImages: [buttonwood, kitchen], galleryMeta: { [buttonwood]: { room: "exterior" } } });
    const spelled = spelledAsRecord(run, "galleryImages", new Map([[buttonwood, buttonwood2]]));
    expect(spelled.galleryImages).toEqual([buttonwood2, kitchen]);
    expect(spelled.galleryMeta).toEqual({ [buttonwood2]: { room: "exterior" } });
    expect(spelledAsRecord(run, "galleryImages", new Map())).toBe(run);
  });

  it("proposes nothing for Meritage's Bluebell drawing under its new tag, read off what Wix holds without a fetch (Oct 6 and back Oct 9)", async () => {
    stored.set(bluebell("66df58e6"), "same-bytes");
    stored.set(bluebell("81a8654b"), "same-bytes");
    const fingerprint = vi.fn(async () => null);
    const current = plan();
    const run = plan({ blueprintImages: [bluebell("81a8654b")] });
    expect(labels(current, run)).toEqual(["blueprints"]);
    const read = await withSameFilesAsRecord(current, run, "site", budget(), fingerprint);
    expect(read.blueprintImages).toEqual([bluebell("66df58e6")]);
    expect(labels(current, read)).toEqual([]);
    expect(fingerprint).not.toHaveBeenCalled();
  });

  it("fetches a replacement Wix has never held, and keeps the record's picture when the bytes are its (SimplyDwell's Buttonwood, Lennar's Concord)", async () => {
    stored.set(buttonwood2, "buttonwood-bytes");
    stored.set(lennar("a893b96798c84e9284de2ac9fcd7fe4f"), "concord-bytes");
    const served: Record<string, string> = { [buttonwood]: "buttonwood-bytes", [lennar("5b82d8bf362d4e83b3afef16f8626c22")]: "concord-bytes" };
    const fingerprint = vi.fn(async (url: string) => served[url] ?? null);
    const home = (lead: string) => plan({ planKey: "buttonwood-homesite-145", quickMoveIn: true, galleryImages: [lead, kitchen] });
    const read = await withSameFilesAsRecord(home(buttonwood2), home(buttonwood), "site", budget(), fingerprint);
    expect(labels(home(buttonwood2), read)).toEqual([]);
    const concord = (folder: string) => plan({ planKey: "concord", blueprintImages: [lennar(folder)] });
    const drawn = await withSameFilesAsRecord(concord("a893b96798c84e9284de2ac9fcd7fe4f"), concord("5b82d8bf362d4e83b3afef16f8626c22"), "site", budget(), fingerprint);
    expect(labels(concord("a893b96798c84e9284de2ac9fcd7fe4f"), drawn)).toEqual([]);
  });

  it("still proposes a picture whose bytes differ, one it could not fetch, and one past the budget", async () => {
    stored.set(bluebell("66df58e6"), "old-drawing");
    const current = plan();
    const run = plan({ blueprintImages: [bluebell("c0ffee00")] });
    const served: Record<string, string> = { [bluebell("c0ffee00")]: "new-drawing" };
    const redrawn = await withSameFilesAsRecord(current, run, "site", budget(), async (url) => served[url] ?? null);
    expect(labels(current, redrawn)).toEqual(["blueprints"]);
    const unfetched = await withSameFilesAsRecord(current, run, "site", budget(), async () => null);
    expect(labels(current, unfetched)).toEqual(["blueprints"]);
    const spent = budget(0);
    const fingerprint = vi.fn(async () => "old-drawing");
    expect(labels(current, await withSameFilesAsRecord(current, run, "site", spent, fingerprint))).toEqual(["blueprints"]);
    expect(fingerprint).not.toHaveBeenCalled();
  });

  it("still proposes Meritage's redrawn plan, whose old address now serves the new drawing too", async () => {
    // Meritage serves its newest file whatever "?v=" the address carries.
    stored.set(bluebell("66df58e6"), "old-drawing");
    const fingerprint = vi.fn(async () => "new-drawing");
    const current = plan();
    const run = plan({ blueprintImages: [bluebell("c0ffee00")] });
    expect(labels(current, await withSameFilesAsRecord(current, run, "site", budget(), fingerprint))).toEqual(["blueprints"]);
    expect(fingerprint).toHaveBeenCalledTimes(1);
    expect(fingerprint).toHaveBeenCalledWith(bluebell("c0ffee00"));
  });

  it("proposes, without fetching anything, where Wix never noted the bytes of the record's picture", async () => {
    const fingerprint = vi.fn(async () => "same-bytes");
    const current = plan();
    const run = plan({ blueprintImages: [bluebell("81a8654b")] });
    expect(labels(current, await withSameFilesAsRecord(current, run, "site", budget(), fingerprint))).toEqual(["blueprints"]);
    expect(fingerprint).not.toHaveBeenCalled();
  });

  it("leaves a gallery a person arranged by hand alone", async () => {
    stored.set(buttonwood2, "b");
    stored.set(buttonwood, "b");
    const current = plan({ galleryImages: [buttonwood2], userEditedFields: ["galleryImages"] });
    const run = plan({ galleryImages: [buttonwood] });
    expect((await withSameFilesAsRecord(current, run, "site", budget())).galleryImages).toEqual([buttonwood]);
  });
});
