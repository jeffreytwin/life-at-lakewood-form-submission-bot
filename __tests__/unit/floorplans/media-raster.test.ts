import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { isSvg, measureImageUrl, rasterizeSvg } from "@/lib/floorplans/media";
import { mediaVerdict } from "@/lib/wix/client";

const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800" viewBox="0 0 400 800"><rect x="20" y="20" width="360" height="760" fill="none" stroke="#000" stroke-width="4"/></svg>'
);

describe("isSvg", () => {
  it("knows an SVG by content type, by URL, or by its root element", () => {
    expect(isSvg(new Uint8Array(svg), "image/svg+xml", null)).toBe(true);
    expect(isSvg(new Uint8Array([0xff, 0xd8]), "image/jpeg", "https://cdn.example.com/plan.svg")).toBe(true);
    expect(isSvg(new Uint8Array(svg), null, "https://cdn.example.com/plan")).toBe(true);
    expect(isSvg(new Uint8Array(Buffer.from('<?xml version="1.0"?>\n<!-- drawing -->\n<svg xmlns="http://www.w3.org/2000/svg"/>')), null, null)).toBe(true);
    expect(isSvg(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg", "https://cdn.example.com/photo.jpg")).toBe(false);
  });
});

describe("rasterizeSvg", () => {
  it("renders a drawing to a PNG about 1600 wide on a white background", async () => {
    const raster = await rasterizeSvg(new Uint8Array(svg));
    expect(raster).not.toBeNull();
    expect(raster!.width).toBe(1600);
    expect(raster!.height).toBe(3200);
    const meta = await sharp(Buffer.from(raster!.png)).metadata();
    expect(meta.format).toBe("png");
    const { data } = await sharp(Buffer.from(raster!.png)).raw().toBuffer({ resolveWithObject: true });
    // The corner is outside the rectangle: white, not transparent black.
    expect(Array.from(data.subarray(0, 3))).toEqual([255, 255, 255]);
  });

  it("returns null for bytes that are not an SVG", async () => {
    expect(await rasterizeSvg(new TextEncoder().encode("<html>no</html>"))).toBeNull();
  });
});

describe("measureImageUrl on a drawing", () => {
  it("measures it, keeps the bytes, and says it is an SVG", async () => {
    const fetchImpl = (async () => new Response(new Uint8Array(svg), { status: 200, headers: { "content-type": "image/svg+xml" } })) as unknown as typeof fetch;
    const m = await measureImageUrl("https://cdn.example.com/plans/93G-01.svg", { fetchImpl });
    expect(m).toMatchObject({ width: 400, height: 800, svg: true });
    expect(m!.data.byteLength).toBe(svg.byteLength);
  });
});

describe("mediaVerdict", () => {
  it("passes an image Wix holds, waits on a pending one, and refuses vector art or a failed fetch", () => {
    expect(mediaVerdict({ id: "a", mediaType: "IMAGE", operationStatus: "READY", media: { image: { image: { width: 1600, height: 3200 } } } })).toBe("ready");
    expect(mediaVerdict({ id: "b", mediaType: "IMAGE", operationStatus: "PENDING" })).toBe("pending");
    expect(mediaVerdict({ id: "c.svg", mediaType: "VECTOR", operationStatus: "READY" })).toBe("not-image");
    expect(mediaVerdict({ id: "d", mediaType: "IMAGE", operationStatus: "FAILED" })).toBe("broken");
    expect(mediaVerdict(null)).toBe("unknown");
  });
});
