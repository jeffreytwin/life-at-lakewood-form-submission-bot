import { describe, expect, it } from "vitest";
import { zondaCountsIn, zondaPlansIn } from "@/lib/floorplans/extractors/zonda";
import { roomCount } from "@/lib/floorplans/standardize";

// Homes by Towne's Tideland at Palmera, as its page and its viewer's data give it (Jeff, 2026-09-26).
const guid = "1146a39d-4a7a-4f96-b5ca-3e20cc352913";
const page = `&quot;embed_code&quot;:[0,&quot;https://apps.zondavirtual.com/alphaplan/index.html?plan=${guid}&quot;] …
  &quot;embed_code&quot;:[0,&quot;https://apps.zondavirtual.com/alphaplan/index.html?plan=${guid}&quot;]`;
const data = `{"VPSSetting":{"BedroomSuffix":"Bedrooms","BathroomSuffix":"Bathrooms"},"Attachments":[],"Bathrooms":"3.5-4","Bedrooms":"3-4","BuilderId":395,"BuilderName":"Homes by Towne","CombinedName":"Tideland"}`;

describe("Zonda's floor plan viewer (Homes by Towne)", () => {
  it("finds the viewers a page embeds, once each", () => {
    expect(zondaPlansIn(page)).toEqual([guid]);
    expect(zondaPlansIn("<p>no viewer</p>")).toEqual([]);
  });

  it("reads the plan's name and its ranges, not the labels beside them", () => {
    expect(zondaCountsIn(data)).toEqual({ name: "Tideland", beds: "3-4", baths: "3.5-4" });
  });

  it("gives the top of each range as the site shows it", () => {
    const counts = zondaCountsIn(data);
    expect(roomCount(counts.beds)).toBe("4");
    expect(roomCount(counts.baths)).toBe("4");
  });
});
