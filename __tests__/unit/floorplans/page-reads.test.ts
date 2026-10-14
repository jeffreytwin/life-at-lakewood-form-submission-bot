import { describe, it, expect } from "vitest";
import { readsAfresh, withRunContext } from "@/lib/floorplans/run-context";
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

describe("what comes and goes on an M/I page without the plan changing (Jeff, 2026-10-13)", () => {
  // As kept from M/I's Jackson plan at Creeks Edge, read by day and again by night.
  const weekend = (name: string, date: string) =>
    `Show Upcoming Events [IMG https://dam.mihomes.com/media/5216647/50421.jpeg] ${name} ${date}, 10:00 AM - 6:00 PM Time is running out to move by the end of the year! RSVP for this event » See more events »`;
  const jackson = (hours: string, events = weekend("Final Whistle Weekend", "Oct 10, 2026"), price = "$489,990") =>
    `Interactive Map ${hours} Creeks Edge At Twin Rivers Show Hours 3776 142nd Terrace East Parrish, FL 34219 Mon: 12:00PM - 6:00PM ${events} The Jackson accommodates a variety of lifestyles. Priced from ${price}`;

  it("reads the sales office open now and closed now as the same page", () => {
    expect(digestOf("plan", jackson("open now"))).toBe(digestOf("plan", jackson("closed now")));
    expect(digestOf("plan", jackson("Open Now"))).toBe(digestOf("plan", jackson("Closed Now")));
  });

  it("reads past this weekend's events, and next weekend's", () => {
    expect(digestOf("plan", jackson("open now"))).toBe(digestOf("plan", jackson("open now", weekend("Open House Weekend", "Oct 17, 2026"))));
    expect(digestOf("list", jackson("open now"))).toBe(digestOf("list", jackson("closed now", weekend("Open House Weekend", "Oct 17, 2026"))));
  });

  it("still reads a new price on the same page as a change", () => {
    expect(digestOf("plan", jackson("open now"))).not.toBe(digestOf("plan", jackson("closed now", undefined, "$479,990")));
  });

  it("leaves every other page, and other closings, exactly as they read", () => {
    expect(normalizedText("plan", "The sales center is closed on Sundays. Closed-in lanai.")).toBe("The sales center is closed on Sundays. Closed-in lanai.");
    expect(normalizedText("plan", "Upcoming Events: none this month. The Lori, priced $459,990.")).toBe("Upcoming Events: none this month. The Lori, priced $459,990.");
    expect(normalizedText("plan", page("$459,990"))).toBe("The Lori [IMG https://b.com/lori/kitchen.jpg] Priced $459,990 3 beds");
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

describe("a second reading reads the held plans' pages afresh (run-context.ts, readsAfresh)", () => {
  it("sets aside what was remembered of a held plan's page and of every list, and nothing else", async () => {
    expect(readsAfresh("https://b.com/lori/", "plan")).toBe(false);
    expect(readsAfresh("https://b.com/", "list")).toBe(false);
    await withRunContext({ source: "nightly", secondReading: { freshPages: new Set(["https://b.com/lori/"]), freshPlans: new Set(["the-lori"]) } }, async () => {
      expect(readsAfresh("https://b.com/lori/", "plan")).toBe(true);
      expect(readsAfresh("https://b.com/", "list")).toBe(true);
      expect(readsAfresh("https://b.com/zander/", "plan")).toBe(false);
      // A record keeps an older address than the page is read at: the plan's key still says.
      expect(readsAfresh("https://b.com/plans/the-lori/", "plan", "the-lori")).toBe(true);
      expect(readsAfresh("https://b.com/zander/", "plan", "the-zander")).toBe(false);
    });
  });
});
