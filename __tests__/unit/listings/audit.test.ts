import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shared/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// A chain just deep enough for loadSite; the rest of the reads go through
// the mocked db helpers below.
const siteRow = {
  id: "site-parrish",
  name: "Life At Parrish",
  domain: "lifeatparrish.com",
  wix_site_id: "wix-parrish",
  target_collection_id: "HousesforSale2",
  live_collection_id: "HousesforSale",
  media_folder_name: "ParrishListingPhotos",
  media_folder_id: "folder-parrish",
  media_scan_offset: 20_000,
};
vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: siteRow, error: null }) }),
      }),
    }),
  },
}));
vi.mock("@/lib/listings/db", () => ({ selectAll: vi.fn(async () => []), setSiteMediaScanOffset: vi.fn() }));
vi.mock("@/lib/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wix/client")>();
  return {
    WIX_MEDIA_ROOT: actual.WIX_MEDIA_ROOT,
    mediaState: actual.mediaState,
    bulkRemoveItems: vi.fn(),
    listMediaFiles: vi.fn(async () => ({ files: [], truncated: false, nextOffset: 0 })),
    queryAllItems: vi.fn(async () => []),
  };
});

import { listMediaFiles } from "@/lib/wix/client";
import { AUDIT_FOLDER_BUDGET_MS, auditSite, compareCollection, compareFolder, scanWindow } from "@/lib/listings/audit";

const uri = (fileId: string) => `wix:image://v1/${fileId}/photo.jpg#originWidth=1600&originHeight=1066`;

describe("compareFolder", () => {
  it("counts engine photos in and outside the folder, and folder files the engine does not know", () => {
    const result = compareFolder(["a~mv2.jpg", "b~mv2.jpg", "c~mv2.jpg", "a~mv2.jpg"], ["b~mv2.jpg", "a~mv2.jpg", "old1~mv2.jpg", "old2~mv2.jpg"]);
    expect(result).toEqual({ engineFiles: 3, engineFilesInFolder: 2, outsideFolder: ["c~mv2.jpg"], outsideFolderCount: 1, unknownInFolder: 2 });
  });

  it("is clean when every engine file is in the folder", () => {
    const result = compareFolder(["a", "b"], ["a", "b"]);
    expect(result.outsideFolderCount).toBe(0);
    expect(result.unknownInFolder).toBe(0);
  });
});

describe("compareCollection", () => {
  const items = [
    { id: "MFR1", data: { _id: "MFR1", propertyAddress: "1 Main St", standardStatus: "Active", listingImageGallery: [{ src: uri("a") }, { src: uri("b") }] } },
    { id: "MFR2", data: { _id: "MFR2", propertyAddress: "2 Main St", standardStatus: "Pending", listingImageGallery: [{ src: uri("old") }, { src: "https://static.wixstatic.com/media/x.png" }] } },
    { id: "row-3", data: { listingImageGallery: [] } },
  ];

  it("splits rows into owned and stale, counts engine rows the collection lacks, and checks galleries against the folder", () => {
    const result = compareCollection(items, ["MFR1", "MFR9"], ["a", "b"]);
    expect(result.items).toBe(3);
    expect(result.owned).toBe(1);
    expect(result.staleCount).toBe(2);
    expect(result.stale).toEqual([
      { id: "MFR2", address: "2 Main St", status: "Pending" },
      { id: "row-3", address: null, status: null },
    ]);
    expect(result.missing).toBe(1);
    expect(result.galleryItems).toBe(4);
    expect(result.galleryOutsideFolder).toBe(1);
    expect(result.galleryNotWixImage).toBe(1);
  });

  it("reports the folder check as unavailable when the folder is unresolved", () => {
    const result = compareCollection(items, ["MFR1", "MFR2", "row-3"], null);
    expect(result.staleCount).toBe(0);
    expect(result.galleryOutsideFolder).toBeNull();
  });
});

describe("scanWindow", () => {
  it("resumes from the cursor and moves it on for a caller working to a clock", () => {
    // The photo pass and the nightly sweep: the folder is covered across
    // passes rather than only ever its first pages.
    expect(scanWindow(Date.now() + 60_000, 20_000)).toEqual({ startOffset: 20_000, advances: true });
  });

  it("sweeps the whole library for a person who pressed the button, and leaves the cursor alone", () => {
    // Otherwise the audit reports on everything and the reimport beside it
    // fixes only the tail: "12 broken" and then "cleared 2", for no visible
    // reason. Parrish's cursor sat at 20,000 when this was found.
    expect(scanWindow(undefined, 20_000)).toEqual({ startOffset: 0, advances: false });
  });

  it("does not run off the front of the folder on a bad stored cursor", () => {
    expect(scanWindow(Date.now() + 60_000, -5).startOffset).toBe(0);
  });
});

describe("auditSite's folder walk", () => {
  it("gives the listing a budget, so a folder too big to walk reports instead of timing out", async () => {
    // Parrish's folder passed 20,000 files -- over 200 sequential Wix
    // requests -- against a route capped at 120s, and the whole request
    // started returning 504. A 504 is not a report; a partial listing is.
    const now = Date.parse("2026-09-17T16:35:00.000Z");
    vi.mocked(listMediaFiles).mockResolvedValueOnce({ files: [], truncated: true, nextOffset: 20_000 });

    const report = await auditSite("site-parrish", now);

    expect(listMediaFiles).toHaveBeenCalledWith("wix-parrish", "folder-parrish", { deadline: now + AUDIT_FOLDER_BUDGET_MS });
    // The Hub renders this as "(listing cut short)" beside the file count.
    expect(report.folder.listingTruncated).toBe(true);
  });

  it("leaves room for the collection queries that follow it", () => {
    // maxDuration on the route is 120s; the folder walk is only the first
    // half of the audit.
    expect(AUDIT_FOLDER_BUDGET_MS).toBeLessThan(120_000 / 2);
  });

  it("starts at the beginning, not at the background scan's cursor", async () => {
    // The site row carries media_scan_offset 20000; a person asking about
    // the library means all of it.
    vi.mocked(listMediaFiles).mockClear();
    await auditSite("site-parrish", Date.now());
    const options = vi.mocked(listMediaFiles).mock.calls[0][2];
    expect(options?.startOffset).toBeUndefined();
  });
});
