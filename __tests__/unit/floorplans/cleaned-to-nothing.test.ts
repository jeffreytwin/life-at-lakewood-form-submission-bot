import { describe, expect, it } from "vitest";
import { cleanedToNothing, withCopiesTakenOut, writesWhatIsLive } from "@/lib/floorplans/sort-queue";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// Neal's 17810 Sylvester Drive, "1 photo → 1 photo" approved Oct 6, 10, 11
// and 12 with nothing different to see (Jeff, 2026-10-13).
const up = "https://images.nealcommunities.com/wp-content/uploads";
const rendering = `${up}/2024/10/15100936/new-homes-wellen-park-florida-palmera-vision-33-2956-elevation-i3.jpg?auto=format%2Ccompress&#038;fit=crop&#038;ar=16%3A9&#038;w=1600`;
const uploadedAgain = `${up}/2026/10/05132538/Vision-2-33-2962-Elevation-I2-scaled.jpg?auto=format%2Ccompress&fit=max&w=1000`;
const lanai = `${up}/2026/10/032_Palmera_WillisSmith_RyanGammaPhotography.jpg?auto=format%2Ccompress&#038;fit=crop&#038;ar=16%3A9&#038;w=1600`;
const porch = `${up}/2026/10/033_Palmera_WillisSmith_RyanGammaPhotography.jpg`;

const home = (galleryImages: string[], over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: "17810-sylvester-drive",
  name: "17810 Sylvester Drive",
  price: 650000,
  priceDisplay: "$650,000",
  beds: "4",
  baths: "3",
  sqft: 2962,
  garages: "3 car",
  homeType: "Single-Family Home",
  quickMoveIn: true,
  comingSoon: false,
  sourceUrl: "https://nealcommunities.com/new-homes/palmera/vision-3-5/17810-sylvester-drive-vision2-102/",
  galleryImages,
  blueprintImages: [],
  ...over,
});

describe("a waiting photos change the copy check leaves writing what is live", () => {
  const live = home([rendering, lanai]);
  // Tonight's run led with the rendering uploaded again; the copy check
  // (pixels: one photograph) keeps the original in its place.
  const queued = home([uploadedAgain, lanai, rendering]);
  const cleaned = withCopiesTakenOut(queued, [[0, 2]]).record;

  it("is nothing once the copy is out: the lead is the photo the home shows already", () => {
    expect(cleaned.galleryImages[0]).toBe(rendering);
    expect(cleaned.copiesOf).toEqual({ [uploadedAgain]: rendering });
    expect(writesWhatIsLive(live, queued)).toBe(false);
    expect(writesWhatIsLive(live, cleaned)).toBe(true);
    expect(cleanedToNothing(live, queued, cleaned)).toBe(true);
  });

  it("is still a change when the check leaves a new lead", () => {
    const newLead = home([porch, lanai, rendering]);
    expect(cleanedToNothing(live, newLead, withCopiesTakenOut(newLead, []).record)).toBe(false);
  });

  it("leaves be a change that wrote the live photos before the check touched it (a plan written whole again)", () => {
    expect(cleanedToNothing(live, live, live)).toBe(false);
  });

  it("compares a floor plan's whole gallery, in order", () => {
    const plan = (gallery: string[]) => home(gallery, { quickMoveIn: false, planKey: "vision-2" });
    expect(writesWhatIsLive(plan([rendering, lanai]), plan([rendering, lanai]))).toBe(true);
    expect(writesWhatIsLive(plan([rendering, lanai]), plan([lanai, rendering]))).toBe(false);
    expect(writesWhatIsLive(plan([rendering, lanai]), plan([rendering, lanai, porch]))).toBe(false);
    expect(writesWhatIsLive(null, plan([rendering]))).toBe(false);
  });
});
