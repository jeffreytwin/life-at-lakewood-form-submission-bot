import { describe, expect, it } from "vitest";
import { askableBatches } from "@/lib/floorplans/media";

describe("askableBatches", () => {
  // Perry's pictures, which are what found this: fifty of them in one
  // filter is an address longer than a gateway will take, and its answer
  // is "Bad Request" and nothing else (Jeff, 2026-09-22).
  const perry = (n: number) =>
    `https://res.cloudinary.com/perryhomes/image/upload/v1/3413CountryViewCourt-${String(n).padStart(2, "0")}.jpg`;

  const longest = (batch: string[]) =>
    batch.reduce((n, url) => n + encodeURIComponent(url).length + 3, 0);

  it("keeps every batch inside the budget", () => {
    const batches = askableBatches(Array.from({ length: 200 }, (_, i) => perry(i)));
    expect(batches.length).toBeGreaterThan(4);
    for (const batch of batches) expect(longest(batch)).toBeLessThanOrEqual(2_000);
  });

  it("loses nothing and keeps the order", () => {
    const urls = Array.from({ length: 57 }, (_, i) => perry(i));
    expect(askableBatches(urls).flat()).toEqual(urls);
  });

  it("takes one url however long it is, rather than dropping it", () => {
    const enormous = `https://x.test/${"a".repeat(5_000)}.jpg`;
    expect(askableBatches([enormous, perry(1)])).toEqual([[enormous], [perry(1)]]);
  });

  it("still counts them, for the short urls a budget would never stop", () => {
    const tiny = Array.from({ length: 120 }, (_, i) => `https://x.test/${i}.jpg`);
    const batches = askableBatches(tiny);
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(50);
    expect(batches.flat()).toEqual(tiny);
  });

  it("has nothing to ask about when there is nothing", () => {
    expect(askableBatches([])).toEqual([]);
  });
});
