import { describe, expect, it } from "vitest";
import { isRenderableWixImage, wixImageUri } from "@/lib/listings/types";

/**
 * Jeff, 2026-09-16: five Longboat Key listings showed one stock photo each
 * instead of their own. The engine's imports were writing a Wix image URI
 * without its origin dimensions, and Wix answers that by refusing the whole
 * gallery and falling back to the editor's placeholder.
 */
describe("wixImageUri", () => {
  it("carries the origin dimensions Wix needs", () => {
    expect(wixImageUri("d0be81_abc~mv2.jpeg", "MFRA1-1.jpeg", 1600, 898)).toBe(
      "wix:image://v1/d0be81_abc~mv2.jpeg/MFRA1-1.jpeg#originWidth=1600&originHeight=898"
    );
  });

  it("escapes the display name and rounds the dimensions", () => {
    expect(wixImageUri("f1~mv2.jpeg", "a b&c.jpeg", 1600.4, 898.6)).toBe(
      "wix:image://v1/f1~mv2.jpeg/a%20b%26c.jpeg#originWidth=1600&originHeight=899"
    );
  });

  it("returns null rather than a URI nothing can render", () => {
    expect(wixImageUri("f1~mv2.jpeg", "a.jpeg", null, 898)).toBeNull();
    expect(wixImageUri("f1~mv2.jpeg", "a.jpeg", 1600, null)).toBeNull();
    expect(wixImageUri("f1~mv2.jpeg", "a.jpeg", 0, 0)).toBeNull();
    expect(wixImageUri("", "a.jpeg", 1600, 898)).toBeNull();
  });
});

describe("isRenderableWixImage", () => {
  it("accepts what Wix itself wrote for the seeded photos", () => {
    expect(isRenderableWixImage("wix:image://v1/01d466_2de82bc~mv2.jpeg/8d452d84-73ce.jpeg#originWidth=1600&originHeight=899")).toBe(true);
  });

  it("rejects the form that broke the galleries and anything else odd", () => {
    expect(isRenderableWixImage("wix:image://v1/d0be81_22cb840~mv2.jpeg/MFRA4667206-1.jpeg")).toBe(false);
    expect(isRenderableWixImage("wix:image://v1/f1~mv2.jpeg/a.jpeg#originWidth=0&originHeight=0")).toBe(false);
    expect(isRenderableWixImage("wix:image://v1/f1~mv2.jpeg/a.jpeg#originWidth=1600")).toBe(false);
    expect(isRenderableWixImage("https://static.wixstatic.com/media/f1.jpeg")).toBe(false);
    expect(isRenderableWixImage(null)).toBe(false);
    expect(isRenderableWixImage(undefined)).toBe(false);
  });
});
