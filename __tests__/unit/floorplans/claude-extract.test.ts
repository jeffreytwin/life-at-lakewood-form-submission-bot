import { describe, it, expect } from "vitest";
import { tourUrlIn } from "@/lib/floorplans/extractors/claude-extract";

describe("tourUrlIn", () => {
  it("finds a tour the page keeps in its own scripts, which distillation drops", () => {
    // Stock's plan pages carry the tour in the React payload, not in a link
    // or an iframe (Wyndam IV, probed 2026-09-21).
    const payload =
      '<script>self.__next_f.push([1,"...\\"$L31\\",\\"3019\\",{\\"src\\":\\"https://my.matterport.com/show/?m=K1hZHtKa6ok\\",\\"title\\":\\"Virtual Tour\\"}..."])</script>';
    expect(tourUrlIn(payload)).toBe("https://my.matterport.com/show/?m=K1hZHtKa6ok");
  });

  it("reads a payload that escapes its slashes", () => {
    expect(tourUrlIn('{"src":"https:\\/\\/my.matterport.com\\/show\\/?m=Rb3LScZcMBr"}')).toBe(
      "https://my.matterport.com/show/?m=Rb3LScZcMBr"
    );
  });

  it("takes the first tour where a page offers several", () => {
    const two =
      '{"a":"https://my.matterport.com/show/?m=K1hZHtKa6ok","b":"https://my.matterport.com/show/?m=Rb3LScZcMBr"}';
    expect(tourUrlIn(two)).toBe("https://my.matterport.com/show/?m=K1hZHtKa6ok");
  });

  it("knows the other hosts builders use, and says nothing for a page with none", () => {
    expect(tourUrlIn('<a href="https://www.insidemaps.com/tours/abc123">Tour</a>')).toBe(
      "https://www.insidemaps.com/tours/abc123"
    );
    expect(tourUrlIn("<p>No tour here, just a Google Tag Manager iframe.</p>")).toBeNull();
    // A page's own marketing copy is not a tour link.
    expect(tourUrlIn('<meta content="View elevations, specs, virtual tours, and available homes."/>')).toBeNull();
  });
});
