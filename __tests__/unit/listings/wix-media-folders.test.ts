import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shared/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { FOLDER_PAGE_CAP, WixApiError, findMediaFolder, listMediaFolders } from "@/lib/wix/client";

const folder = (i: number) => ({ id: `folder-${i}`, displayName: `Folder ${i}`, parentFolderId: "media-root" });
const page = (items: unknown[]) => new Response(JSON.stringify({ folders: items }), { status: 200, headers: { "content-type": "application/json" } });

function stubFetch(responder: (url: string, n: number) => Response) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return responder(url, urls.length);
  }));
  process.env.WIX_API_KEY = process.env.WIX_API_KEY || "test-key";
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe("listMediaFolders", () => {
  it("reads full pages until a short one", async () => {
    const urls = stubFetch((url, n) => (n === 1 ? page(Array.from({ length: 100 }, (_, i) => folder(i))) : page([folder(100), folder(101)])));
    const folders = await listMediaFolders("site-1");
    expect(folders).toHaveLength(102);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("parentFolderId=media-root");
    expect(urls[0]).toContain("paging.offset=0");
    expect(urls[1]).toContain("paging.offset=100");
  });

  it("stops as soon as a page repeats a folder, so an ignored offset cannot loop", async () => {
    const same = Array.from({ length: 100 }, (_, i) => folder(i));
    const urls = stubFetch(() => page(same));
    const folders = await listMediaFolders("site-1");
    expect(folders).toHaveLength(100);
    expect(urls).toHaveLength(2);
  });

  it("never reads more than the page cap", async () => {
    const urls = stubFetch((url, n) => page(Array.from({ length: 100 }, (_, i) => folder(n * 1000 + i))));
    const folders = await listMediaFolders("site-1");
    expect(urls).toHaveLength(FOLDER_PAGE_CAP);
    expect(folders).toHaveLength(FOLDER_PAGE_CAP * 100);
  });

  it("finds a folder by name regardless of case", async () => {
    stubFetch(() => page([folder(1), { id: "f-parrish", displayName: "ParrishListingPhotos" }]));
    expect((await findMediaFolder("site-1", "parrishlistingphotos"))?.id).toBe("f-parrish");
    expect(await findMediaFolder("site-1", "nope")).toBeNull();
  });
});

describe("WixApiError", () => {
  it("keeps a short body and replaces an HTML error page with one phrase", () => {
    expect(new WixApiError(400, '{"message":"bad"}', "POST /x").message).toBe('Wix API POST /x: 400 {"message":"bad"}');
    const html = new WixApiError(500, "<!DOCTYPE html>\n<html><head><title>500 Error</title></head></html>", "POST /site-media/v1/files/import");
    expect(html.message).toBe("Wix API POST /site-media/v1/files/import: 500 (Wix answered with an HTML error page)");
    expect(html.body).toContain("<html>");
  });
});
