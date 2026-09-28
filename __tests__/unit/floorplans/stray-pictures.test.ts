import { describe, expect, it } from "vitest";
import { isBadge, withoutBadges, withoutOtherPlansPictures } from "@/lib/floorplans/stray-pictures";
import type { NormalizedPlan } from "@/lib/floorplans/types";

// Ashton Woods' Duval (Signature) at Oakfield Trails, as the queue had it (Jeff, 2026-09-28).
const widen = (id: string, file: string) => `https://awh.widen.net/content/${id}/jpeg/${file}`;
const front = widen("12r0stvyo9", "TAM_OTR50_Duval_ELEV_Day_2.jpg");
const kitchen = widen("ujmba0cs37", "TAM_OTR50_Duval_KITCH_1.jpg?w=1024&h=768");
const badge = "https://awh.widen.net/content/bvpzwnbzxa/web/cms_Newsweek_US-Trustworthy_2026_Hor-1.png";
const plant = "https://awh.widen.net/content/1l5y0ghfrm/webp/cms_Plant-Q-Scheme-128.jpg";
const coquina = "https://awh.widen.net/content/pcb5luuzid/webp/cms_Coquina-A-3-Car-Scheme-102.jpg";
const griffin = "https://awh.widen.net/content/qm7dbks62k/webp/cms_Griffin-T-Scheme-117.jpg";
const duvalR = widen("ordowkn22d", "cms_Duval-R-Right_Garage-Scheme_121.jpg");

const plan = (name: string, galleryImages: string[], over: Partial<NormalizedPlan> = {}): NormalizedPlan => ({
  planKey: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  name,
  price: 500000,
  priceDisplay: "$500,000",
  beds: "4",
  baths: "3",
  sqft: 2500,
  garages: "2 car",
  homeType: "Single Family Home",
  quickMoveIn: false,
  comingSoon: false,
  sourceUrl: null,
  galleryImages,
  blueprintImages: [],
  ...over,
});

describe("a badge is no photo", () => {
  it("knows Newsweek's badge and a logo, and not a home", () => {
    expect(isBadge(badge)).toBe(true);
    expect(isBadge("https://cdn.example.com/brand/Ashton-Woods-Logo.png")).toBe(true);
    expect(isBadge(front)).toBe(false);
    expect(isBadge("https://cdn.example.com/Kitchen-Island-Colors.jpg")).toBe(false);
  });

  it("takes it out of a gallery, with what was said of it", () => {
    const [got] = withoutBadges([plan("Duval (Signature)", [front, kitchen, badge], { galleryMeta: { [badge]: { kind: "photo", room: "other", caption: null } } })]);
    expect(got.galleryImages).toEqual([front, kitchen]);
    expect(got.galleryMeta).toEqual({});
  });
});

describe("another plan's pictures are not this plan's (Ashton Woods' Oakfield Trails)", () => {
  const run = [
    plan("Duval (Signature)", [front, kitchen, plant, coquina, griffin, duvalR]),
    plan("Plant (Signature)", [plant]),
    plan("Coquina", [coquina]),
    plan("Griffin (Traditional)", [griffin]),
  ];

  it("keeps the plan's own pictures and drops those named for the community's other plans", () => {
    expect(withoutOtherPlansPictures(run)[0].galleryImages).toEqual([front, kitchen, duvalR]);
  });

  it("leaves each other plan its own", () => {
    expect(withoutOtherPlansPictures(run).slice(1).map((p) => p.galleryImages)).toEqual([[plant], [coquina], [griffin]]);
  });

  it("does not take one plan for another whose name holds it", () => {
    const bahia = "https://cdn.example.com/bahia-elev-a.jpg";
    const bonus = "https://cdn.example.com/bahia-bonus-elev-a.jpg";
    const got = withoutOtherPlansPictures([plan("Bahia", [bahia, bonus]), plan("Bahia with Bonus", [bonus, bahia])]);
    expect(got.map((p) => p.galleryImages)).toEqual([[bahia, bonus], [bonus, bahia]]);
  });

  it("keeps a plan's first picture, and leaves homes alone", () => {
    const home = plan("10046 Hidden Hammock Loop", [plant, coquina], { quickMoveIn: true });
    const got = withoutOtherPlansPictures([plan("Duval", [plant, front]), plan("Plant", [plant]), home]);
    expect(got[0].galleryImages).toEqual([plant, front]);
    expect(got[2]).toBe(home);
  });
});
