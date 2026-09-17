import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny stand-in for the supabase query builder: every chained call returns
// the builder, awaiting it yields the next queued result for that table.
type Result = { data?: unknown; error?: unknown; count?: number | null };
const queues = new Map<string, Result[]>();
const calls: Array<{ table: string; ops: string[] }> = [];

function enqueue(table: string, ...results: Result[]) {
  queues.set(table, [...(queues.get(table) ?? []), ...results]);
}

function builder(table: string) {
  const ops: string[] = [];
  calls.push({ table, ops });
  const chain: Record<string, unknown> = {};
  const methods = ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "is", "not", "lt", "ilike", "order", "limit", "range", "single", "maybeSingle"];
  for (const m of methods) {
    chain[m] = (...args: unknown[]) => {
      ops.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return chain;
    };
  }
  chain.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => {
    const queue = queues.get(table) ?? [];
    const next = queue.shift() ?? { data: null, error: null, count: null };
    return Promise.resolve(next).then(resolve, reject);
  };
  return chain;
}

vi.mock("@/lib/supabase/client", () => ({
  supabase: { from: (table: string) => builder(table) },
}));

import {
  HubError,
  addTerm,
  createVillage,
  deleteVillage,
  listEvents,
  dismissErrors,
  listOpenErrors,
  listRuns,
  listStagedListings,
  normalizeTerm,
  optionalText,
  setSiteWriteMode,
  siteCounts,
  validateVillageName,
} from "@/lib/listings/hub";

beforeEach(() => {
  queues.clear();
  calls.length = 0;
});

describe("term and name validation", () => {
  it("normalises a term the way the classifier compares it", () => {
    expect(normalizeTerm("  Bay   Isles ")).toBe("bay isles");
    expect(normalizeTerm("")).toBeNull();
    expect(normalizeTerm(undefined)).toBeNull();
    expect(() => normalizeTerm("x".repeat(81))).toThrow(HubError);
  });

  it("requires a village name and trims it", () => {
    expect(validateVillageName("  Bay Isles  Harbor ")).toBe("Bay Isles Harbor");
    expect(() => validateVillageName("   ")).toThrow("needs a name");
    expect(() => validateVillageName(42)).toThrow(HubError);
  });

  it("treats blank optional text as null and leaves undefined alone", () => {
    expect(optionalText(undefined, "x")).toBeUndefined();
    expect(optionalText("  ", "x")).toBeNull();
    expect(optionalText(" slug ", "x")).toBe("slug");
    expect(() => optionalText(5, "Wix slug")).toThrow("Wix slug must be text");
  });
});

describe("siteCounts", () => {
  it("counts states, incomplete galleries, pending writes and removals still on the site", async () => {
    enqueue("ls_site_listings", {
      data: [
        { site_id: "s1", state: "live", gallery_ready: true, needs_write: false, wix_item_id: "A" },
        { site_id: "s1", state: "live", gallery_ready: false, needs_write: true, wix_item_id: "B" },
        { site_id: "s1", state: "staged", gallery_ready: false, needs_write: true, wix_item_id: null },
        { site_id: "s1", state: "removed", gallery_ready: true, needs_write: true, wix_item_id: "C" },
        { site_id: "s1", state: "removed", gallery_ready: true, needs_write: false, wix_item_id: null },
        { site_id: "s2", state: "live", gallery_ready: true, needs_write: false, wix_item_id: "D" },
      ],
    });
    const counts = await siteCounts();
    expect(counts.get("s1")).toEqual({ staged: 1, live: 2, removed: 2, galleryPending: 2, needsWrite: 3, pendingRemovals: 1 });
    expect(counts.get("s2")).toEqual({ staged: 0, live: 1, removed: 0, galleryPending: 0, needsWrite: 0, pendingRemovals: 0 });
  });
});

