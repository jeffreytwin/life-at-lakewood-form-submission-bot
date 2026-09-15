// What the Hub's Listings section reads and edits. Validation lives here so
// the routes stay thin, and every edit is one the next run picks up on its
// own: a term change reclassifies on the next pull, a paused site is
// skipped, the engine switch gates the cron tick.

import { supabase } from "@/lib/supabase/client";
import { errorMessage, isUniqueViolation } from "@/lib/shared/errors";
import { loadListings, loadSiteGalleries, selectAll } from "@/lib/listings/db";
import { titleCase } from "@/lib/listings/transform";
import type { LsSite, LsVillage, VillageTerm, WriteMode } from "@/lib/listings/types";

export class HubError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "HubError";
  }
}

const MAX_NAME = 120;
const MAX_TERM = 80;

/** A village term as the classifier compares it: lowercased and trimmed; null when blank. */
export function normalizeTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const term = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!term) return null;
  if (term.length > MAX_TERM) throw new HubError(`A term is at most ${MAX_TERM} characters`);
  return term;
}

export function validateVillageName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new HubError("A neighborhood needs a name");
  if (name.length > MAX_NAME) throw new HubError(`A neighborhood name is at most ${MAX_NAME} characters`);
  return name;
}

/** Optional text fields: trimmed, blank becomes null, anything else must be a string. */
export function optionalText(value: unknown, label: string, max = 500): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new HubError(`${label} must be text`);
  const text = value.trim();
  if (text.length > max) throw new HubError(`${label} is at most ${max} characters`);
  return text || null;
}

export interface SiteCounts {
  staged: number;
  live: number;
  removed: number;
  galleryPending: number;
  needsWrite: number;
  /** Removed rows still on the site: what the next run deletes, or the guard holds. */
  pendingRemovals: number;
}

export const emptySiteCounts = (): SiteCounts => ({ staged: 0, live: 0, removed: 0, galleryPending: 0, needsWrite: 0, pendingRemovals: 0 });

export async function siteCounts(): Promise<Map<string, SiteCounts>> {
  const rows = await selectAll<{ site_id: string; state: string; gallery_ready: boolean; needs_write: boolean; wix_item_id: string | null }>(
    "load site listing states",
    (from, to) => supabase.from("ls_site_listings").select("site_id, state, gallery_ready, needs_write, wix_item_id").order("id").range(from, to)
  );
  const out = new Map<string, SiteCounts>();
  for (const row of rows) {
    const c = out.get(row.site_id) ?? emptySiteCounts();
    if (row.state === "staged") c.staged += 1;
    else if (row.state === "live") c.live += 1;
    else if (row.state === "removed") c.removed += 1;
    if (row.state !== "removed" && !row.gallery_ready) c.galleryPending += 1;
    if (row.needs_write) c.needsWrite += 1;
    if (row.state === "removed" && row.needs_write && row.wix_item_id) c.pendingRemovals += 1;
    out.set(row.site_id, c);
  }
  return out;
}

export interface EventFilters {
  siteId?: string;
  level?: string;
  kind?: string;
  listingId?: string;
  runKey?: string;
  limit?: number;
}

export const EVENT_LEVELS = new Set(["info", "warn", "error"]);

export async function listEvents(filters: EventFilters) {
  // A run buffers at most 1,500 events (runs.ts), so a run-scoped read fits in one page.
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 2000);
  let query = supabase.from("ls_sync_events").select("*").order("at", { ascending: false }).limit(limit);
  if (filters.siteId) query = query.eq("site_id", filters.siteId);
  if (filters.level && EVENT_LEVELS.has(filters.level)) query = query.eq("level", filters.level);
  if (filters.kind) query = query.eq("kind", filters.kind.trim());
  if (filters.listingId) query = query.ilike("listing_id", `%${filters.listingId.trim().replace(/[%_]/g, "")}%`);
  if (filters.runKey) query = query.eq("run_key", filters.runKey.trim());
  const { data, error } = await query;
  if (error) throw new HubError(`load events: ${errorMessage(error)}`, 500);
  return data ?? [];
}

export interface VillageView extends LsVillage {
  terms: Array<VillageTerm & { id: string }>;
  liveListings: number;
  stagedListings: number;
}

