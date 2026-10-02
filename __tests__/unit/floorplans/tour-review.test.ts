import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { namesAHome, nameWords, tourSuspicions, withoutRefusedTours, type ReviewedPlan, type TourFacts } from "@/lib/floorplans/tour-review";
import { TOUR_REVIEW_LABEL } from "@/lib/floorplans/tour-review-label";
import { ownFieldOnto } from "@/lib/floorplans/diff";
import { groupChanges } from "@/lib/floorplans/group-changes";
import type { NormalizedPlan } from "@/lib/floorplans/types";

const MP = (id: string) => `https://my.matterport.com/show/?m=${id}`;
let n = 0;
const plan = (builder: string, name: string, tour: string, over: Partial<ReviewedPlan> = {}): ReviewedPlan => ({
  id: `p${++n}`, site_id: "s", community_id: "c", builder_id: builder, builder, plan_key: name.toLowerCase().replace(/\W+/g, "-"),
  name, wix_record_id: `w${n}`, tour, record: {} as NormalizedPlan, ...over,
});
const titled = (entries: [string, TourFacts][]) => new Map(entries.map(([url, f]) => [url.includes("matterport") ? `matterport:${url.split("m=")[1]}` : url.toLowerCase(), f]));
const flagged = (flags: ReturnType<typeof tourSuspicions>) => Object.fromEntries(flags.map((f) => [f.plan.name, f.reasons.join("; ")]));

describe("the weekly tour review (Jeff, 2026-10-02)", () => {
  it("reads the telling words of a name and a title", () => {
    expect([...nameWords("Duval (Oakfield Trails Signature) - Model Home")]).toEqual(["duval"]);
    expect([...nameWords("Plan 1820")]).toEqual(["1820"]);
    expect(namesAHome("9005 Sunny Shores St copy")).toBe(true);
    expect(namesAHome("Foxtail Loop Lot 286")).toBe(true);
    expect(namesAHome("The Deleon - 24 Islington Lane")).toBe(true);
    expect(namesAHome("Mahogany Grand")).toBe(false);
  });

  it("flags a tour titled for another plan, and leaves the plan it is titled for", () => {
    const cay = MP("9ScbMW3aXoZ");
    const flags = tourSuspicions(
      [plan("towne", "Cay", cay), plan("towne", "Belay", cay), plan("towne", "Genoa", cay)],
      titled([[cay, { status: "ok", title: "Cay Model" }]]),
      ["Cay", "Belay", "Genoa"]
    );
    const out = flagged(flags);
    expect(Object.keys(out).sort()).toEqual(["Belay", "Genoa"]);
    expect(out.Belay).toContain("titled “Cay Model”, the name of another plan (Cay)");
    expect(out.Belay).toContain("the same tour (“Cay Model”) is on Cay, Genoa");
  });

  it("flags another builder's plan by its title, and a tour of one home", () => {
    const daylen = MP("1MoGddFQ6od");
    const florence = MP("PxsY6vATaU9");
    const out = flagged(tourSuspicions(
      [plan("centex", "Daniel", daylen), plan("dfh", "Florence", florence)],
      titled([[daylen, { status: "ok", title: "Pulte Homes - Pioneer Ranch - Daylen" }], [florence, { status: "ok", title: "9005 Sunny Shores St copy" }]]),
      ["Daniel", "Daylen", "Florence"]
    ));
    expect(out.Daniel).toBe("titled “Pulte Homes - Pioneer Ranch - Daylen”, the name of another plan (Daylen)");
    expect(out.Florence).toBe("a tour of one home (“9005 Sunny Shores St copy”), not of this plan's model");
  });

  it("lets plans of the same name share a tour, Zillow's included, and flags plans of different names", () => {
    const z1 = "https://www.zillow.com/view-imx/5bb75b71";
    const z2 = "https://www.zillow.com/view-imx/47b84908";
    const out = flagged(tourSuspicions(
      [
        plan("drh", "Cali", z1, { community_id: "bella" }), plan("drh", "Cali", z1, { community_id: "oakfield" }),
        plan("neal", "Savannah 2", z2), plan("neal", "Sea Mist", z2),
      ],
      new Map(),
      []
    ));
    expect(out.Cali).toBeUndefined();
    expect(out["Savannah 2"]).toBe("the same tour is on Sea Mist");
    expect(out["Sea Mist"]).toBe("the same tour is on Savannah 2");
  });

  it("keeps a shared tour with the plan its title names best", () => {
    const mahogany = MP("2nM4h67kvJx");
    const out = flagged(tourSuspicions(
      [plan("pulte", "Mahogany", mahogany), plan("pulte", "Mahogany Grand", mahogany)],
      titled([[mahogany, { status: "ok", title: "Mahogany Grand" }]]),
      ["Mahogany", "Mahogany Grand"]
    ));
    expect(out).toEqual({ Mahogany: "the same tour (“Mahogany Grand”) is on Mahogany Grand" });
  });

  it("flags a link that is not a tour, and a tour that no longer loads", () => {
    const kb = "https://www.kbhome.com/new-homes-sarasota-bradenton/creekside-at-rutland-ranch/plan-1541";
    const yt = "https://www.youtube.com/watch?v=gone";
    const out = flagged(tourSuspicions(
      [plan("kb", "Plan 1541", kb), plan("neal", "Honor", "https://ifp.thebdxinteractive.com/NealCommunities-Windward-Honor"), plan("kolter", "Bliss", yt)],
      titled([[yt, { status: "broken", detail: "the video is gone" }]]),
      []
    ));
    expect(out["Plan 1541"]).toBe("not a tour: a web page on kbhome.com");
    expect(out.Honor).toBe("an interactive floor plan, not a walkthrough tour");
    expect(out.Bliss).toBe("the tour no longer loads (the video is gone)");
  });

  it("leaves a tour it has no reason to doubt", () => {
    const plant = MP("N1ZYSGXAVVS");
    expect(tourSuspicions([plan("ashton", "Plant (Oakfield Trails Signature)", plant), plan("ashton", "Plant (Oakfield Trails Traditional)", plant)],
      titled([[plant, { status: "ok", title: "Plant" }]]), ["Plant"])).toEqual([]);
  });
});

