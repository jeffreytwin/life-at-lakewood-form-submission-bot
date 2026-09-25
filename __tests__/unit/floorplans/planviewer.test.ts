import { describe, it, expect } from "vitest";
import { elevationsOf, floorDrawingUrl, floorSvg, floorsOf, planViewerDataUrl, planViewersIn, tourOf } from "@/lib/floorplans/extractors/planviewer";

// The shape of CPS's plan data for Neal Signature's Monterey 2 at Waterbury
// Park (planviewer.cpsusa.com/nealsh/api/planviewer/2056774, 2026-09-24),
// cut to what is read.
const drawing = (floor: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="612" height="792"><g id="${floor}"><rect x="1" y="1" width="2" height="2"/></g></svg>`;
const data = {
  planId: 2056774,
  planName: "Monterey 2",
  floorplates: [
    { id: "First_Floor", svg: { data: Buffer.from(drawing("First_Floor")).toString("base64") } },
    { id: "Second_Floor", svg: { data: Buffer.from(drawing("Second_Floor")).toString("base64") } },
    { id: "Broken", svg: { data: Buffer.from("not a drawing").toString("base64") } },
  ],
  elevations: [
    { id: 2056775, ref_ID: 2056784, name: "NSH-Monterey_BW1-CS1-small.png", description: "Elevation BW1" },
    { id: 2056776, ref_ID: 2056786, name: "NSH-Monterey_FH1-CS1A-small.png", description: "Elevation FH1A" },
  ],
  links: { tour3DUrl: "", tourVideoUrl: "" },
};

describe("CPS's plan viewer (Neal Signature's floor plans, 2026-09-24)", () => {
  it("finds the viewer a plan page embeds, once", () => {
    const html = `<iframe src="https://planviewer.cpsusa.com/nealsh/floorplan/2056774?hideheader=true&elevations=false"></iframe>
      <a href="https://planviewer.cpsusa.com/nealsh/floorplan/2056774">Personalize</a>`;
    expect(planViewersIn(html)).toEqual([{ company: "nealsh", plan: "2056774" }]);
    expect(planViewersIn("<p>no viewer</p>")).toEqual([]);
  });

  it("reads the plan's data from the viewer's own address", () => {
    expect(planViewerDataUrl({ company: "nealsh", plan: "2056774" })).toBe("https://planviewer.cpsusa.com/nealsh/api/planviewer/2056774");
    expect(planViewerDataUrl({ company: "../x", plan: "1" })).toBeNull();
  });

  it("takes each floor that carries a drawing, and the drawing itself", () => {
    expect(floorsOf(data)).toEqual(["First_Floor", "Second_Floor"]);
    expect(floorSvg(data, "First_Floor")).toBe(drawing("First_Floor"));
    expect(floorSvg(data, "Broken")).toBeNull();
    expect(floorSvg(data, "Third_Floor")).toBeNull();
    expect(floorsOf({})).toEqual([]);
  });

  it("gives each floor an address the Hub serves it at", () => {
    const ref = { company: "nealsh", plan: "2056774" };
    expect(floorDrawingUrl(ref, "First_Floor", "https://hub.example.com")).toBe(
      "https://hub.example.com/api/floorplans/planviewer/nealsh/2056774/First_Floor.svg"
    );
    expect(floorDrawingUrl(ref, "First_Floor", null)).toBeNull();
    expect(floorDrawingUrl(ref, "../x", "https://hub.example.com")).toBeNull();
  });

  it("takes the elevations as pictures of the outside, by the names the builder gave them", () => {
    expect(elevationsOf({ company: "nealsh", plan: "2056774" }, data)).toEqual([
      { src: "https://planviewer.cpsusa.com/nealsh/api/attachment/2056784", caption: "Elevation BW1" },
      { src: "https://planviewer.cpsusa.com/nealsh/api/attachment/2056786", caption: "Elevation FH1A" },
    ]);
  });

  it("takes a tour only where the builder gave one", () => {
    expect(tourOf(data)).toBeNull();
    expect(tourOf({ links: { tour3DUrl: " https://my.matterport.com/show/?m=abc " } })).toBe("https://my.matterport.com/show/?m=abc");
  });
});
