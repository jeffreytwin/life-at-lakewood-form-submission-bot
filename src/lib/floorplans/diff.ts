// Pure diff rules for the sync core: which fields changed between the
// canonical record and tonight's scrape, and what record an approved update
// writes. No IO here, so the rules that protect a person's edits can be
// tested on their own.

import { createHash } from "node:crypto";
import { type NormalizedPlan } from "@/lib/floorplans/types";

/** Canonical records written by the first slice carry the main image here instead of in galleryImages. */
export type CanonicalRecord = NormalizedPlan & { primaryImage?: string | null };

/** Scalar fields diffed for updates: record key -> label shown in the review queue. */
export const DIFF_FIELDS: [keyof NormalizedPlan, string][] = [
  ["priceDisplay", "price"],
  ["name", "name"],
  ["beds", "beds"],
  ["baths", "baths"],
  ["sqft", "sqft"],
  ["garages", "garages"],
  ["quickMoveIn", "quick move-in"],
  ["relatedPlanName", "base plan"],
  ["hasQuickMoveIns", "quick move-ins available"],
  ["virtualTourUrl", "virtual tour"],
  ["description", "description"],
];

/** Flags: a missing value is "no", and the queue reads yes/no. */
const BOOLEAN_FIELDS = new Set<keyof NormalizedPlan>(["quickMoveIn", "hasQuickMoveIns"]);

/**
 * A quick move-in's row on the site is its address, price, one picture,
 * description and base plan; Wellen Park and Parrish leave the rest blank
 * (docs/WIX_COLLECTIONS.md, "Quick move-ins"). So only these earn a review
 * row for a quick move-in; its specs and the rest of its gallery still
 * update in the canonical record when any of these change.
 */
const QMI_FIELDS = new Set<keyof NormalizedPlan>(["name", "priceDisplay", "description", "relatedPlanName", "quickMoveIn"]);

/** Fields shown with thousands separators in the queue ("3,908"), while the record keeps the number. */
const NUMERIC_FIELDS = new Set<keyof NormalizedPlan>(["sqft"]);

/** Fields too long to show or match whole; their queue values are a lead-in plus a digest, like galleries. */
const LONG_TEXT_FIELDS = new Set<keyof NormalizedPlan>(["description"]);

/** "Contemporary elegance. The Avery's welcoming covered entry and fo… · 5f2a9c1e", or "" for nothing. */
export function describeText(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 8);
  const lead = text.length > 80 ? text.slice(0, 80).trimEnd() + "…" : text;
  return `${lead} · ${digest}`;
}

export type GalleryField = "galleryImages" | "blueprintImages";

/** Ordered image lists diffed for updates: record key -> label shown in the review queue. */
export const GALLERY_FIELDS: [GalleryField, string][] = [
  ["galleryImages", "photos"],
  ["blueprintImages", "blueprints"],
];

export interface FieldChange {
  field: keyof NormalizedPlan;
  label: string;
  oldValue: string;
  newValue: string;
}

/** The image list a record carries for a gallery field, with the first slice's primaryImage as the photo fallback. */
export function galleryOf(record: CanonicalRecord, field: GalleryField): string[] {
  const list = record[field];
  if (Array.isArray(list) && list.length) return list.filter((u): u is string => typeof u === "string");
  if (field === "galleryImages" && typeof record.primaryImage === "string" && record.primaryImage) {
    return [record.primaryImage];
  }
  return [];
}

/**
 * One line describing an image list for the review queue: "3 photos · 5f2a9c1e".
 * The digest covers the URLs in order, and it matters beyond display: the
 * sync core treats a change as identical to a rejected one when its new
 * value matches, so a rejected set stays rejected while any different set,
 * even a reorder, queues fresh.
 */
export function describeGallery(urls: string[], noun: string): string {
  if (!urls.length) return `no ${noun}`;
  const digest = createHash("sha256").update(urls.join("\n")).digest("hex").slice(0, 8);
  const word = urls.length === 1 ? noun.replace(/s$/, "") : noun;
  return `${urls.length} ${word} · ${digest}`;
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((u, i) => u === b[i]);

/**
 * The record an approved update writes. The scrape wins for every field
 * except the ones a person edited in the Hub, which keep the edited value.
 * Before this the merge was {...current, ...plan}: the diff declined to
 * propose reverting an override, and then the write-back reverted it anyway,
 * because the proposed record carried the builder's value for every field.
 */
export function mergeForUpdate(current: CanonicalRecord, plan: NormalizedPlan): NormalizedPlan {
  const overrides = new Set(current.userEditedFields ?? []);
  const merged: Record<string, unknown> = { ...current, ...plan };
  const source = current as unknown as Record<string, unknown>;
  for (const field of overrides) {
    if (field in source) merged[field] = source[field];
  }
  // The numeric price is derived from the edited display price (see the PATCH route).
  if (overrides.has("priceDisplay")) merged.price = current.price;
  merged.userEditedFields = current.userEditedFields;
  return merged as unknown as NormalizedPlan;
}

/**
 * Every field whose scraped value differs from the canonical one and that no
 * person has overridden. Galleries are compared as ordered lists: a photo
 * added, dropped or moved is a change, because the order is what the site
 * shows.
 */
export function fieldChanges(current: CanonicalRecord, plan: NormalizedPlan): FieldChange[] {
  const overrides = new Set(current.userEditedFields ?? []);
  const quickMoveIn = plan.quickMoveIn === true;
  const changes: FieldChange[] = [];
  for (const [field, label] of DIFF_FIELDS) {
    if (overrides.has(field)) continue;
    if (quickMoveIn && !QMI_FIELDS.has(field)) continue;
    const oldVal = BOOLEAN_FIELDS.has(field) ? current[field] === true : current[field];
    const newVal = BOOLEAN_FIELDS.has(field) ? plan[field] === true : plan[field];
    if (String(oldVal ?? "") === String(newVal ?? "")) continue;
    const show = LONG_TEXT_FIELDS.has(field)
      ? describeText
      : NUMERIC_FIELDS.has(field)
        ? (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : String(v ?? ""))
        : BOOLEAN_FIELDS.has(field)
          ? (v: unknown) => (v === true ? "yes" : "no")
          : (v: unknown) => String(v ?? "");
    changes.push({ field, label, oldValue: show(oldVal), newValue: show(newVal) });
  }
  for (const [field, label] of GALLERY_FIELDS) {
    if (overrides.has(field)) continue;
    // A quick move-in shows one picture and no drawings.
    if (quickMoveIn && field === "blueprintImages") continue;
    const before = quickMoveIn ? galleryOf(current, field).slice(0, 1) : galleryOf(current, field);
    const after = quickMoveIn ? galleryOf(plan, field).slice(0, 1) : galleryOf(plan, field);
    if (sameList(before, after)) continue;
    changes.push({ field, label, oldValue: describeGallery(before, label), newValue: describeGallery(after, label) });
  }
  return changes;
}
