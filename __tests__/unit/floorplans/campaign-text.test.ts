import { describe, it, expect } from "vitest";
import { campaignAlertText, describePlan, fieldChangeDetail, homeChangeDetail } from "@/lib/floorplans/campaign-text";

const lori = { name: "Lori", domain: "lifeatlakewood.com", community: "The Isles", builder: "Toll Brothers" };

describe("campaign alert words", () => {
  it("names the plan with where it is", () => {
    expect(describePlan(lori)).toBe("Lori (The Isles, Toll Brothers) on lifeatlakewood.com");
    expect(describePlan({ name: "Lori" })).toBe("Lori");
  });

  it("says what changed, for a field and for a quick move-in", () => {
    expect(fieldChangeDetail("Lori", "price", "$1,000,000", "$1,050,000")).toBe("Lori: price $1,000,000 → $1,050,000");
    expect(fieldChangeDetail("Lori", null, null, null)).toBe("Lori: updated — → —");
    expect(homeChangeDetail("17645 Palmiste Dr", "Lori", "now offered at $1,293,000")).toBe(
      "Quick move-in 17645 Palmiste Dr under Lori: now offered at $1,293,000"
    );
    expect(homeChangeDetail("17645 Palmiste Dr", null, "no longer offered")).toBe("Quick move-in 17645 Palmiste Dr: no longer offered");
  });

  it("writes the text the frontlines agent gets, with the Hub's address when known", () => {
    const text = campaignAlertText(lori, "Lori: price $1,000,000 → $1,050,000", "https://hub.example.com/");
    expect(text).toBe(
      "Email campaign alert: Lori (The Isles, Toll Brothers) on lifeatlakewood.com changed.\n\n" +
        "Lori: price $1,000,000 → $1,050,000\n\n" +
        "Update the campaign to match. See https://hub.example.com/dashboard/floor-plans/campaign."
    );
    expect(campaignAlertText(lori, "x", null)).toContain("See the Hub, Floor Plans → Email campaign.");
  });
});
