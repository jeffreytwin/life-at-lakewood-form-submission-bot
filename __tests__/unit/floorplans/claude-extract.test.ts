import { describe, it, expect } from "vitest";
import { orderPhotos, tourLinkIn, tourUrlIn } from "@/lib/floorplans/extractors/claude-extract";

describe("tourUrlIn", () => {
  it("finds a Zillow 3D Home, which carries no tour-looking words at all", () => {
    expect(
      tourUrlIn('data-x="https://www.zillow.com/view-imx/4dee0ea7-5160-4d4f-980a-e8ec0db8b017?wl=true"')
    ).toBe("https://www.zillow.com/view-imx/4dee0ea7-5160-4d4f-980a-e8ec0db8b017");
  });

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

describe("tourLinkIn", () => {
  it("takes the link a page labels as its tour, whatever host it points at", () => {
    // SimplyDwell's tour is a Zillow 3D Home behind "Take a Virtual Tour!".
    const html =
      '<div class="sd-ov__desc-actions"><a class="sd-ov__btn-vtour" ' +
      'href="https://www.zillow.com/view-imx/4dee0ea7-5160-4d4f-980a-e8ec0db8b017?wl=true&#038;initialViewType=pano" ' +
      'target="_blank" rel="noopener"><span>Take a Virtual Tour!</span></a></div>';
    expect(tourLinkIn(html)).toBe(
      "https://www.zillow.com/view-imx/4dee0ea7-5160-4d4f-980a-e8ec0db8b017?wl=true&initialViewType=pano"
    );
  });

  it("knows the other words builders put on the link", () => {
    const link = (label: string) => `<a href="https://tours.example.com/x">${label}</a>`;
    expect(tourLinkIn(link("3D Tour"))).toBe("https://tours.example.com/x");
    expect(tourLinkIn(link("Tour this home"))).toBe("https://tours.example.com/x");
    expect(tourLinkIn(link("<span>Video Tour</span>"))).toBe("https://tours.example.com/x");
  });

  it("passes over a link that is not a tour, and a relative one", () => {
    expect(tourLinkIn('<a href="https://x.test/plans">Tour our communities</a>')).toBeNull();
    expect(tourLinkIn('<a href="/virtual-tour/">Virtual Tour</a>')).toBeNull();
    expect(tourLinkIn("<p>Virtual Tour</p>")).toBeNull();
  });
});

describe("orderPhotos", () => {
  const sd = (name: string) => `https://simplydwellhomes.com/wp-content/uploads/2026/06/${name}`;

  it("leads with the hero, then the rooms, and puts the other elevations last", () => {
    // SimplyDwell prints three elevations per plan and all three were
    // landing in front of the interiors (Jeff, 2026-09-22).
    const ordered = orderPhotos([
      sd("Azalea-40-1817_Elevation-A-1.webp"),
      sd("Azalea-40-1817_Elevation-B-1.webp"),
      sd("Azalea-40-1817_Elevation-C.webp"),
      sd("4638-8-scaled-1.webp"),
      sd("4638-12-scaled-1.webp"),
    ]);
    expect(ordered.urls).toEqual([
      sd("Azalea-40-1817_Elevation-A-1.webp"),
      sd("4638-8-scaled-1.webp"),
      sd("4638-12-scaled-1.webp"),
      sd("Azalea-40-1817_Elevation-B-1.webp"),
      sd("Azalea-40-1817_Elevation-C.webp"),
    ]);
    expect(ordered.meta[sd("Azalea-40-1817_Elevation-A-1.webp")].kind).toBe("primary");
    expect(ordered.meta[sd("Azalea-40-1817_Elevation-C.webp")].room).toBe("exterior");
  });

  it("sorts by the rooms a file name does say", () => {
    const ordered = orderPhotos([
      sd("front-elevation.webp"),
      sd("owners-bath.webp"),
      sd("kitchen-island.webp"),
      sd("great-room.webp"),
    ]);
    expect(ordered.urls).toEqual([
      sd("front-elevation.webp"),
      sd("kitchen-island.webp"),
      sd("great-room.webp"),
      sd("owners-bath.webp"),
    ]);
  });

  it("reads nothing into a media store's own id", () => {
    // "bed" is valid hex, and a UUID that spells it is not a bedroom.
    const opaque = "https://fabrik.blob.core.windows.net/public/0bed8fcc-430d-480c-919f-a55d52c53bd8_lg.jpg";
    const kitchen = sd("kitchen.webp");
    const ordered = orderPhotos([sd("elevation-a.webp"), opaque, kitchen]);
    expect(ordered.meta[opaque].room).toBeNull();
    expect(ordered.urls).toEqual([sd("elevation-a.webp"), kitchen, opaque]);
  });
});
