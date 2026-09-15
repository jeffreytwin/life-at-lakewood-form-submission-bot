// Village terms. Today each site's Wix `Villages` collection maps a
// subdivision pattern to a village page; the engine keeps that mapping in
// ls_villages + ls_village_terms (edited in the Hub from phase 2 on) and
// imports it from Wix to start with. The import is idempotent: villages are
// matched by name and each village's term set is replaced.

import { queryAllItems } from "@/lib/wix/client";
import { supabase } from "@/lib/supabase/client";
import { errorMessage, isUniqueViolation } from "@/lib/shared/errors";
import type { LsSite } from "@/lib/listings/types";

export interface VillageImportResult {
  villages: number;
  terms: number;
  /** Terms another village on the site already owns; kept where they were. */
  conflicts: Array<{ village: string; term: string; street_term: string | null }>;
  skippedRows: number;
}

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return t.length ? t : null;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function slugOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? null;
  } catch {
    return null;
  }
}

interface WixVillageRow {
  matchPattern?: unknown;
  streetPattern?: unknown;
  villageName?: unknown;
  villageURL?: unknown;
  village1?: unknown;
  villageSortHelp?: unknown;
  blueTag1?: unknown;
  purpleTag1?: unknown;
  greenTag1?: unknown;
  order?: unknown;
}

export async function importVillagesFromWix(site: LsSite, collectionId = "Villages"): Promise<VillageImportResult> {
  if (!site.wix_site_id) throw new Error(`site ${site.domain} has no wix_site_id`);
  const items = await queryAllItems(site.wix_site_id, collectionId);

  // Group the Wix rows by village name: one village, many terms.
  const grouped = new Map<string, WixVillageRow[]>();
  let skippedRows = 0;
  for (const item of items) {
    const row = item.data as WixVillageRow;
    const name = text(row.villageName);
    const term = clean(row.matchPattern);
    if (!name || !term) {
      skippedRows += 1;
      continue;
    }
    grouped.set(name, [...(grouped.get(name) ?? []), row]);
  }

  const result: VillageImportResult = { villages: 0, terms: 0, conflicts: [], skippedRows };
  for (const [name, rows] of grouped) {
    const first = rows.find((r) => text(r.villageURL)) ?? rows[0];
    const pageUrl = text(first.villageURL);
    const display: Record<string, unknown> = {};
    for (const key of ["villageSortHelp", "blueTag1", "purpleTag1", "greenTag1"] as const) {
      const value = text(first[key]);
      if (value) display[key] = value;
    }
    const order = rows.map((r) => (typeof r.order === "number" ? r.order : null)).find((o) => o !== null);
    if (order !== undefined && order !== null) display.order = order;

    const { data: village, error } = await supabase
      .from("ls_villages")
      .upsert(
        {
          site_id: site.id,
          name,
          wix_slug: slugOf(pageUrl),
          wix_item_id: text(rows.map((r) => r.village1).find((v) => text(v))),
          page_url: pageUrl,
          display,
        },
        { onConflict: "site_id,name" }
      )
      .select("id")
      .single();
    if (error || !village) throw new Error(`upsert village ${name}: ${errorMessage(error)}`);
    result.villages += 1;

    // Replace the term set. Insert one at a time so a term another village
    // already owns is reported instead of aborting the whole import.
    const { error: delError } = await supabase.from("ls_village_terms").delete().eq("village_id", village.id);
    if (delError) throw new Error(`clear terms for ${name}: ${errorMessage(delError)}`);
    const seen = new Set<string>();
    for (const row of rows) {
      const term = clean(row.matchPattern);
      if (!term) continue;
      const street_term = clean(row.streetPattern);
      const key = `${term}::${street_term ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { error: insError } = await supabase
        .from("ls_village_terms")
        .insert({ site_id: site.id, village_id: village.id, term, street_term });
      if (insError) {
        if (isUniqueViolation(insError)) {
          result.conflicts.push({ village: name, term, street_term });
          continue;
        }
        throw new Error(`insert term "${term}" for ${name}: ${errorMessage(insError)}`);
      }
      result.terms += 1;
    }
  }
  return result;
}
