// Pure diff rules for the sync core: which fields changed between the
// canonical record and tonight's scrape, and what record an approved update
// writes. No IO here, so the rules that protect a person's edits can be
// tested on their own.

import { createHash } from "node:crypto";
import { type NormalizedPlan } from "@/lib/floorplans/types";
import { speaksAsOwner } from "@/lib/floorplans/owner-words";
import { asTour } from "@/lib/floorplans/standardize";

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

/**
 * A text as its words: the same description read again with a curly
 * apostrophe for a straight one, or "The Cypress" for "the Cypress", is
 * the same description, and was queued as a change (SimplyDwell,
 * 2026-09-23).
 */
const wordsOf = (value: unknown): string =>
  String(value ?? "")
    .replace(/[\u2018\u2019\u201B\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** A text as its words alone, its punctuation aside: "Homesite #124." and "Homesite #124" read the same. */
const bareWords = (value: unknown): string =>
  wordsOf(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const wordCount = (text: string): number => (text ? text.split(" ").length : 0);

/**
 * Whether a text reads as a description: a sentence or more, not a tag
 * line. Medallion's cards carry "1 Story, Den/Office" and "Preserve View
 * Villa", and a run that read one of those where the plan's paragraph
 * was proposed the paragraph's replacement by it (2026-09-25). Exported
 * for tests.
 */
export function readsAsProse(text: string | null | undefined): boolean {
  const words = wordCount(bareWords(text));
  return words >= 10 || (words >= 8 && /[.!?]["')\]]?\s*$/.test(String(text ?? "").trim()));
}

/**
 * Whether two readings of a description say the same thing. The reading
 * of a page is not word-for-word the same from one run to the next: Neal's
 * homes come with or without the "MOVE IN READY – Vision 2 at Windward –
 * Homesite #478." line their page leads with, its plans with or without
 * "Come by and visit Boca Royale… Call today to schedule a private tour."
 * at the end, and a full stop comes and goes (Jeff, 2026-09-25). Either
 * way is the same description: one reading holding the other whole, most
 * of it, is not a change. Exported for tests.
 */
export function sameDescription(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = bareWords(a);
  const y = bareWords(b);
  if (x === y) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  const few = wordCount(shorter);
  return few >= 12 && few >= 0.5 * wordCount(longer) && ` ${longer} `.includes(` ${shorter} `);
}

/** What the builder wrote: the text before it was reworded in the third person (description.ts), where it was. */
const builderText = (plan: NormalizedPlan): string => {
  const original = plan.raw?.descriptionOriginal;
  return typeof original === "string" && original.trim() ? original : plan.description ?? "";
};

/**
 * Whether a run's description is a change worth a person's look. Not when
 * the run read none — a blank is not the builder taking its description
 * away (Jeff, 2026-09-25) — nor a tag line where a paragraph stands, nor
 * the same description read a little differently, nor the same one
 * before and after it was reworded; and not while it still speaks as the
 * builder, which the next run rewords before it is put to anyone.
 * Exported for tests.
 */
export function descriptionChanged(current: NormalizedPlan, plan: NormalizedPlan): boolean {
  const next = plan.description?.trim() ?? "";
  const before = current.description?.trim() ?? "";
  if (!next || next === before) return false;
  if (!before) return true;
  if (readsAsProse(before) && !readsAsProse(next)) return false;
  const was = [before, builderText(current)];
  const now = [next, builderText(plan)];
  if (was.some((a) => now.some((b) => sameDescription(a, b)))) return false;
  return !speaksAsOwner(next);
}

/**
 * Whether a run's tour is a change worth a person's look. A run that
 * found no tour does not take away one that works — the plan's page may
 * simply not have shown it this time — but does take away a link that is
 * not a tour at all (an interactive floor plan, a Lennar link that shows
 * a broken tour; standardize.ts, asTour). Exported for tests.
 */
export function tourChanged(current: NormalizedPlan, plan: NormalizedPlan): boolean {
  const next = plan.virtualTourUrl?.trim() ?? "";
  const before = current.virtualTourUrl?.trim() ?? "";
  if (next === before) return false;
  if (!next) return Boolean(before) && !asTour(before);
  return true;
}

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
export function mergeForUpdate(
  current: CanonicalRecord,
  plan: NormalizedPlan,
  kept: Iterable<keyof NormalizedPlan> = []
): NormalizedPlan {
  // Kept as they are, besides a person's edits: fields whose change was
  // rejected. Approving a price change on Lennar's Stanford wrote the
  // tour link that had been rejected the same morning, because the
  // record an approval writes carried every field the run read (Jeff,
  // 2026-09-25).
  const overrides = new Set<string>([...(current.userEditedFields ?? []), ...kept]);
  const merged: Record<string, unknown> = { ...current, ...plan };
  const source = current as unknown as Record<string, unknown>;
  for (const field of overrides) {
    if (field in source) merged[field] = source[field];
  }
  // The numeric price is derived from the edited display price (see the PATCH route).
  if (overrides.has("priceDisplay")) merged.price = current.price;
  // The score is set in the Hub and no engine knows it: the canonical one stays.
  merged.score = current.score ?? plan.score ?? null;
  // A home type is never proposed as a change (DIFF_FIELDS), so a run that
  // read none keeps the record's rather than blanking it with whatever
  // change is approved: SimplyDwell's pages name no type, and its runs
  // read one on some nights and not others (2026-09-23).
  if (!plan.homeType && current.homeType) merged.homeType = current.homeType;
  // Nor a description or a tour the run read differently, or not at all,
  // when that is not a change (descriptionChanged, tourChanged): the record
  // keeps its own, and the site is not rewritten with a variant of it.
  if (!overrides.has("description") && !descriptionChanged(current, plan)) {
    merged.description = current.description ?? null;
    const original = current.raw?.descriptionOriginal;
    const raw = { ...((merged.raw as Record<string, unknown> | undefined) ?? {}) };
    if (typeof original === "string") raw.descriptionOriginal = original;
    else delete raw.descriptionOriginal;
    merged.raw = raw;
  }
  if (!overrides.has("virtualTourUrl") && !tourChanged(current, plan)) {
    merged.virtualTourUrl = current.virtualTourUrl ?? null;
    if ("virtualTourImage" in source) merged.virtualTourImage = current.virtualTourImage ?? null;
  }
  merged.userEditedFields = current.userEditedFields;
  return merged as unknown as NormalizedPlan;
}

/** What only a plan's own page tells a run; a list page never carries these. */
const PAGE_ONLY_FIELDS = new Set(["description", "virtualTourUrl", "virtualTourImage", "garages"]);

/**
 * The queue labels of the fields a run's reading of a plan speaks for:
 * the ones fieldChanges compares. A pending change to one of these that
 * the run no longer finds is out of date (sync.ts).
 */
export function comparedFields(current: CanonicalRecord, plan: NormalizedPlan): string[] {
  const overrides = new Set(current.userEditedFields ?? []);
  const unread = plan.pageUnread === true;
  const quickMoveIn = plan.quickMoveIn === true;
  const labels: string[] = [];
  for (const [field, label] of DIFF_FIELDS) {
    if (overrides.has(field) || (unread && PAGE_ONLY_FIELDS.has(field)) || (quickMoveIn && !QMI_FIELDS.has(field))) continue;
    labels.push(label);
  }
  for (const [field, label] of GALLERY_FIELDS) {
    if (overrides.has(field) || unread || (quickMoveIn && field === "blueprintImages")) continue;
    labels.push(label);
  }
  return labels;
}

/**
 * Every field whose scraped value differs from the canonical one and that no
 * person has overridden. Galleries are compared as ordered lists: a photo
 * added, dropped or moved is a change, because the order is what the site
 * shows.
 */
export function fieldChanges(current: CanonicalRecord, plan: NormalizedPlan): FieldChange[] {
  const overrides = new Set(current.userEditedFields ?? []);
  // A run that could not read a plan's own page knows nothing about what
  // only that page holds, and must not propose dropping what a run that
  // did read it found (Jeff, 2026-09-22: Richmond American has nineteen
  // pages to render in a community and a budget for fewer).
  const unread = plan.pageUnread === true;
  const quickMoveIn = plan.quickMoveIn === true;
  const changes: FieldChange[] = [];
  for (const [field, label] of DIFF_FIELDS) {
    if (overrides.has(field)) continue;
    if (unread && PAGE_ONLY_FIELDS.has(field)) continue;
    if (quickMoveIn && !QMI_FIELDS.has(field)) continue;
    const oldVal = BOOLEAN_FIELDS.has(field) ? current[field] === true : current[field];
    const newVal = BOOLEAN_FIELDS.has(field) ? plan[field] === true : plan[field];
    if (String(oldVal ?? "") === String(newVal ?? "")) continue;
    if (field === "description" && !descriptionChanged(current, plan)) continue;
    if (field === "virtualTourUrl" && !tourChanged(current, plan)) continue;
    if (LONG_TEXT_FIELDS.has(field) && wordsOf(oldVal) === wordsOf(newVal)) continue;
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
    if (unread) continue;
    // A quick move-in shows one picture and no drawings.
    if (quickMoveIn && field === "blueprintImages") continue;
    const before = quickMoveIn ? galleryOf(current, field).slice(0, 1) : galleryOf(current, field);
    const after = quickMoveIn ? galleryOf(plan, field).slice(0, 1) : galleryOf(plan, field);
    if (sameList(before, after)) continue;
    changes.push({ field, label, oldValue: describeGallery(before, label), newValue: describeGallery(after, label) });
  }
  return changes;
}
