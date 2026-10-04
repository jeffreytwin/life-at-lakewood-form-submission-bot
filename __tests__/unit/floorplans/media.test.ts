import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  forgetRefusingHosts,
  MAX_IMAGE_BYTES,
  measureImageBytes,
  measureImageUrl,
  REFUSED_FETCH_WAITS_MS,
  wixFileIdOf,
} from "@/lib/floorplans/media";

/**
 * A wix:image URI renders only with the picture's origin dimensions; the
 * listings engine learned that on 2026-09-16 and the floor plan write-back
 * had the same bug. Builder photos carry no size metadata, so the bytes are
 * measured before import, and a photo that cannot be measured is left out.
 */
/** A fresh Uint8Array over its own ArrayBuffer, which is what Response accepts as a body. */
const png = async (width: number, height: number) =>
  new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#808080" } }).png().toBuffer());

describe("measureImageBytes", () => {
  it("reads the pixel size", async () => {
    expect(await measureImageBytes(await png(3, 2))).toEqual({ width: 3, height: 2 });
  });

  it("swaps the axes for a quarter-turn EXIF orientation, since that is how the picture displays", async () => {
    const jpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#808080" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(await measureImageBytes(new Uint8Array(jpeg))).toEqual({ width: 2, height: 3 });
  });

  it("measures an SVG blueprint", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30"/></svg>');
    expect(await measureImageBytes(new Uint8Array(svg))).toEqual({ width: 40, height: 30 });
  });

  it("returns null for bytes that are not an image", async () => {
    expect(await measureImageBytes(new TextEncoder().encode("<html>not found</html>"))).toBeNull();
    expect(await measureImageBytes(new Uint8Array())).toBeNull();
  });
});

describe("measureImageUrl", () => {
  const answer = (body: BodyInit | null, init: ResponseInit) => (async () => new Response(body, init)) as unknown as typeof fetch;
  const noWait: (ms: number) => Promise<void> = async () => undefined;
  beforeEach(() => forgetRefusingHosts());

  it("fetches, measures and hashes a photo", async () => {
    const bytes = await png(4, 5);
    const fetchImpl = vi.fn(answer(bytes, { status: 200, headers: { "content-type": "image/png" } }));
    const m = await measureImageUrl("https://cdn.example.com/a.png", { fetchImpl });
    expect(m).toMatchObject({ width: 4, height: 5, bytes: bytes.byteLength });
    expect(m?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchImpl).toHaveBeenCalledWith("https://cdn.example.com/a.png", expect.objectContaining({ redirect: "follow" }));
  });

  it("leaves out a URL that answers with an error, a web page, or a body too big for a photo", async () => {
    const bytes = await png(4, 5);
    const cases = [
      answer(bytes, { status: 404 }),
      answer("<html>gone</html>", { status: 200, headers: { "content-type": "text/html" } }),
      answer(bytes, { status: 200, headers: { "content-type": "image/png", "content-length": String(MAX_IMAGE_BYTES + 1) } }),
    ];
    for (const fetchImpl of cases) {
      expect(await measureImageUrl("https://cdn.example.com/a.png", { fetchImpl })).toBeNull();
    }
  });

  it("leaves out a fetch that throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await measureImageUrl("https://cdn.example.com/a.png", { fetchImpl, sleep: noWait })).toBeNull();
  });

  it("tries a refused fetch again after a wait, as Cloudflare turned the server away from lakewoodranch.com for a moment", async () => {
    const bytes = await png(4, 5);
    const replies = [new Response(null, { status: 403 }), new Response(null, { status: 429 }), new Response(bytes, { status: 200, headers: { "content-type": "image/png" } })];
    const fetchImpl = vi.fn(async () => replies.shift()!) as unknown as typeof fetch;
    const sleep = vi.fn(noWait);
    expect(await measureImageUrl("https://lakewoodranch.com/a.jpg", { fetchImpl, sleep })).toMatchObject({ width: 4, height: 5 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(REFUSED_FETCH_WAITS_MS);
  });

  it("waits what Retry-After asks, and gives up on a wait too long to sit out", async () => {
    const bytes = await png(4, 5);
    let replies = [new Response(null, { status: 503, headers: { "retry-after": "2" } }), new Response(bytes, { status: 200, headers: { "content-type": "image/png" } })];
    const sleep = vi.fn(noWait);
    const fetchImpl = vi.fn(async () => replies.shift()!) as unknown as typeof fetch;
    expect(await measureImageUrl("https://a.example.com/a.png", { fetchImpl, sleep })).not.toBeNull();
    expect(sleep).toHaveBeenCalledWith(2000);

    replies = [new Response(null, { status: 429, headers: { "retry-after": "3600" } })];
    const once = vi.fn(async () => replies.shift()!) as unknown as typeof fetch;
    expect(await measureImageUrl("https://b.example.com/a.png", { fetchImpl: once, sleep })).toBeNull();
    expect(once).toHaveBeenCalledTimes(1);
  });

  it("does not try a 404 again: the photo is gone, not refused", async () => {
    const fetchImpl = vi.fn(answer(null, { status: 404 }));
    expect(await measureImageUrl("https://cdn.example.com/a.png", { fetchImpl, sleep: noWait })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives a host that refused through every wait one try per photo for a while", async () => {
    const sleep = vi.fn(noWait);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
    expect(await measureImageUrl("https://lakewoodranch.com/1.jpg", { fetchImpl, sleep })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(REFUSED_FETCH_WAITS_MS.length + 1);
    expect(await measureImageUrl("https://lakewoodranch.com/2.jpg", { fetchImpl, sleep })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(REFUSED_FETCH_WAITS_MS.length + 2);
    // Another host is not held to it.
    expect(await measureImageUrl("https://res.cloudinary.com/3.jpg", { fetchImpl, sleep })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2 * REFUSED_FETCH_WAITS_MS.length + 3);
  });
});

describe("wixFileIdOf", () => {
  it("reads the file id out of a stored URI, with or without dimensions, or takes a bare id", () => {
    expect(wixFileIdOf("wix:image://v1/d0be81_ab48~mv2.jpg/aragon-photo-1.jpg")).toBe("d0be81_ab48~mv2.jpg");
    expect(wixFileIdOf("wix:image://v1/d0be81_ab48~mv2.jpg/a.jpg#originWidth=1920&originHeight=1240")).toBe("d0be81_ab48~mv2.jpg");
    expect(wixFileIdOf("d0be81_1ae1.svg")).toBe("d0be81_1ae1.svg");
  });

  it("rejects anything else, so a corrupt row is re-imported rather than trusted", () => {
    expect(wixFileIdOf(null)).toBeNull();
    expect(wixFileIdOf(undefined)).toBeNull();
    expect(wixFileIdOf("")).toBeNull();
    expect(wixFileIdOf("https://static.wixstatic.com/media/x.jpg")).toBeNull();
  });
});
