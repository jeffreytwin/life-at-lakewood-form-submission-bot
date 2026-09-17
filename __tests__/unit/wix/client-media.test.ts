import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listMediaFiles } from "@/lib/wix/client";

/**
 * The Media Manager folder listing is the one Wix call whose cost grows with
 * the site: Parrish's photo folder is some 14,000 files, about 140 pages of
 * 100. It is also the call the photo pass makes while a backfill is running,
 * competing for the same account-wide 200 requests/minute the imports need.
 * So it has to be interruptible -- and, once interrupted, it has to carry on
 * where it stopped rather than re-walking the same first pages forever
 * (migration 054).
 */
describe("wix media folder listing", () => {
  const urls: string[] = [];
  /** The folder the fake Wix is holding, paged 100 at a time as the API does. */
  let folderSize = 0;

  const offsetOf = (url: string) => Number(new URL(url).searchParams.get("paging.offset"));

  beforeEach(() => {
    urls.length = 0;
    process.env.WIX_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const offset = offsetOf(url);
        const files = Array.from({ length: Math.max(0, Math.min(100, folderSize - offset)) }, (_, i) => ({
          id: `file-${offset + i}`,
        }));
        return new Response(JSON.stringify({ files }), { headers: { "content-type": "application/json" } });
      })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads a folder to the end and asks for a fresh walk next time", async () => {
    folderSize = 250;

    const result = await listMediaFiles("site-1", "folder-1");

    expect(result.files).toHaveLength(250);
    expect(result.truncated).toBe(false);
    // A short page is the end of the folder, so the next scan starts over.
    expect(result.nextOffset).toBe(0);
    expect(urls.map(offsetOf)).toEqual([0, 100, 200]);
    expect(urls[0]).toContain("parentFolderId=folder-1");
  });

  it("stops at the page cap and reports where the next scan picks up", async () => {
    folderSize = 1_000;

    const result = await listMediaFiles("site-1", "folder-1", { maxPages: 3 });

    expect(result.files).toHaveLength(300);
    expect(result.truncated).toBe(true);
    expect(result.nextOffset).toBe(300);
    expect(urls).toHaveLength(3);
  });

  it("carries on from where the last scan stopped", async () => {
    folderSize = 1_000;

    const result = await listMediaFiles("site-1", "folder-1", { startOffset: 300, maxPages: 2 });

    expect(urls.map(offsetOf)).toEqual([300, 400]);
    expect(result.files[0].id).toBe("file-300");
    expect(result.nextOffset).toBe(500);
  });

  it("gives back what it has when the deadline passes, rather than running past it", async () => {
    folderSize = 1_000;
    const now = vi.spyOn(Date, "now");
    // Inside the deadline for the first two page checks, past it for the third.
    now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10_000);

    const result = await listMediaFiles("site-1", "folder-1", { deadline: 5_000 });

    expect(urls).toHaveLength(2);
    expect(result.files).toHaveLength(200);
    expect(result.truncated).toBe(true);
    expect(result.nextOffset).toBe(200);
  });

  it("does not run off the front of the folder on a bad stored offset", async () => {
    folderSize = 120;

    const result = await listMediaFiles("site-1", "folder-1", { startOffset: -50 });

    expect(urls.map(offsetOf)).toEqual([0, 100]);
    expect(result.files).toHaveLength(120);
  });
});
