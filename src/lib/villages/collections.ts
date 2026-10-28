// A site's village collections (Jeff, 2026-10-28). Life At Lakewood keeps
// two: Village Details (AmenitiesbyVillage), every village, the source of
// truth; and Dynamic Village Pages (HousesforSale-DynamicPages), only the
// villages that have, or will have, a dynamic village page, each pointing
// back at its Village Details row through its Village reference. Wellen
// Park and Parrish keep one, their Neighborhoods collection, under the same
// HousesforSale-DynamicPages id and in the same field names.

import { getDataCollection, updateDataCollection, type WixCollectionField, type WixDataItem } from "@/lib/wix/client";
import { villageKey } from "@/lib/villages/ranges";

export const VILLAGE_DETAILS = "AmenitiesbyVillage";
export const VILLAGE_PAGES = "HousesforSale-DynamicPages";

/** What the site calls each collection. */
export function collectionLabel(domain: string, collectionId: string): string {
  if (collectionId === VILLAGE_DETAILS) return "Village Details";
  return domain === "lifeatlakewood.com" ? "Dynamic Village Pages" : "Neighborhoods";
}

/** The school fields, as the village pages collections name them; Village Details gets the same three. */
export const SCHOOL_FIELD_DEFS: { key: string; displayName: string }[] = [
  { key: "villageElementarySchool", displayName: "Village Elementary School" },
  { key: "villageMiddleSchool", displayName: "Village Middle School" },
  { key: "villageHighSchool", displayName: "Village High School" },
];

/**
 * Adds the three school fields to a collection that lacks them, of the
 * type the village pages collection gives them (Jeff, 2026-10-28: "Yes add
 * the fields"). True when it added any.
 */
export async function ensureSchoolFields(wixSiteId: string, collectionId: string, type = "RICH_TEXT"): Promise<boolean> {
  const collection = await getDataCollection(wixSiteId, collectionId);
  if (!collection) throw new Error(`the site has no ${collectionId} collection`);
  const have = new Set(collection.fields.map((f) => f.key));
  const names = new Set(collection.fields.map((f) => (f.displayName ?? "").toLowerCase()));
  const missing = SCHOOL_FIELD_DEFS.filter((f) => !have.has(f.key) && !names.has(f.displayName.toLowerCase()));
  if (!missing.length) return false;
  await updateDataCollection(wixSiteId, { ...collection, fields: [...collection.fields, ...missing.map((f) => ({ ...f, type }))] });
  return true;
}

/** The key of the field with this display name (and type, when given). */
export const fieldNamed = (fields: WixCollectionField[], name: RegExp, type?: string) =>
  fields.find((f) => name.test(f.displayName ?? "") && (!type || f.type === type))?.key ?? null;

/** A reference field's value, whether Wix gives it as the id or the referenced item. */
export function referenceId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const id = (value as Record<string, unknown>)._id ?? (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/** A row's names, by the keys that hold them. */
export function rowNames(item: WixDataItem, keys: (string | null | undefined)[]): string[] {
  return keys
    .map((k) => (k ? item.data?.[k] : null))
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim());
}

/**
 * The rows of a collection by every name they carry, and by the item a
 * reference field points at. A published row wins over a draft of the
 * same name. Pure; exported for tests.
 */
export function indexRows(items: WixDataItem[], nameKeys: (string | null)[], refKey: string | null = null) {
  const byName = new Map<string, WixDataItem>();
  const byRef = new Map<string, WixDataItem>();
  const better = (held: WixDataItem | undefined, item: WixDataItem) =>
    !held || (held.data?._publishStatus === "DRAFT" && item.data?._publishStatus !== "DRAFT");
  for (const item of items) {
    for (const name of rowNames(item, nameKeys)) {
      const k = villageKey(name);
      if (better(byName.get(k), item)) byName.set(k, item);
    }
    const ref = refKey ? referenceId(item.data?.[refKey]) : null;
    if (ref && better(byRef.get(ref), item)) byRef.set(ref, item);
  }
  return { byName, byRef, byId: new Map(items.map((i) => [i.id, i])) };
}
