import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// What the write-back asks of Supabase: the media map (read, then upsert)
// and the photos bucket (upload, public URL).
const uploads: { path: string; contentType: string }[] = [];
const upserts: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/client", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    upsert: async (row: Record<string, unknown>) => {
      upserts.push(row);
      return { error: null };
    },
  };
  return {
    supabase: {
      from: () => chain,
      storage: {
        from: () => ({
          upload: async (path: string, _data: Buffer, options: { contentType: string }) => {
            uploads.push({ path, contentType: options.contentType });
            return { error: null };
          },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://store.example.com/photos/${path}` } }),
        }),
      },
    },
  };
});

const imports: string[] = [];
let refuse: (url: string) => Error | null = () => null;

vi.mock("@/lib/wix/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wix/client")>();
  return {
    ...actual,
    importMediaFromUrl: vi.fn(async (_site: string, url: string, displayName: string) => {
      imports.push(url);
      const error = refuse(url);
      if (error) throw error;
      return { id: `file-${imports.length}.webp`, url, displayName, operationStatus: "PENDING" };
    }),
  };
});

import { importImage } from "@/lib/floorplans/writeback";
import { WixApiError } from "@/lib/wix/client";

const CARDEL =
  "https://firebasestorage.googleapis.com/v0/b/cardel-website.appspot.com/o/public%2Fposters%2F11830-richmond-trl_1536x1536.webp?alt=media&token=abc";
const gatewayPage = () => new WixApiError(400, "<!DOCTYPE html><html><title>400 Error: Bad Request | Wix.com</title></html>", "POST /site-media/v1/files/import");

describe("importImage: a picture Wix will not take from the builder's link", () => {
  beforeEach(async () => {
    uploads.length = 0;
    upserts.length = 0;
    imports.length = 0;
    const webp = await sharp({ create: { width: 6, height: 4, channels: 3, background: "#88aacc" } }).webp().toBuffer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(webp), { status: 200, headers: { "content-type": "image/webp" } }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    refuse = () => null;
  });

  it("imports it from a stored copy of the same bytes (Cardel, 2026-09-28)", async () => {
    refuse = (url) => (url === CARDEL ? gatewayPage() : null);
    const image = await importImage("lakewood", "wix-site", CARDEL, "11830-richmond-trail-photo-1.webp");
    expect(image).not.toBeNull();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].path).toMatch(/^floorplans\/lakewood\/copies\/[0-9a-f]{64}\.webp$/);
    expect(uploads[0].contentType).toBe("image/webp");
    expect(imports).toEqual([CARDEL, `https://store.example.com/photos/${uploads[0].path}`]);
    // Still known by the builder's link, so the next approval finds it cached.
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ site_id: "lakewood", source_url: CARDEL, width: 6, height: 4 });
    expect(image!.uri).toContain("#originWidth=6&originHeight=4");
  });

  it("keeps no copy of a picture Wix takes from the builder", async () => {
    expect(await importImage("lakewood", "wix-site", CARDEL, "photo.webp")).not.toBeNull();
    expect(uploads).toHaveLength(0);
    expect(imports).toEqual([CARDEL]);
  });

  it("leaves the picture out when Wix refuses the copy too", async () => {
    refuse = () => gatewayPage();
    expect(await importImage("lakewood", "wix-site", CARDEL, "photo.webp")).toBeNull();
    expect(imports).toHaveLength(2);
    expect(upserts).toHaveLength(0);
  });

  it("does not copy around a throttle: that is Wix's trouble, thrown for the run to wait out", async () => {
    refuse = () => new WixApiError(429, "slow down", "POST /site-media/v1/files/import");
    await expect(importImage("lakewood", "wix-site", CARDEL, "photo.webp")).rejects.toBeInstanceOf(WixApiError);
    expect(uploads).toHaveLength(0);
  });
});