describe("guards", () => {
  it("refuses to delete a village that still has listings", async () => {
    enqueue("ls_site_listings", { count: 3, error: null });
    await expect(deleteVillage("v1")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("3 listing(s)") });
  });

  it("deletes a village nothing points at", async () => {
    enqueue("ls_site_listings", { count: 0, error: null });
    enqueue("ls_villages", { error: null });
    await expect(deleteVillage("v1")).resolves.toBeUndefined();
    expect(calls.map((c) => c.table)).toEqual(["ls_site_listings", "ls_villages"]);
  });

  it("names the owner when a term already belongs to another village", async () => {
    enqueue("ls_villages", { data: { id: "v1", site_id: "s1", name: "The Bayou" } });
    enqueue("ls_village_terms", { error: { code: "23505", message: "duplicate key" } });
    enqueue("ls_village_terms", { data: { ls_villages: { name: "Bay Isles - Harbor Section" } } });
    await expect(addTerm("v1", { term: " Bay Isles " })).rejects.toMatchObject({
      status: 409,
      message: '"bay isles" already belongs to Bay Isles - Harbor Section',
    });
  });

  it("adds a normalised term to its village's site", async () => {
    enqueue("ls_villages", { data: { id: "v1", site_id: "s1", name: "The Bayou" } });
    enqueue("ls_village_terms", { data: { id: "t1", term: "bay isles", street_term: "bayou", exclude_term: null } });
    const term = await addTerm("v1", { term: "Bay Isles", street_term: " Bayou " });
    expect(term).toEqual({ id: "t1", term: "bay isles", street_term: "bayou", exclude_term: null });
    const insert = calls.find((c) => c.table === "ls_village_terms")!;
    expect(insert.ops[0]).toBe('insert({"site_id":"s1","village_id":"v1","term":"bay isles","street_term":"bayou","exclude_term":null})');
  });

  it("normalises an exclusion alongside the term", async () => {
    enqueue("ls_villages", { data: { id: "v1", site_id: "s1", name: "The Preserve" } });
    enqueue("ls_village_terms", { data: { id: "t2", term: "preserve", street_term: null, exclude_term: "kensington" } });
    const term = await addTerm("v1", { term: " Preserve ", exclude_term: " Kensington " });
    expect(term).toEqual({ id: "t2", term: "preserve", street_term: null, exclude_term: "kensington" });
    const insert = calls.find((c) => c.table === "ls_village_terms")!;
    expect(insert.ops[0]).toBe('insert({"site_id":"s1","village_id":"v1","term":"preserve","street_term":null,"exclude_term":"kensington"})');
  });

  it("refuses an exclusion the term itself contains, which would match nothing", async () => {
    enqueue("ls_villages", { data: { id: "v1", site_id: "s1", name: "The Preserve" } });
    await expect(addTerm("v1", { term: "preserve at kensington", exclude_term: "kensington" })).rejects.toMatchObject({
      message: '"preserve at kensington" always contains "kensington", so the exclusion would stop it matching anything',
    });
  });

  it("only pauses or resumes a site, and never a live one", async () => {
    await expect(setSiteWriteMode("s1", "live")).rejects.toThrow("paused or shadow");
    enqueue("ls_sites", { data: { id: "s1", write_mode: "live" } });
    await expect(setSiteWriteMode("s1", "paused")).rejects.toMatchObject({ status: 409 });
    enqueue("ls_sites", { data: { id: "s1", write_mode: "shadow" } });
    enqueue("ls_sites", { data: { id: "s1", write_mode: "paused" } });
    await expect(setSiteWriteMode("s1", "paused")).resolves.toMatchObject({ write_mode: "paused" });
  });
});

describe("listStagedListings", () => {
  it("names what each staged listing waits on, in the order reconcile checks", async () => {
    const at = "2026-09-14T12:00:00.000Z";
    enqueue("ls_site_listings", {
      data: [
        { listing_id: "MFR1", village_id: "v1", staged_at: at },
        { listing_id: "MFR2", village_id: null, staged_at: at },
        { listing_id: "MFR3", village_id: "v1", staged_at: at },
        { listing_id: "MFR4", village_id: "v1", staged_at: at },
      ],
    });
    const record = (id: string, extra: Record<string, unknown> = {}) => ({
      listing_id: id,
      city: "Longboat Key",
      subdivision: "BAY ISLES",
      list_price: 1250000,
      standard_status: "Active",
      raw: { ListingId: id, StreetNumber: "10", StreetName: "GULF OF MEXICO", StreetSuffix: "DR", ...extra },
    });
    enqueue("ls_listings", {
      data: [record("MFR1", { UnitNumber: "4B" }), record("MFR2"), record("MFR3"), { listing_id: "MFR4", raw: {}, list_price: null }],
    });
    enqueue("ls_villages", { data: [{ id: "v1", name: "Bay Isles" }] });
    enqueue("ls_listing_media", {
      data: [
        { id: "m1", listing_id: "MFR1", position: 1, path_key: "images/MFR1/a.jpg", title: null },
        { id: "m2", listing_id: "MFR1", position: 2, path_key: "images/MFR1/b.jpg", title: null },
        { id: "m3", listing_id: "MFR3", position: 1, path_key: "images/MFR3/a.jpg", title: null },
      ],
    });
    enqueue("ls_site_media", { data: [{ media_id: "m1", wix_image_uri: "wix:image://v1/abc/a.jpg" }] });

    const view = await listStagedListings("s1");
    expect(view.map((v) => [v.listing_id, v.waiting_on, v.photos_imported, v.photos])).toEqual([
      ["MFR1", "write", 1, 2],
      ["MFR2", "neighborhood", 0, 0],
      ["MFR3", "photos", 0, 1],
      ["MFR4", "data", 0, 0],
    ]);
    expect(view[0]).toMatchObject({ address: "10 Gulf Of Mexico Dr #4B", neighborhood: "Bay Isles", list_price: 1250000, staged_at: at });
    expect(view[3]).toMatchObject({ address: null, neighborhood: "Bay Isles", list_price: null });
    const staged = calls.find((c) => c.table === "ls_site_listings")!;
    expect(staged.ops).toContain('eq("state","staged")');
  });

  it("is empty without a second query when nothing is staged", async () => {
    enqueue("ls_site_listings", { data: [] });
    await expect(listStagedListings("s1")).resolves.toEqual([]);
    expect(calls.map((c) => c.table)).toEqual(["ls_site_listings"]);
  });
});

