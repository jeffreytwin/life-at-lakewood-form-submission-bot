import { describe, it, expect } from "vitest";
import { digestOf, normalizedText, reusable, variantOf, REREAD_AFTER_DAYS } from "@/lib/floorplans/page-reads";

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
  it("changes with the prompt, the tool or the model, and not with the plan's name", () => {
    const base = { model: "claude-sonnet-5", tool: { name: "report_plan_page" }, ask: "Report what the page says." };
    expect(variantOf("plan", base)).toBe(variantOf("plan", { ...base }));
    expect(variantOf("plan", base)).not.toBe(variantOf("plan", { ...base, ask: "Report what the page says, briefly." }));
    expect(variantOf("plan", base)).not.toBe(variantOf("plan", { ...base, model: "claude-haiku-4-5" }));
    expect(variantOf("plan", base)).not.toBe(variantOf("plan", { ...base, tool: { name: "report_plan_page", strict: true } }));
    expect(variantOf("plan", base)).not.toBe(variantOf("list", base));
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