export async function listVillages(siteId: string): Promise<VillageView[]> {
  const [villages, terms, listings] = await Promise.all([
    selectAll<LsVillage>("load villages", (from, to) => supabase.from("ls_villages").select("*").eq("site_id", siteId).order("name").range(from, to)),
    selectAll<{ id: string; village_id: string; term: string; street_term: string | null }>("load village terms", (from, to) =>
      supabase.from("ls_village_terms").select("id, village_id, term, street_term").eq("site_id", siteId).order("term").range(from, to)
    ),
    selectAll<{ village_id: string | null; state: string }>("load site listings", (from, to) =>
      supabase.from("ls_site_listings").select("village_id, state").eq("site_id", siteId).in("state", ["staged", "live"]).order("id").range(from, to)
    ),
  ]);
  const byVillage = new Map<string, VillageView>();
  for (const v of villages) byVillage.set(v.id, { ...v, terms: [], liveListings: 0, stagedListings: 0 });
  for (const t of terms) byVillage.get(t.village_id)?.terms.push({ id: t.id, term: t.term, street_term: t.street_term });
  for (const l of listings) {
    const v = l.village_id ? byVillage.get(l.village_id) : undefined;
    if (!v) continue;
    if (l.state === "live") v.liveListings += 1;
    else v.stagedListings += 1;
  }
  return [...byVillage.values()];
}

async function loadVillage(id: string): Promise<LsVillage> {
  const { data, error } = await supabase.from("ls_villages").select("*").eq("id", id).maybeSingle();
  if (error) throw new HubError(`load village: ${errorMessage(error)}`, 500);
  if (!data) throw new HubError("Neighborhood not found", 404);
  return data as LsVillage;
}

export async function createVillage(input: { siteId: unknown; name: unknown; wix_slug?: unknown; page_url?: unknown; wix_item_id?: unknown }): Promise<LsVillage> {
  if (typeof input.siteId !== "string" || !input.siteId) throw new HubError("siteId is required");
  const row = {
    site_id: input.siteId,
    name: validateVillageName(input.name),
    wix_slug: optionalText(input.wix_slug, "Wix slug", 200) ?? null,
    page_url: optionalText(input.page_url, "Page URL") ?? null,
    wix_item_id: optionalText(input.wix_item_id, "Wix item id", 200) ?? null,
  };
  const { data, error } = await supabase.from("ls_villages").insert(row).select("*").single();
  if (error) {
    if (isUniqueViolation(error)) throw new HubError(`"${row.name}" already exists on this site`, 409);
    throw new HubError(`create village: ${errorMessage(error)}`, 500);
  }
  return data as LsVillage;
}

export async function updateVillage(id: string, patch: { name?: unknown; wix_slug?: unknown; page_url?: unknown; wix_item_id?: unknown; active?: unknown }): Promise<LsVillage> {
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = validateVillageName(patch.name);
  const slug = optionalText(patch.wix_slug, "Wix slug", 200);
  if (slug !== undefined) updates.wix_slug = slug;
  const pageUrl = optionalText(patch.page_url, "Page URL");
  if (pageUrl !== undefined) updates.page_url = pageUrl;
  const itemId = optionalText(patch.wix_item_id, "Wix item id", 200);
  if (itemId !== undefined) updates.wix_item_id = itemId;
  if (patch.active !== undefined) {
    if (typeof patch.active !== "boolean") throw new HubError("active must be true or false");
    updates.active = patch.active;
  }
  if (!Object.keys(updates).length) throw new HubError("Nothing to update");
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from("ls_villages").update(updates).eq("id", id).select("*").maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) throw new HubError(`"${String(updates.name)}" already exists on this site`, 409);
    throw new HubError(`update village: ${errorMessage(error)}`, 500);
  }
  if (!data) throw new HubError("Neighborhood not found", 404);
  return data as LsVillage;
}

/** Deletes a village nothing points at; one with listings is deactivated instead. */
export async function deleteVillage(id: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from("ls_site_listings")
    .select("id", { count: "exact", head: true })
    .eq("village_id", id)
    .in("state", ["staged", "live"]);
  if (countError) throw new HubError(`count village listings: ${errorMessage(countError)}`, 500);
  if (count) throw new HubError(`This neighborhood still has ${count} listing(s); deactivate it instead and let the next run move them`, 409);
  const { error } = await supabase.from("ls_villages").delete().eq("id", id);
  if (error) throw new HubError(`delete village: ${errorMessage(error)}`, 500);
}

