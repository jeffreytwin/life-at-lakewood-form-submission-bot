// Zonda's floor plan viewer (apps.zondavirtual.com/alphaplan), which Homes
// by Towne embeds on each plan's page. The viewer's heading gives the
// plan's counts as ranges — "Plan Tideland · 3-4 Bedrooms - 3.5-4
// Bathrooms" — where the page itself says "3 Bed + Den + Bonus Room", and
// the site shows the top of each range (Jeff, 2026-09-26). The viewer
// reads them from a public file of the plan's data,
// apps.zondavirtual.com/alphaplanjson/<plan>.json.

import { logger } from "@/lib/shared/logger";
import { normKey } from "@/lib/floorplans/types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const VIEWER = /apps\.zondavirtual\.com\/alphaplan\/index\.html\?plan=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/** The viewers a page embeds, in the page's order, once each. Pure; exported for tests. */
export function zondaPlansIn(html: string): string[] {
  return [...new Set([...html.matchAll(VIEWER)].map((m) => m[1].toLowerCase()))];
}

export interface ZondaCounts {
  name: string | null;
  beds: string | null;
  baths: string | null;
}

const field = (text: string, key: string): string | null => text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))?.[1]?.trim() || null;

/** The plan's name and counts as a viewer's data gives them ("3-4", "3.5-4"). Pure; exported for tests. */
export function zondaCountsIn(json: string): ZondaCounts {
  return { name: field(json, "CombinedName"), beds: field(json, "Bedrooms"), baths: field(json, "Bathrooms") };
}

/**
 * The counts of the viewer that shows this plan, where the page embeds
 * one: a Towne page carries other plans' data too, so a viewer is taken
 * only when it names the plan. Null when none does or none can be read.
 */
export async function zondaCountsFor(html: string, planName: string): Promise<ZondaCounts | null> {
  const want = normKey(planName);
  for (const plan of zondaPlansIn(html).slice(0, 3)) {
    try {
      const res = await fetch(`https://apps.zondavirtual.com/alphaplanjson/${plan}.json`, {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const counts = zondaCountsIn(await res.text());
      const named = normKey(counts.name ?? "");
      if (named && want && (named === want || named.includes(want) || want.includes(named))) return counts;
    } catch (error) {
      logger.warn("Zonda plan viewer could not be read", { plan, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return null;
}
