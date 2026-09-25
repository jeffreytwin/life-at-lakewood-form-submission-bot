import { describe, it, expect } from "vitest";
import { tourNumber, withKnownTours } from "@/lib/floorplans/tours";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const home = (name: string, raw: Record<string, unknown>, virtualTourUrl: string | null = null) =>
  ({ planKey: name.toLowerCase(), name, quickMoveIn: true, virtualTourUrl, galleryImages: [], blueprintImages: [], raw }) as unknown as NormalizedPlan;

// Lennar's Jefferson at Rye Ranch shows modsy's tour 3946 (2026-09-25).
const jefferson = "https://www.modsy.com/homejourney/embed/lennar/community/878/modelhome/3934/virtualtour/3946";

describe("Lennar's broken tour links, by the working tour of the same number (Jeff, 2026-09-25)", () => {
  it("reads the tour number from either link", () => {
    expect(tourNumber("https://hd.lennar.com/tours/3946/")).toBe("3946");
    expect(tourNumber(jefferson)).toBe("3946");
    expect(tourNumber("https://my.matterport.com/show/?m=abc")).toBeNull();
  });

  it("gives a home the community's modsy tour with its number, and leaves one with no match without", () => {
    const [known, unknown, own] = withKnownTours(
      [
        home("18118 Windrow St", { droppedTourUrl: "https://hd.lennar.com/tours/3946/" }),
        home("3534 Ambersweet Xing", { droppedTourUrl: "https://hd.lennar.com/tours/3914/" }),
        home("9019 Gulf Shore Ter", { droppedTourUrl: "https://hd.lennar.com/tours/3946/" }, "https://my.matterport.com/show/?m=abc"),
      ],
      [jefferson, "https://hd.lennar.com/tours/3914/", null]
    );
    expect(known.virtualTourUrl).toBe(jefferson);
    expect(unknown.virtualTourUrl).toBeNull();
    expect(own.virtualTourUrl).toBe("https://my.matterport.com/show/?m=abc");
  });
});
