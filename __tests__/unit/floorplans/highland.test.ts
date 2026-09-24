import { describe, expect, it } from "vitest";
import { communityIdIn, fromRecord, pageLinks } from "@/lib/floorplans/extractors/highland";

const AVIARY = "https://www.highlandhomes.org/new-homes/florida/bradenton-sarasota/parrish/aviary-at-rutland-ranch";

describe("communityIdIn", () => {
  it("reads the id the page keeps for its feed", () => {
    expect(communityIdIn(`<input type="hidden" name="communityid" id="communityid" disabled class="form-control" placeholder="Community ID" value="2">`)).toBe("2");
    expect(communityIdIn(`<input type="hidden" name="cityid" value="0">`)).toBeNull();
  });
});

describe("fromRecord", () => {
  const links = pageLinks(`<a href="${AVIARY}/parker">Parker</a><a href="/new-homes/florida/bradenton-sarasota/parrish/aviary-at-rutland-ranch/parker/avi-00-004">Home</a>`, AVIARY);

  // Aviary at Rutland Ranch as the feed gave it (2026-09-23).
  it("takes a home for sale by its street, tied to its plan", () => {
    const home = fromRecord(
      {
        name: "Parsyn",
        price: 369900,
        bed: 3,
        bath: 2,
        halfbath: 0,
        garage: 2,
        totalsqft: 1545,
        address: "7027 161st Terrace East, Parrish, FL 34219",
        lot: "AV3-00-419",
        inventoryhomesid: 3285,
        modelid: 105,
        status: "Move-In Ready",
        virtualtour: `<iframe id="/tours/WhJRZbaWI" allowfullscreen src="https://tours.wh360tours.com/tours/WhJRZbaWI"></iframe>`,
      },
      links
    )!;
    expect(home).toMatchObject({
      name: "7027 161st Terrace East",
      price: 369900,
      beds: "3",
      baths: "2",
      sqft: 1545,
      garages: "2 car",
      quickMoveIn: true,
      relatedPlanName: "Parsyn",
      virtualTourUrl: "https://tours.wh360tours.com/tours/WhJRZbaWI",
      sourceUrl: `${AVIARY}/parsyn/AV3-00-419`,
    });
  });

  it("takes a plan by its name, at the page the community links or the one the site gives every plan", () => {
    expect(fromRecord({ name: "Parker", price: 399900, bed: 4, bath: 2, halfbath: 1, totalsqft: 1715 }, links)).toMatchObject({
      name: "Parker",
      quickMoveIn: false,
      baths: "2.5",
      sourceUrl: `${AVIARY}/parker`,
    });
    expect(fromRecord({ name: "Summerlyn ll", price: 449900 }, links)!.sourceUrl).toBe(`${AVIARY}/summerlyn-ii`);
  });

  it("finds a home's page linked under its plan's", () => {
    expect(fromRecord({ name: "Parker", address: "6934 161st Terrace East", lot: "AVI-00-004", price: 1 }, links)!.sourceUrl).toBe(`${AVIARY}/parker/avi-00-004`);
  });
});