describe("a tour a person took off stays off", () => {
  const cay = MP("9ScbMW3aXoZ");
  const base = { planKey: "belay", name: "Belay", price: null, priceDisplay: null, beds: "", baths: "", sqft: null, garages: null, homeType: null,
    quickMoveIn: false, comingSoon: false, sourceUrl: null, galleryImages: [], blueprintImages: [] } as NormalizedPlan;

  it("drops it from a run's reading, as gone", () => {
    const refused = new Map([["belay", new Set(["matterport:9ScbMW3aXoZ"])]]);
    const [belay, cayPlan] = withoutRefusedTours([{ ...base, virtualTourUrl: `${cay}&play=1` }, { ...base, planKey: "cay", virtualTourUrl: cay }], refused);
    expect(belay).toMatchObject({ virtualTourUrl: null, virtualTourImage: null, tourStated: true });
    expect(cayPlan.virtualTourUrl).toBe(cay);
  });

  it("takes only the tour off the record as it stands when approved", () => {
    const latest = { ...base, price: 701900, priceDisplay: "$701,900", virtualTourUrl: cay, virtualTourImage: "still.jpg" };
    const queued = { ...base, price: 669900, priceDisplay: "$669,900", virtualTourUrl: null };
    expect(ownFieldOnto(latest, queued, TOUR_REVIEW_LABEL)).toMatchObject({ price: 701900, virtualTourUrl: null, virtualTourImage: null });
  });

  it("is a card of its own in the queue", () => {
    const row = (id: string, field: string | null) => ({ id, site_id: "s", community_id: "c", builder_id: "b", plan_key: "belay",
      change_type: "update" as const, status: "pending", created_at: "2026-10-02", field_changed: field });
    expect(groupChanges([row("1", "price"), row("2", "description"), row("3", TOUR_REVIEW_LABEL)]).map((g) => g.rows.map((r) => r.id))).toEqual([["1", "2"], ["3"]]);
  });
});

describe("the weekly tour review, what it leaves alone", () => {
  it("lets a title spelled one letter off name its plan, and leaves gone tours to the nightly run", () => {
    const south = MP("9KXY5u8pNXM");
    const layton = MP("Bds9yD4GJVL");
    const gone = MP("21MTfZNyNTn");
    const out = flagged(tourSuspicions(
      [
        plan("cardel", "Southampton", south), plan("cardel", "Southampton Rf", south),
        plan("pulte", "Layton", layton), plan("pulte", "Layton Grande", layton), plan("pulte", "Layton Grand", layton),
        plan("lennar", "Princeton", gone), plan("lennar", "Princeton ii", gone),
      ],
      titled([[south, { status: "ok", title: "Southhampton" }], [layton, { status: "ok", title: "Layton Grande Model - Catalia" }], [gone, { status: "gone" }]]),
      ["Southampton", "Southampton Rf", "Layton", "Layton Grande", "Layton Grand", "Princeton", "Princeton ii"]
    ));
    expect(out).toEqual({ Layton: "the same tour (“Layton Grande Model - Catalia”) is on Layton Grande, Layton Grand" });
  });
});
