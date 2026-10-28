// Where each village is, as homes in it (Jeff, 2026-10-28: "using
// addresses at each village"). A village's homes are the MLS listings the
// listings engine has filed under it, sold and off-market ones included;
// a village the engine does not have is looked for by the MLS
// subdivision name; one neither finds can be given an address by hand on
// the School Zones tab. A listing filed under the wrong village (one
// miles off) is dropped by distance from the rest.

import { supabase } from "@/lib/supabase/client";
import { failedAt as failed } from "@/lib/shared/describe-error";
import { villageKey } from "@/lib/villages/ranges";
import type { Outcome } from "@/lib/community-alerts/alerts";
import { chunk, selectAll } from "@/lib/listings/db";

export interface Point {
  lat: number;
  lng: number;
  address: string | null;
}

export type PlacedBy = "listings" | "subdivision" | "address";

/** Homes farther than this from the village's middle are taken for mistakes. */
const MAX_KM = 3;
/** Homes asked about per village: enough to see a village split between two zones. */
export const MAX_POINTS = 10;

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * A village's homes fit to ask about: each place once, none far from the
 * rest, at most `max` spread across the village. Pure; exported for tests.
 */
export function cleanPoints(points: Point[], max = MAX_POINTS): Point[] {
  const seen = new Map<string, Point>();
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  const unique = [...seen.values()];
  if (unique.length === 0) return [];
  const middle = { lat: median(unique.map((p) => p.lat)), lng: median(unique.map((p) => p.lng)) };
  const near = unique.filter((p) => km(p, middle) <= MAX_KM).sort((a, b) => a.lat - b.lat || a.lng - b.lng);
  if (near.length <= max) return near;
  return Array.from({ length: max }, (_, i) => near[Math.floor((i * near.length) / max)]);
}

interface ListingPoint {
  listing_id: string;
  latitude: number | string | null;
  longitude: number | string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
}

const LISTING_COLUMNS = "listing_id, latitude, longitude, address:raw->>UnparsedAddress, city, postal_code";

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

function toPoint(l: ListingPoint): Point | null {
  const lat = Number(l.latitude);
  const lng = Number(l.longitude);
  if (!l.latitude || !l.longitude || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const street = l.address ? titleCase(l.address.replace(/\s+/g, " ").trim()) : null;
  const address = street ? [street, l.city ? titleCase(l.city) : null, `FL ${l.postal_code ?? ""}`.trim()].filter(Boolean).join(", ") : null;
  return { lat, lng, address };
}

/** Each village's homes on a listings site, by village id. */
export async function villagePoints(lsSiteId: string): Promise<Map<string, Point[]>> {
  const filed = await selectAll<{ listing_id: string; village_id: string }>("reading the villages' listings", (from, to) =>
    supabase
      .from("ls_site_listings")
      .select("listing_id, village_id")
      .eq("site_id", lsSiteId)
      .not("village_id", "is", null)
      .order("id")
      .range(from, to)
  );
  const villageOf = new Map(filed.map((f) => [f.listing_id, f.village_id]));
  const out = new Map<string, Point[]>();
  for (const ids of chunk([...villageOf.keys()], 200)) {
    const { data, error } = await supabase.from("ls_listings").select(LISTING_COLUMNS).in("listing_id", ids);
    if (error) throw failed("reading the listings' locations", error);
    for (const l of (data ?? []) as unknown as ListingPoint[]) {
      const point = toPoint(l);
      const village = villageOf.get(l.listing_id);
      if (point && village) out.set(village, [...(out.get(village) ?? []), point]);
    }
  }
  return out;
}

/** Homes whose MLS subdivision carries the village's name, for a village the listings engine does not have. */
export async function subdivisionPoints(name: string): Promise<Point[]> {
  const term = name.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
  if (term.length < 4) return [];
  const { data, error } = await supabase
    .from("ls_listings")
    .select(LISTING_COLUMNS)
    .ilike("subdivision", `%${term}%`)
    .not("latitude", "is", null)
    .limit(60);
  if (error) throw failed(`looking for ${name} by subdivision`, error);
  return ((data ?? []) as unknown as ListingPoint[]).map(toPoint).filter((p): p is Point => p !== null);
}

export interface SchoolPlace {
  id: string;
  siteId: string;
  nameKey: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/** The addresses given by hand, by site id and village key. */
export async function placesByHand(): Promise<Map<string, SchoolPlace>> {
  const { data, error } = await supabase.from("ca_school_places").select("id, site_id, name_key, name, address, latitude, longitude");
  if (error) throw failed("reading the addresses given by hand", error);
  return new Map(
    (data ?? []).map((r) => [
      `${r.site_id}|${r.name_key}`,
      { id: r.id, siteId: r.site_id, nameKey: r.name_key, name: r.name, address: r.address, lat: Number(r.latitude), lng: Number(r.longitude) },
    ])
  );
}

/** An address's place, from the US Census geocoder (free, no key); null when it finds none. */
export async function geocode(address: string): Promise<{ lat: number; lng: number; matched: string } | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!res.ok) throw new Error(`the Census geocoder answered ${res.status}`);
  const data = (await res.json()) as { result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number } }[] } };
  const match = data.result?.addressMatches?.[0];
  return match ? { lat: match.coordinates.y, lng: match.coordinates.x, matched: match.matchedAddress } : null;
}

export interface PlaceView {
  id: string;
  site: string | null;
  name: string;
  address: string;
  createdAt: string;
}

/** The addresses given by hand, for the School Zones tab. */
export async function listPlaces(): Promise<PlaceView[]> {
  const { data, error } = await supabase
    .from("ca_school_places")
    .select("id, name, address, created_at, fp_sites:site_id(domain)")
    .order("name");
  if (error) throw failed("reading the addresses given by hand", error);
  return (data ?? []).map((r) => ({
    id: r.id,
    site: (r.fp_sites as unknown as { domain: string } | null)?.domain ?? null,
    name: r.name,
    address: r.address,
    createdAt: r.created_at,
  }));
}

/** Places a village by an address, geocoded now; the next scan asks about it there. */
export async function savePlace(domain: string, name: string, address: string): Promise<Outcome> {
  const village = name.trim();
  const where = address.trim();
  if (!village || !where) return { ok: false, status: 400, error: "Give the village and an address in it" };
  const { data: site, error } = await supabase.from("fp_sites").select("id").eq("domain", domain).maybeSingle();
  if (error) throw failed("reading the site", error);
  if (!site) return { ok: false, status: 404, error: `No site ${domain}` };
  const found = await geocode(where);
  if (!found) return { ok: false, status: 400, error: `No match for "${where}": give a full street address with the city` };
  const { error: saveError } = await supabase.from("ca_school_places").upsert(
    {
      site_id: site.id,
      name_key: villageKey(village),
      name: village,
      address: found.matched,
      latitude: found.lat,
      longitude: found.lng,
    },
    { onConflict: "site_id,name_key" }
  );
  if (saveError) throw failed("saving the address", saveError);
  return { ok: true };
}

export async function removePlace(id: string): Promise<Outcome> {
  const { data, error } = await supabase.from("ca_school_places").delete().eq("id", id).select("id");
  if (error) throw failed("removing the address", error);
  if (!data?.length) return { ok: false, status: 404, error: "No address by that id" };
  return { ok: true };
}