describe("runs and open errors", () => {
  it("lists runs newest first and pages back from a started_at cursor", async () => {
    enqueue("ls_sync_runs", { data: [{ id: "r1" }] });
    await expect(listRuns({ before: "2026-09-15T00:00:00.000Z", limit: 500 })).resolves.toEqual([{ id: "r1" }]);
    const ops = calls.find((c) => c.table === "ls_sync_runs")!.ops;
    expect(ops).toContain('order("started_at",{"ascending":false})');
    expect(ops).toContain("limit(100)");
    expect(ops).toContain('lt("started_at","2026-09-15T00:00:00.000Z")');
  });

  it("looks one run up by its key", async () => {
    enqueue("ls_sync_runs", { data: [{ id: "r1", run_key: "full:x" }] });
    await listRuns({ runKey: " full:x " });
    expect(calls[0].ops).toContain('eq("run_key","full:x")');
    expect(calls[0].ops).toContain("limit(20)");
  });

  it("counts open errors without fetching rows when only the count is wanted", async () => {
    enqueue("ls_sync_events", { count: 3, data: null });
    await expect(listOpenErrors(0)).resolves.toEqual({ count: 3, errors: [] });
    const ops = calls[0].ops;
    expect(ops[0]).toBe('select("id",{"count":"exact","head":true})');
    expect(ops).toContain('eq("level","error")');
    expect(ops).toContain('is("dismissed_at",null)');
  });

  it("lists open errors newest first with their total", async () => {
    enqueue("ls_sync_events", { count: 2, data: [{ id: "e1" }, { id: "e2" }] });
    await expect(listOpenErrors(50)).resolves.toEqual({ count: 2, errors: [{ id: "e1" }, { id: "e2" }] });
    expect(calls[0].ops).toContain('order("at",{"ascending":false})');
    expect(calls[0].ops).toContain("limit(50)");
  });

  it("dismisses the given open errors, or all of them, and nothing else", async () => {
    await expect(dismissErrors({})).rejects.toThrow("ids");
    expect(calls).toHaveLength(0);
    enqueue("ls_sync_events", { data: [{ id: "e1" }] });
    await expect(dismissErrors({ ids: ["e1", 5, ""] })).resolves.toEqual({ dismissed: 1 });
    const ops = calls[0].ops;
    expect(ops[0]).toMatch(/^update\(\{"dismissed_at":"/);
    expect(ops).toContain('eq("level","error")');
    expect(ops).toContain('is("dismissed_at",null)');
    expect(ops).toContain('in("id",["e1"])');
    enqueue("ls_sync_events", { data: [{ id: "e1" }, { id: "e2" }] });
    await expect(dismissErrors({ all: true })).resolves.toEqual({ dismissed: 2 });
    expect(calls[1].ops.some((op) => op.startsWith("in("))).toBe(false);
  });
});

describe("neighborhood slugs and change-log paging", () => {
  it("derives the Wix slug from the page URL when none is given", async () => {
    enqueue("ls_villages", { data: { id: "v1", name: "Bay Isles" } });
    await createVillage({ siteId: "s1", name: "Bay Isles", page_url: " https://www.lifeinlongboatkey.com/villages/bay-isles " });
    expect(calls[0].ops[0]).toBe('insert({"site_id":"s1","name":"Bay Isles","wix_slug":"bay-isles","page_url":"https://www.lifeinlongboatkey.com/villages/bay-isles","wix_item_id":null})');
  });

  it("leaves the slug empty without a page URL", async () => {
    enqueue("ls_villages", { data: { id: "v1", name: "Bay Isles" } });
    await createVillage({ siteId: "s1", name: "Bay Isles" });
    expect(calls[0].ops[0]).toContain('"wix_slug":null');
  });

  it("pages entries back from a timestamp and looks runs up by key", async () => {
    enqueue("ls_sync_events", { data: [] });
    await listEvents({ level: "error", before: "2026-09-15T12:00:00.000Z" });
    expect(calls[0].ops).toContain('lt("at","2026-09-15T12:00:00.000Z")');
    enqueue("ls_sync_runs", { data: [] });
    await listRuns({ runKeys: ["full:a", "incremental:b"] });
    expect(calls[1].ops).toContain('in("run_key",["full:a","incremental:b"])');
  });
});
