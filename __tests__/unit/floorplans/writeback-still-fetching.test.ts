import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Wix's answer about each imported file, by file id.
let wixSays: Record<string, { operationStatus: string; media?: unknown }> = {};

vi.mock("@/lib/supabase/client", () => {
  const chain = {
    update: () => chain,
    delete: () => chain,
    eq: () => chain,
    then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
  };
  return { supabase: { from: () => chain } };
});

vi.mock("@/lib/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wix/client")>();
  return { ...actual, getMediaFile: vi.fn(async (_site: string, fileId: string) => wixSays[fileId] ?? null) };
});

import { STILL_FETCHING_MS, verifyImports, type ImportedImage } from "@/lib/floorplans/writeback";

const image = (fileId: string, importedAgoMs: number): ImportedImage => ({
  uri: `wix:image://v1/${fileId}/p.jpg#originWidth=4&originHeight=3`,
  fileId,
  sourceUrl: `https://res.cloudinary.com/perryhomes/${fileId}`,
  verified: false,
  importedAt: Date.now() - importedAgoMs,
});
const ready = { operationStatus: "READY", media: { image: { image: { width: 4, height: 3 } } } };

/**
 * Perry's Cloudinary photos took Wix minutes to fetch (2026-10-04): 9515
 * Sandy Shores and 7914 Bon Air Way went to Failed with photos Wix had a
 * few minutes later. A picture Wix is still fetching is now told apart
 * from one it will never have, so the plan waits instead of failing.
 */
describe("verifyImports: a picture Wix is still fetching", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    wixSays = {};
  });
  afterEach(() => vi.useRealTimers());

  const verify = async (images: ImportedImage[]) => {
    const pending = verifyImports("lakewood", "wix-site", images);
    await vi.runAllTimersAsync();
    return pending;
  };

  it("comes back as still fetching while the import is young, and is left off the row either way", async () => {
    wixSays = { fresh: { operationStatus: "PENDING" }, done: ready };
    const { bad, fetching } = await verify([image("fresh", 30_000), image("done", 30_000)]);
    expect([...bad]).toEqual(["fresh"]);
    expect([...fetching]).toEqual(["fresh"]);
  });

  it("counts as never coming once Wix has had it longer than STILL_FETCHING_MS", async () => {
    wixSays = { stale: { operationStatus: "PENDING" } };
    const { bad, fetching } = await verify([image("stale", STILL_FETCHING_MS + 1000)]);
    expect([...bad]).toEqual(["stale"]);
    expect(fetching.size).toBe(0);
  });

  it("does not wait on a picture Wix says it failed to fetch", async () => {
    wixSays = { broken: { operationStatus: "FAILED" } };
    const { bad, fetching } = await verify([image("broken", 1000)]);
    expect([...bad]).toEqual(["broken"]);
    expect(fetching.size).toBe(0);
  });
});
