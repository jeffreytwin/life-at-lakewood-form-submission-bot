import { describe, it, expect } from "vitest";
import { changeBetween, digestOf, normalizedText, readVersion, reusable, variantOf, BUILDER_READ_VERSIONS, READ_VERSION, REREAD_AFTER_DAYS } from "@/lib/floorplans/page-reads";

const page = (price: string, extra = "") =>
  `The Lori [IMG https://b.com/lori/kitchen.jpg?v=12&w=1000] Priced ${price} 3 beds [LINK https://b.com/lori/?utm=night] ${extra}`;

describe("digestOf", () => {
  it("is the same for the same page read on another night with other cache-busters and tracking codes", () => {
    const tonight = page("$459,990").replace("?v=12&w=1000", "?v=13&w=1000").replace("?utm=night", "?utm=day");
    expect(digestOf("plan", page("$459,990"))).toBe(digestOf("plan", tonight));
    expect(digestOf("list", page("$459,990"))).toBe(digestOf("list", tonight));
  });

  it("changes when a price or a picture changes", () => {
    expect(digestOf("plan", page("$459,990"))).not.toBe(digestOf("plan", page("$469,990")));
    expect(digestOf("plan", page("$459,990"))).not.toBe(digestOf("plan", page("$459,990").replace("kitchen.jpg", "kitchen-2.jpg")));
  });

  it("ignores links on a plan's own page, and keeps them on a list, whose links are its plans' pages", () => {
    const moved = page("$459,990").replace("[LINK https://b.com/lori/?utm=night]", "[LINK https://b.com/plans/lori/]");
    expect(digestOf("plan", page("$459,990"))).toBe(digestOf("plan", moved));
    expect(digestOf("list", page("$459,990"))).not.toBe(digestOf("list", moved));
  });

  it("reads whitespace as one space", () => {
    expect(normalizedText("plan", "a   b\n\nc")).toBe("a b c");
    expect(digestOf("plan", "a   b\n\nc")).toBe(digestOf("plan", "a b c"));
  });
});

describe("variantOf", () => {
  it("changes with the model, the way the page is asked and the version, and not with the plan's name", () => {
    const base = { model: "claude-sonnet-5", version: "1.0", home: false, photos: true };
    expect(variantOf("plan", base)).toBe(variantOf("plan", { ...base }));
    expect(variantOf("plan", base)).not.toBe(variantOf("plan", { ...base, model: "claude-haiku-4-5" }));
    expect(variantOf("plan", base)).not.toBe(variantOf("plan", { ...base, version: "1.1" }));
    expect(variantOf("plan", base)).not.toBe(variantOf("plan", { ...base, home: true }));
    expect(variantOf("plan", base)).not.toBe(variantOf("plan", { ...base, photos: false }));
    expect(variantOf("plan", base)).not.toBe(variantOf("list", base));
  });
});

describe("readVersion (2026-10-07: a fix for one builder reads only that builder's pages again)", () => {
  it("is the read version and the builder's own, 0 for a builder not named", () => {
    expect(readVersion("Nobody Homes")).toBe(`${READ_VERSION}.0`);
    expect(readVersion(null)).toBe(`${READ_VERSION}.0`);
    expect(readVersion(undefined)).toBe(`${READ_VERSION}.0`);
  });

  it("moves for the builder whose version is raised, and for no other", () => {
    const before = { weekley: readVersion("David Weekley Homes"), pulte: readVersion("Pulte Homes") };
    const was = BUILDER_READ_VERSIONS["David Weekley Homes"];
    BUILDER_READ_VERSIONS["David Weekley Homes"] = (was ?? 0) + 1;
    try {
      expect(readVersion("David Weekley Homes")).not.toBe(before.weekley);
      expect(readVersion("Pulte Homes")).toBe(before.pulte);
    } finally {
      if (was === undefined) delete BUILDER_READ_VERSIONS["David Weekley Homes"];
      else BUILDER_READ_VERSIONS["David Weekley Homes"] = was;
    }
  });
});

describe("reusable", () => {
  const now = Date.parse("2026-09-29T06:00:00Z");
  const row = { digest: "d1", variant: "v1", read_at: "2026-09-28T06:00:00Z" };

  it("answers for a page read the same way, with the same text, a day ago", () => {
    expect(reusable(row, "d1", "v1", now)).toBe(true);
  });

  it("does not answer for other text, another way of reading, no row, or a read older than the valve", () => {
    expect(reusable(row, "d2", "v1", now)).toBe(false);
    expect(reusable(row, "d1", "v2", now)).toBe(false);
    expect(reusable(null, "d1", "v1", now)).toBe(false);
    const old = { ...row, read_at: new Date(now - (REREAD_AFTER_DAYS + 1) * 86_400_000).toISOString() };
    expect(reusable(old, "d1", "v1", now)).toBe(false);
  });
});

describe("changeBetween: what changed on a page read again (2026-09-30)", () => {
  const before = `The Lori [IMG https://b.com/lori/kitchen.jpg] Priced $459,990 3 beds 2 baths 2,400 sq ft ${"Words about the home. ".repeat(20)}`;

  it("finds the stretch that changed, with some words either side, and where it starts", () => {
    const after = before.replace("$459,990", "$469,990");
    const change = changeBetween(before, after)!;
    expect(change).not.toBeNull();
    expect(change.at).toBe(before.indexOf("$459,990") + 2);
    expect(change.before).toContain("$459,990");
    expect(change.after).toContain("$469,990");
    expect(change.before).toContain("Priced");
    expect(change.before.length).toBeLessThan(200);
    expect(change.was).toBe(before.length);
    expect(change.now).toBe(after.length);
  });

  it("is null for the same text, and shows what a page gained when words were only added", () => {
    expect(changeBetween(before, before)).toBeNull();
    const change = changeBetween(before, `${before} Ready now`)!;
    expect(change.after).toContain("Ready now");
    expect(change.after.endsWith("Ready now")).toBe(true);
  });

  it("keeps a long changed stretch to a readable size", () => {
    const change = changeBetween(before, `The Lori ${"new words ".repeat(200)}`)!;
    expect(change.after.length).toBeLessThan(420);
    expect(change.after).toContain(" … ");
  });
});
