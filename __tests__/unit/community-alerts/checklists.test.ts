import { describe, it, expect } from "vitest";
import { checklistFor, isSettled, progressOf } from "@/lib/community-alerts/checklists";
import { viewOf } from "@/lib/community-alerts/alerts";

const state = (item_key: string, extra: Partial<{ done_at: string | null; not_applicable: boolean; by_hand: boolean; choice: string | null }> = {}) => ({
  item_key,
  done_at: null,
  by_hand: true,
  not_applicable: false,
  choice: null,
  note: null,
  ...extra,
});

describe("the sold-out to-do list", () => {
  const items = checklistFor("sold_out", { legacySite: false });

  it("covers the website work a sell-out calls for, each item once", () => {
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of ["landing_language", "landing_images", "new_build_section", "listings_section", "ad_language", "ad_images"]) {
      expect(keys).toContain(key);
    }
  });

  it("says so on Life At Lakewood, whose pages are sometimes built one by one", () => {
    const legacy = checklistFor("sold_out", { legacySite: true });
    expect(legacy.find((i) => i.key === "landing_language")?.hint).toMatch(/Life At Lakewood/);
    expect(items.find((i) => i.key === "landing_language")?.hint).toBeUndefined();
  });
});

describe("progressOf", () => {
  const items = checklistFor("sold_out", { legacySite: false });

  it("counts an item done or marked N/A as settled, and nothing else", () => {
    expect(isSettled(undefined)).toBe(false);
    expect(isSettled(state("confirm"))).toBe(false);
    expect(isSettled(state("confirm", { done_at: "2026-10-17T12:00:00Z" }))).toBe(true);
    expect(isSettled(state("confirm", { not_applicable: true }))).toBe(true);
  });

  it("is complete only when every item is settled", () => {
    const all = items.map((i) => state(i.key, { done_at: "2026-10-17T12:00:00Z" }));
    expect(progressOf(items, all).complete).toBe(true);
    expect(progressOf(items, all.slice(1)).complete).toBe(false);
    expect(progressOf(items, [...all.slice(1), state(items[0].key, { not_applicable: true })]).complete).toBe(true);
  });

  it("ignores a stored item the list no longer has", () => {
    const all = [...items.map((i) => state(i.key, { done_at: "2026-10-17T12:00:00Z" })), state("retired_item")];
    expect(progressOf(items, all)).toEqual({ settled: items.length, total: items.length, complete: true });
  });
});

describe("viewOf", () => {
  it("lists the items in the list's order beside what was done about them", () => {
    const view = viewOf({
      id: "a1",
      kind: "sold_out",
      status: "open",
      name: "Star Farms",
      detail: { site: "lifeatlakewood.com" },
      dismissed_reason: null,
      resolved_at: null,
      created_at: "2026-10-17T12:00:00Z",
      ca_alert_items: [state("ad_images", { done_at: "2026-10-17T13:00:00Z" })],
    });
    expect(view.items[0].key).toBe("confirm");
    expect(view.items.find((i) => i.key === "ad_images")?.state?.done_at).toBe("2026-10-17T13:00:00Z");
    expect(view.items.find((i) => i.key === "confirm")?.state).toBeNull();
    expect(view.progress.settled).toBe(1);
    // Life At Lakewood's hint reaches the view.
    expect(view.items.find((i) => i.key === "landing_images")?.hint).toMatch(/Life At Lakewood/);
  });
});
