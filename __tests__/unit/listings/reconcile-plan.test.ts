import { describe, expect, it } from "vitest";
import { isRelevant, massDeleteThreshold, planRemovals } from "@/lib/listings/reconcile";
import { groupByKeys } from "@/lib/listings/db";
import type { ReasonCode } from "@/lib/listings/types";

const pending = (reasons: ReasonCode[]) => reasons.map((reason_code, i) => ({ listing_id: `MFR${i}`, reason_code }));

describe("massDeleteThreshold", () => {
  it("is 10 or a tenth of the live inventory, whichever is larger", () => {
    expect(massDeleteThreshold(0)).toBe(10);
    expect(massDeleteThreshold(95)).toBe(10);
    expect(massDeleteThreshold(150)).toBe(15);
    expect(massDeleteThreshold(331)).toBe(34);
  });
});

describe("planRemovals", () => {
  it("lets a full run remove a handful and holds everything at the threshold", () => {
    const few = pending(Array(9).fill("status_change") as ReasonCode[]);
    expect(planRemovals(few, { mode: "full", liveCount: 100 })).toMatchObject({ apply: few, held: [], threshold: 10 });

    const many = pending(Array(10).fill("status_change") as ReasonCode[]);
    const plan = planRemovals(many, { mode: "full", liveCount: 100 });
    expect(plan.apply).toEqual([]);
    expect(plan.held).toHaveLength(10);
  });

  it("holds only the data-driven removals on an hourly run", () => {
    const mixed = pending([
      ...(Array(12).fill("no_village") as ReasonCode[]),
      "status_change",
      "status_change",
      "city_change",
    ]);
    const plan = planRemovals(mixed, { mode: "incremental", liveCount: 100 });
    expect(plan.held.map((p) => p.reason_code)).toEqual([...Array(12).fill("no_village"), "city_change"]);
    expect(plan.apply.map((p) => p.reason_code)).toEqual(["status_change", "status_change"]);

    const trusted = pending(Array(40).fill("status_change") as ReasonCode[]);
    expect(planRemovals(trusted, { mode: "incremental", liveCount: 100 }).apply).toHaveLength(40);
  });

  it("applies everything when the operator overrides the guard", () => {
    const many = pending(Array(50).fill("not_in_feed") as ReasonCode[]);
    expect(planRemovals(many, { mode: "full", liveCount: 100, allowMassDelete: true }).apply).toHaveLength(50);
  });
});

describe("isRelevant", () => {
  const market = new Set(["longboat key"]);
  const known = new Set(["MFRHELD1"]);

  it("keeps market-city records whatever the case and the PostalCity fallback", () => {
    expect(isRelevant({ ListingId: "MFR1", City: "LONGBOAT KEY" }, market, known)).toBe(true);
    expect(isRelevant({ ListingId: "MFR2", PostalCity: "Longboat Key" }, market, known)).toBe(true);
  });

  it("keeps a held listing wherever it moved to, so the site sees it leave", () => {
    expect(isRelevant({ ListingId: "MFRHELD1", City: "Sarasota" }, market, known)).toBe(true);
    expect(isRelevant({ ListingId: "MFRHELD1" }, market, known)).toBe(true);
  });

  it("drops the rest of the MLS-wide pull", () => {
    expect(isRelevant({ ListingId: "MFR3", City: "Sarasota" }, market, known)).toBe(false);
    expect(isRelevant({ ListingId: "MFR4" }, market, known)).toBe(false);
    expect(isRelevant({ ListingId: "" }, market, known)).toBe(false);
  });
});

describe("groupByKeys", () => {
  it("buckets rows by key set so a partial patch never nulls a column", () => {
    const groups = groupByKeys([
      { site_id: "s", listing_id: "a", needs_write: false },
      { listing_id: "b", site_id: "s", state: "removed", reason_code: "status_change" },
      { needs_write: true, listing_id: "c", site_id: "s" },
    ]);
    expect([...groups.keys()]).toEqual(["listing_id,needs_write,site_id", "listing_id,reason_code,site_id,state"]);
    expect(groups.get("listing_id,needs_write,site_id")?.map((r) => r.listing_id)).toEqual(["a", "c"]);
  });
});
