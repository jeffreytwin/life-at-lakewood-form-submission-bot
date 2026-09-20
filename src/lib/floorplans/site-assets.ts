// Pictures each site keeps for every plan row, as the freelancers filed
// them (read from the legacy FloorPlans collections, 2026-09-20: one value
// per site across 147 Lakewood, 63 Wellen Park and 250 Parrish rows).
// No IO here.

/**
 * The button picture behind a plan's virtual tour link, per site (Jeff,
 * 2026-09-20): a row with a link carries its site's button in
 * virtualTourImageV2, never the builder's still.
 */
export const VIRTUAL_TOUR_BUTTONS: Readonly<Record<string, string>> = {
  "lifeatlakewood.com":
    "wix:image://v1/d0be81_d1e78d3ae03d4ccea69c0b71447771f3~mv2.png/Virtual%20Tour%20Button%20V3.png#originWidth=2718&originHeight=854",
  "lifeinwellenpark.com":
    "wix:image://v1/d0be81_c058298041a44e13a3424f3ac0fe2a85~mv2.png/Virtual%20Tour%20Button%20V3%20copy.png#originWidth=2718&originHeight=854",
  "lifeatparrish.com":
    "wix:image://v1/d0be81_f37e576d0a224925bac66562ec8cd2bc~mv2.png/Virtual%20Tour%20Button%20-%20Parrish.png#originWidth=2718&originHeight=854",
};

/** The site's virtual tour button, by domain (with or without www.), or null for a site without one. */
export function virtualTourButtonFor(domain: string | null | undefined): string | null {
  const key = (domain ?? "").trim().toLowerCase().replace(/^www\./, "");
  return key ? (VIRTUAL_TOUR_BUTTONS[key] ?? null) : null;
}
