import { describe, expect, it } from "vitest";
import { mediaState, type WixMediaFile } from "@/lib/wix/client";

/**
 * Jeff, 2026-09-16: a Parrish gallery had blanks in it. Wix had accepted the
 * import, handed back a file id, and then failed to fetch the picture. The
 * file exists and the gallery points at it; there is simply no image.
 *
 * The check only calls a file broken on positive evidence, because acting on
 * a misread would throw away thousands of good imports.
 */
const file = (patch: Partial<WixMediaFile> = {}): WixMediaFile => ({ id: "d0be81_a~mv2.jpeg", ...patch });

describe("mediaState", () => {
  it("is ready when Wix describes an image with dimensions", () => {
    expect(mediaState(file({ media: { image: { image: { width: 1600, height: 898 } } } }))).toBe("ready");
    expect(mediaState(file({ media: { image: { width: 1600, height: 898 } } }))).toBe("ready");
    expect(mediaState(file({ operationStatus: "READY", media: { image: { image: { width: 1, height: 1 } } } }))).toBe("ready");
  });

  it("is broken when Wix says the import failed", () => {
    expect(mediaState(file({ operationStatus: "FAILED" }))).toBe("broken");
    expect(mediaState(file({ operationStatus: "failed", media: { image: { image: { width: 1600, height: 898 } } } }))).toBe("broken");
  });

  it("is broken when Wix describes the media but has no picture in it", () => {
    expect(mediaState(file({ media: { image: {} } }))).toBe("broken");
    expect(mediaState(file({ media: { image: { image: {} } } }))).toBe("broken");
    expect(mediaState(file({ media: { image: { image: { width: 0, height: 0 } } } }))).toBe("broken");
  });

  it("is pending while Wix is still working", () => {
    expect(mediaState(file({ operationStatus: "PENDING" }))).toBe("pending");
  });

  it("is unknown, never broken, when the response carries no media at all", () => {
    // A payload change on Wix's side must not look like thousands of failures.
    expect(mediaState(file())).toBe("unknown");
    expect(mediaState(file({ operationStatus: "READY" }))).toBe("unknown");
    expect(mediaState(file({ displayName: "MFRA1-1.jpeg", sizeInBytes: "123456" }))).toBe("unknown");
  });
});