export async function addTerm(villageId: string, input: { term: unknown; street_term?: unknown }): Promise<{ id: string; term: string; street_term: string | null }> {
  const village = await loadVillage(villageId);
  const term = normalizeTerm(input.term);
  if (!term) throw new HubError("A term needs some text");
  const street_term = normalizeTerm(input.street_term);
  const { data, error } = await supabase
    .from("ls_village_terms")
    .insert({ site_id: village.site_id, village_id: village.id, term, street_term })
    .select("id, term, street_term")
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      const owner = await termOwner(village.site_id, term, street_term);
      throw new HubError(`"${term}"${street_term ? ` with street "${street_term}"` : ""} already belongs to ${owner ?? "another neighborhood"}`, 409);
    }
    throw new HubError(`add term: ${errorMessage(error)}`, 500);
  }
  return data as { id: string; term: string; street_term: string | null };
}

async function termOwner(siteId: string, term: string, streetTerm: string | null): Promise<string | null> {
  let query = supabase.from("ls_village_terms").select("ls_villages:village_id(name)").eq("site_id", siteId).eq("term", term);
  query = streetTerm ? query.eq("street_term", streetTerm) : query.is("street_term", null);
  const { data } = await query.maybeSingle();
  const village = (data as { ls_villages?: { name?: string } | { name?: string }[] | null } | null)?.ls_villages;
  if (Array.isArray(village)) return village[0]?.name ?? null;
  return village?.name ?? null;
}

export async function removeTerm(villageId: string, termId: string): Promise<void> {
  const { data, error } = await supabase.from("ls_village_terms").delete().eq("id", termId).eq("village_id", villageId).select("id");
  if (error) throw new HubError(`remove term: ${errorMessage(error)}`, 500);
  if (!data?.length) throw new HubError("Term not found", 404);
}

export async function setEngineEnabled(enabled: unknown): Promise<{ ls_engine_enabled: boolean; ls_engine_state: unknown }> {
  if (typeof enabled !== "boolean") throw new HubError("enabled must be true or false");
  const { data, error } = await supabase
    .from("system_settings")
    .update({ ls_engine_enabled: enabled })
    .eq("id", 1)
    .select("ls_engine_enabled, ls_engine_state")
    .single();
  if (error) throw new HubError(`engine switch: ${errorMessage(error)}`, 500);
  return data as { ls_engine_enabled: boolean; ls_engine_state: unknown };
}

/**
 * Pause or resume a site from the Hub. Cutover to live (and back) is an
 * ls_sites edit gated to Jeff, so a live site cannot be changed here and a
 * site cannot be made live here.
 */
