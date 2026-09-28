import { describe, expect, it } from "vitest";
import { isBadge, isBanner, withoutBadges, withoutBanners, withoutOtherPlansPictures } from "@/lib/floorplans/stray-pictures";
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

describe("a page's banner is no photo (Homes by Towne's Palmera, Jeff 2026-09-28)", () => {
  const cdn = "https://d195jfz94fv5eb.cloudfront.net/uploads";
  const hero = (n: number) => `${cdn}/hero/florida/palmera-at-wellen-park/fl-palmera-at-wellen-park-tideland-lot281-model-${n}-1920.jpg`;
  const photo = (n: number) => `${cdn}/gallery/florida/palmera-at-wellen-park/fl-palmera-at-wellen-park-tideland-lot281-model-${n}-900.jpg`;

  it("knows a banner by the folder the site keeps it in", () => {
    expect(isBanner(hero(1))).toBe(true);
    expect(isBanner("https://cdn.example.com/banners/spring-event.jpg?w=1920")).toBe(true);
    expect(isBanner(photo(1))).toBe(false);
    expect(isBanner("https://cdn.example.com/uploads/hero-kitchen.jpg")).toBe(false);
  });

  it("takes the banners out of a plan's photos, and what was said of them", () => {
    const tideland = plan("Tideland", [hero(1), photo(3), hero(3), photo(2), hero(2), photo(1)], {
      galleryMeta: { [hero(1)]: { kind: "primary", room: "primary", caption: null }, [photo(1)]: { kind: "exterior", room: "exterior", caption: null } },
    });
    const [kept] = withoutBanners([tideland]);
    expect(kept.galleryImages).toEqual([photo(3), photo(2), photo(1)]);
    expect(Object.keys(kept.galleryMeta ?? {})).toEqual([photo(1)]);
  });

  it("leaves a plan whose only pictures are banners, and one with none, as it is", () => {
    const only = plan("Outrigger", [hero(1)]);
    const clean = plan("Galley", [photo(1), photo(2)]);
    const [a, b] = withoutBanners([only, clean]);
    expect(a).toBe(only);
    expect(b).toBe(clean);
  });
});
