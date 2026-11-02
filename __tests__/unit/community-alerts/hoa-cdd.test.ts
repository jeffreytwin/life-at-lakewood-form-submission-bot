import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import { checkName, cleanUrl, feesDueIn, mergePages, nextChecks, pagesFor } from "@/lib/community-alerts/hoa-cdd";
import { checklistFor, feeItemKey } from "@/lib/community-alerts/checklists";
import { viewOf } from "@/lib/community-alerts/alerts";

const row = (id: string, hoa: boolean, cdd: boolean, url = `https://www.lifeatlakewood.com/post/${id}`) => ({
  id,
  site_id: "s1",
  label: `Page ${id}`,
  url,
  hoa,
  cdd,
  created_at: "2026-11-02T12:00:00Z",
});

describe("the HOA/CDD schedule", () => {
  it("checks CDD fees in October and HOA dues in January, and nothing in other months", () => {
    expect(feesDueIn(10)).toEqual(["cdd"]);
    expect(feesDueIn(1)).toEqual(["hoa"]);
    for (const month of [2, 3, 4, 5, 6, 7, 8, 9, 11, 12]) expect(feesDueIn(month)).toEqual([]);
  });

  it("names the next check of each, soonest first", () => {
    expect(nextChecks(new Date("2026-11-02T12:00:00Z"))).toEqual([
      { fee: "hoa", date: "2027-01-15" },
      { fee: "cdd", date: "2027-10-15" },
    ]);
    expect(nextChecks(new Date("2026-10-15T12:00:00Z"))[0]).toEqual({ fee: "cdd", date: "2026-10-15" });
  });

  it("names the alert by what it checks and when", () => {
    expect(checkName(["cdd"], new Date("2026-10-15T13:47:00Z"))).toBe("CDD fee check, October 2026");
    expect(checkName(["cdd", "hoa"], new Date("2027-01-15T13:47:00Z"))).toBe("HOA & CDD fee check, January 2027");
  });
});

describe("the pages a check asks about", () => {
  it("takes only the pages stating the fees checked, each with those fees", () => {
    const pages = [row("a", true, true), row("b", true, false), row("c", false, true)];
    expect(pagesFor(pages, ["cdd"]).map((p) => [p.id, p.fees])).toEqual([
      ["a", ["cdd"]],
      ["c", ["cdd"]],
    ]);
    expect(pagesFor(pages, ["hoa", "cdd"]).map((p) => p.fees)).toEqual([["hoa", "cdd"], ["hoa"], ["cdd"]]);
  });

  it("adds a later check's pages and fees to an open alert without repeating any", () => {
    const october = pagesFor([row("a", true, true), row("c", false, true)], ["cdd"]);
    const january = pagesFor([row("a", true, true), row("b", true, false)], ["hoa"]);
    expect(mergePages(october, january).map((p) => [p.id, p.fees])).toEqual([
      ["a", ["hoa", "cdd"]],
      ["c", ["cdd"]],
      ["b", ["hoa"]],
    ]);
    expect(october[0].fees).toEqual(["cdd"]);
  });

  it("keeps a full http(s) address and refuses anything else", () => {
    expect(cleanUrl("  https://www.lifeinwellenpark.com/post/hoa-cdd-fees ")).toBe("https://www.lifeinwellenpark.com/post/hoa-cdd-fees");
    expect(cleanUrl("lifeatlakewood.com/greenbrook")).toBeNull();
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("the HOA/CDD to-do list", () => {
  const feePages = pagesFor([row("a", true, true), row("v", false, true, "https://www.lifeatlakewood.com/greenbrook-village")], ["hoa", "cdd"]);

  it("is one item per page and fee, linked to the page, answered Updated or No change", () => {
    const items = checklistFor("hoa_cdd", { legacySite: true, feePages });
    expect(items.map((i) => i.key)).toEqual([feeItemKey("a", "hoa"), feeItemKey("a", "cdd"), feeItemKey("v", "cdd")]);
    expect(items[0].label).toBe("Page a: HOA dues");
    expect(items[0].url).toBe("https://www.lifeatlakewood.com/post/a");
    expect(items[0].choices?.map((c) => c.value)).toEqual(["updated", "no_change"]);
    expect(items[0].hint).toMatch(/Blog editor/);
    expect(items[2].hint).not.toMatch(/Blog editor/);
  });

  it("comes from the pages the alert was raised with", () => {
    const view = viewOf({
      id: "a1",
      kind: "hoa_cdd",
      status: "open",
      name: "HOA & CDD fee check, November 2026",
      detail: { site: "lifeatlakewood.com", fees: ["hoa", "cdd"], trigger: "hub", pages: feePages },
      dismissed_reason: null,
      resolved_at: null,
      created_at: "2026-11-02T12:00:00Z",
      ca_alert_items: [
        { item_key: feeItemKey("a", "hoa"), done_at: "2026-11-02T13:00:00Z", by_hand: true, not_applicable: false, choice: "no_change", note: "$150/mo" },
      ],
    });
    expect(view.items).toHaveLength(3);
    expect(view.items[0].state?.choice).toBe("no_change");
    expect(view.progress).toEqual({ settled: 1, total: 3, complete: false });
  });
});