export async function setSiteWriteMode(id: string, mode: unknown): Promise<LsSite> {
  if (mode !== "paused" && mode !== "shadow") throw new HubError("write_mode must be paused or shadow");
  const { data: site, error: loadError } = await supabase.from("ls_sites").select("*").eq("id", id).maybeSingle();
  if (loadError) throw new HubError(`load site: ${errorMessage(loadError)}`, 500);
  if (!site) throw new HubError("Site not found", 404);
  if ((site as LsSite).write_mode === "live") throw new HubError("A live site is cut over or rolled back by editing ls_sites, not from here", 409);
  const { data, error } = await supabase
    .from("ls_sites")
    .update({ write_mode: mode as WriteMode, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new HubError(`update site: ${errorMessage(error)}`, 500);
  return data as LsSite;
}

export type StagedWaitingOn = "data" | "neighborhood" | "photos" | "write";

export interface StagedListingView {
  listing_id: string;
  address: string | null;
  city: string | null;
  subdivision: string | null;
  list_price: number | null;
  standard_status: string | null;
  neighborhood: string | null;
  /** MLS photos the engine knows for the listing. */
  photos: number;
  /** Of those, the ones already in this site's Media Manager. */
  photos_imported: number;
  staged_at: string;
  waiting_on: StagedWaitingOn;
}

/**
 * A site's staging area: every staged row with what the next run still
 * needs before it writes the listing, checked in the order reconcile
 * checks them: the MLS record, a neighborhood, one imported photo, and
 * then only the write itself.
 */
export async function listStagedListings(siteId: string): Promise<StagedListingView[]> {
  const rows = await selectAll<{ listing_id: string; village_id: string | null; staged_at: string }>("load staged listings", (from, to) =>
    supabase.from("ls_site_listings").select("listing_id, village_id, staged_at").eq("site_id", siteId).eq("state", "staged").order("listing_id").range(from, to)
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.listing_id);
  const [listings, villages, galleries] = await Promise.all([
    loadListings(ids),
    selectAll<{ id: string; name: string }>("load villages", (from, to) => supabase.from("ls_villages").select("id, name").eq("site_id", siteId).order("id").range(from, to)),
    loadSiteGalleries(siteId, ids),
  ]);
  const names = new Map(villages.map((v) => [v.id, v.name]));
  return rows.map((row) => {
    const listing = listings.get(row.listing_id);
    const neighborhood = row.village_id ? (names.get(row.village_id) ?? null) : null;
    const photos = galleries.get(row.listing_id) ?? [];
    const imported = photos.filter((p) => p.src).length;
    const hasRecord = !!listing && typeof listing.raw?.ListingId === "string";
    const waiting_on: StagedWaitingOn = !hasRecord ? "data" : !neighborhood ? "neighborhood" : imported === 0 ? "photos" : "write";
    return {
      listing_id: row.listing_id,
      address: hasRecord ? streetAddress(listing.raw) : null,
      city: listing?.city ?? null,
      subdivision: listing?.subdivision ?? null,
      list_price: listing?.list_price == null ? null : Number(listing.list_price),
      standard_status: listing?.standard_status ?? null,
      neighborhood,
      photos: photos.length,
      photos_imported: imported,
      staged_at: row.staged_at,
      waiting_on,
    };
  });
}

/** "<number> <Name> <Suffix>[ #unit]" from the MLSGrid record, for display. */
function streetAddress(raw: Record<string, unknown>): string | null {
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");
  const street = [text("StreetNumber"), titleCase(raw.StreetName), titleCase(raw.StreetSuffix)].filter(Boolean).join(" ");
  const unit = text("UnitNumber");
  return (unit ? `${street} #${unit}` : street) || text("UnparsedAddress") || null;
}

export interface RunFilters {
  limit?: number;
  /** ISO started_at: only runs that started before it, the cursor for "load older". */
  before?: string;
  runKey?: string;
}

/** Runs newest first, a page at a time; `runKey` fetches one run. */
export async function listRuns(filters: RunFilters): Promise<Record<string, unknown>[]> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  let query = supabase.from("ls_sync_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  if (filters.runKey) query = query.eq("run_key", filters.runKey.trim());
  if (filters.before && !Number.isNaN(Date.parse(filters.before))) query = query.lt("started_at", new Date(filters.before).toISOString());
  const { data, error } = await query;
  if (error) throw new HubError(`load runs: ${errorMessage(error)}`, 500);
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * Error events nobody has dismissed: the overview's Errors panel and the
 * sidebar badge. A limit of 0 asks for the count alone.
 */
export async function listOpenErrors(limit = 50): Promise<{ count: number; errors: Record<string, unknown>[] }> {
  const rows = Math.min(Math.max(limit, 0), 200);
  const base = supabase.from("ls_sync_events");
  const query = (rows === 0 ? base.select("id", { count: "exact", head: true }) : base.select("*", { count: "exact" }))
    .eq("level", "error")
    .is("dismissed_at", null)
    .order("at", { ascending: false });
  const { data, error, count } = await (rows === 0 ? query : query.limit(rows));
  if (error) throw new HubError(`load open errors: ${errorMessage(error)}`, 500);
  const errors = (data ?? []) as Record<string, unknown>[];
  return { count: count ?? errors.length, errors };
}

/** Marks the given open errors dismissed, or every open error with `all: true`. */
export async function dismissErrors(input: { ids?: unknown; all?: unknown }): Promise<{ dismissed: number }> {
  const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  if (input.all !== true && !ids.length) throw new HubError("ids (or all: true) is required");
  if (ids.length > 500) throw new HubError("At most 500 ids per call");
  let query = supabase.from("ls_sync_events").update({ dismissed_at: new Date().toISOString() }).eq("level", "error").is("dismissed_at", null);
  if (input.all !== true) query = query.in("id", ids);
  const { data, error } = await query.select("id");
  if (error) throw new HubError(`dismiss errors: ${errorMessage(error)}`, 500);
  return { dismissed: (data ?? []).length };
}
