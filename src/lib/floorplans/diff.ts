// Pure diff rules for the sync core: which fields changed between the
// canonical record and tonight's scrape, and what record an approved update
// writes. No IO here, so the rules that protect a person's edits can be
// tested on their own.

import { createHash } from "node:crypto";
import { type NormalizedPlan } from "@/lib/floorplans/types";
import { speaksAsOwner } from "@/lib/floorplans/owner-words";
import { asTour } from "@/lib/floorplans/standardize";
import { looksLikeSpecList } from "@/lib/floorplans/description";
import { onePerPicture, pictureKey, sharperCopy } from "@/lib/floorplans/extractors/plan-page";
import { TOUR_REVIEW_LABEL } from "@/lib/floorplans/tour-review-label";

/** Canonical records written by the first slice carry the main image here instead of in galleryImages. */
export type CanonicalRecord = NormalizedPlan & { primaryImage?: string | null };

/**
 * Scalar fields diffed for updates: record key -> label shown in the review
 * queue. Not whether a floor plan has quick move-ins: that is counted from
 * the quick move-ins in Wix and kept without a review (qmi-flags.ts; Jeff,
 * 2026-09-25).
 */
export const DIFF_FIELDS: [keyof NormalizedPlan, string][] = [
  ["priceDisplay", "price"],
  ["name", "name"],
  ["beds", "beds"],
  ["baths", "baths"],
  ["sqft", "sqft"],
  ["garages", "garages"],
  ["quickMoveIn", "quick move-in"],
  ["relatedPlanName", "base plan"],
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

/** What the entities a page can leave in its text stand for: Starlight's "&rsquo;" and "&mdash;" came through as written one night and as the characters the next (2026-10-08). */
const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  shy: "",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
  bull: "•",
  times: "×",
  reg: "®",
  trade: "™",
  copy: "©",
  deg: "°",
  sup2: "²",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  cent: "¢",
  eacute: "é",
  ntilde: "ñ",
};

/**
 * An entity left in a text: "&rsquo;", "&#8217;", "&#x2019;", and "and#8217;",
 * as a reading of Neal Signature's Kingfisher 2 wrote "owners&#8217;" with
 * its ampersand spelled out (2026-10-13).
 */
const ENTITY = /(&|and)(#x[0-9a-f]+|#\d+);|&([a-z][a-z0-9]*);/gi;

/**
 * The character a numeric entity stands for, where it stands for one a
 * text would hold: no control characters, and spelled out ("and#8217;")
 * only a quote, an ampersand or a typographic character, so "Brand#1;"
 * stays as it is.
 */
function entityCharacter(prefix: string, number: string): string | null {
  const code = /^#x/i.test(number) ? parseInt(number.slice(2), 16) : parseInt(number.slice(1), 10);
  if (!Number.isInteger(code) || code > 0x10ffff) return null;
  if (code < 32 && code !== 9 && code !== 10 && code !== 13) return null;
  if (code >= 127 && code < 160) return null;
  if (prefix !== "&" && code < 160 && code !== 34 && code !== 38 && code !== 39) return null;
  return String.fromCodePoint(code);
}

/**
 * A text with its entities as the characters they stand for, those written
 * twice over ("&amp;rsquo;") too. Pure; exported for tests.
 */
export function withEntities(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(ENTITY, (whole, prefix: string | undefined, number: string | undefined, name: string | undefined) =>
      name ? ENTITIES[name.toLowerCase()] ?? whole : entityCharacter(prefix!, number!) ?? whole
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Whether a text still shows an entity a page left in it (withEntities): the site would show it as typed. Pure. */
export const showsEntities = (text: string | null | undefined): boolean => withEntities(String(text ?? "")) !== String(text ?? "");

/**
 * The plan with entities its description was read with written as the
 * characters they stand for. The site's description is plain text, and
 * shows "today&rsquo;s" as typed: DRB's Eider and eleven more read so
 * (2026-10-13), and a page copied word for word (claude-extract.ts) can
 * carry them too. Pure.
 */
export function withPlainDescription(plan: NormalizedPlan): NormalizedPlan {
  const original = plan.raw?.descriptionOriginal;
  const coded = showsEntities(plan.description) || (typeof original === "string" && showsEntities(original));
  if (!coded) return plan;
  return {
    ...plan,
    description: typeof plan.description === "string" ? withEntities(plan.description) : plan.description,
    ...(typeof original === "string" ? { raw: { ...plan.raw, descriptionOriginal: withEntities(original) } } : {}),
  };
}

/**
 * A text as its words: the same description read again with a curly
 * apostrophe for a straight one, or "The Cypress" for "the Cypress", is
 * the same description, and was queued as a change (SimplyDwell,
 * 2026-09-23).
 */
const wordsOf = (value: unknown): string =>
  withEntities(String(value ?? ""))
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
 * of it, is not a change. `a` is the record's description, `b` the run's.
 * Exported for tests.
 */
export function sameDescription(a: string | null | undefined, b: string | null | undefined): boolean {
  if (sameWords(a, b)) return true;
  // Nor are a contact line or a line of fine print, wherever they stand
  // (aboutThePlan), nor the same clauses in another order: what is left
  // of each still has to say the same thing, word for word, all of it.
  const x = aboutThePlan(a);
  const y = aboutThePlan(b);
  if (!x || !y) return false;
  return bareWords(x) === bareWords(y) || sameClauses(x, y);
}

/** The same words, or one reading holding the other whole, most of it (sameDescription): `a` the record's, `b` the run's. */
function sameWords(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = bareWords(a);
  const y = bareWords(b);
  if (x === y) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  const few = wordCount(shorter);
  if (few < 12 || few < 0.5 * wordCount(longer)) return false;
  if (` ${longer} `.includes(` ${shorter} `)) return true;
  // The run's reading cut off in a word ("and a club ro", Neal Signature's
  // Seaside 2, 2026-10-13) holds the record's as far as it goes. Only the
  // run's, so a record that was cut off is put right; and only in a word
  // of letters with no full stop after it, so "Feb 1" is not "Feb 15" nor
  // "Ready in 3." "Ready in 35 days."
  return shorter === y && x !== y && /(?:^|\s)\p{L}+$/u.test(String(b ?? "").trim()) && ` ${longer} `.includes(` ${shorter}`);
}

/**
 * The same clauses, each word for word, in whatever order: KB's highlights
 * as a list one night and the same highlights in another order the next.
 * A clause that changed by a word, or a number, still makes the texts
 * differ ("3 bedrooms, 2 baths" is not "2 bedrooms, 3 baths"). Only for a
 * text with one list at most: under two headings ("Included: …
 * Optional: …", "First floor - … Second floor - …") a room that moved
 * from one to the other is a change, so those are compared as they stand.
 */
function sameClauses(a: string, b: string): boolean {
  if (headings(a) > 1 || headings(b) > 1) return false;
  // A comma in "3,000" and a point in "2.5" are no breaks.
  const clauses = (text: string) =>
    withEntities(text)
      .split(/[;:!?\n•·]+|,(?!\d{3}\b)|\.(?!\d)|\s[-–—|]\s/)
      .map((clause) => bareWords(clause))
      .filter(Boolean)
      .sort();
  const x = clauses(a);
  const y = clauses(b);
  return x.length > 1 && x.length === y.length && x.every((clause, i) => clause === y[i]);
}

/** The lists a text heads with a colon or a spaced dash; the colon in "10:00" heads none. */
const headings = (text: string): number => (withEntities(text).match(/(?<!\d):|:(?!\d)|\s[-–—]\s/g) ?? []).length;

/**
 * A sentence that asks the reader to get in touch, come by or book a
 * tour, rather than saying anything about the plan. Builders end, and
 * sometimes break, a description with one, and a page gives it on one
 * read and not the next: M/I's Interlude came with "Learn more about this
 * impressive plan by contacting us today to schedule your tour!" in its
 * third sentence one night and without it the next, and since its "us"
 * has the whole description reworded (description.ts), the two read
 * differently all the way through and each was proposed over the other,
 * six days running (Jeff, 2026-10-13).
 */
const ASKS: RegExp[] = [
  /\b(?:contact(?:ing)?|call(?:ing)?(?! (?:it )?home\b)|e-?mail(?:ing)?|text(?:ing)?|reach(?:ing)? out|chat with|speak(?:ing)? (?:to|with)|talk(?:ing)? (?:to|with))\b[^.!?]*\b(?:us|today|now|team|sales|agents?|consultants?|counselors?|specialists?|advisors?|representatives?|guides?|experts?|office|information|info|details|learn|schedule|book|appointments?|tours?)\b/i,
  /\b(?:schedule|book|request|arrange|set up|reserve)\b[^.!?]*\b(?:tours?|appointments?|visits?|showings?|consultations?|walk-?throughs?)\b/i,
  /\b(?:come|stop|swing|drop) (?:on )?by\b|\bstop in\b|\bcome (?:and )?(?:see|visit|tour)\b|\bcome out (?:and|to)\b/i,
  /\bvisit\b[^.!?]*\b(?:today|us|our (?:model|sales|welcome|information|design)|the (?:model|sales|welcome|information|design) (?:home|center|office|studio)|model homes?|sales (?:center|office))\b/i,
  /\b(?:learn|find out|hear) (?:more|how|about)\b/i,
  /\bask (?:about|us|our)\b/i,
  /\b(?:rsvp|sign up|register (?:now|today|for))\b/i,
  /\b(?:don'?t miss|won'?t last)\b/i,
];

/**
 * A line of fine print: what a price does not include, that the pictures
 * are only illustrations, that anything may change. Neal's White Star
 * swapped "Come by and explore Boca Royale…" for "*Base price does not
 * include homesite premium or design options" (2026-10-08): neither says
 * anything about the plan.
 */
const FINE_PRINT: RegExp[] = [
  // "*Base price…", not a list's "* 4 bedrooms".
  /^\s*(?:\*(?=\S)|disclaimer\b|note:)/i,
  /\b(?:prices?|pricing)\b[^.!?]*\b(?:subject to change|(?:does|do|may) not include|excludes?|excluding|exclusive of|without notice)\b/i,
  /\bsubject to change\b|\bwithout notice\b/i,
  /\b(?:photos?|photographs?|pictures|images?|renderings?|illustrations?|imagery)\b[^.!?]*\b(?:illustrative|representative|for illustration|artist'?s?|may (?:show|include|depict|differ|vary)|for display)\b/i,
  /\b(?:square footages?|dimensions|measurements)\b[^.!?]*\b(?:approximate|may vary)\b/i,
  /\bhomesites?\b[^.!?]*\b(?:premiums?|additional cost)\b|\bnot (?:reflected|included) in the (?:base )?price\b/i,
  /\bnot all (?:features|options|plans|elevations)\b|\bequal housing\b/i,
];

/** Whether a sentence asks the reader to get in touch or is fine print (ASKS, FINE_PRINT). Pure; exported for tests. */
export function asksOrFinePrint(sentence: string): boolean {
  return ASKS.some((ask) => ask.test(sentence)) || FINE_PRINT.some((line) => line.test(sentence));
}

/** A phone number or a date, which a contact line or fine print may carry without saying anything about the plan. */
const NOT_THE_PLAN: RegExp[] = [
  /\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}\b/g,
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
  /(?:©|\(c\)|\bcopyright)\s*\d{4}\b/gi,
];

/** A room, or a part of a home, as a description names it. */
const ROOMS =
  /\b(?:bed(?:room)?s?|bath(?:room)?s?|rooms?|garages?|kitchens?|lanais?|pools?|spas?|porch(?:es)?|patios?|dens?|(?<!(?:sales|welcome|information|leasing) )offices?|study|studies|lofts?|flex|bonus|suites?|closets?|pantr(?:y|ies)|laundry|dining|living (?:areas?|spaces?)|foyers?|islands?|courtyards?|decks?|balcon(?:y|ies)|fireplaces?|showers?|tubs?|stor(?:y|ies)|(?:first|second|third|ground|main|upper|lower) (?:floors?|levels?)|staircases?|stairs|elevators?|yards?|backyards?|screened|cabanas?|casitas?|retreats?|lots?|views|wet bars?|countertops?|cabinet(?:s|ry)?|appliances?|flooring|ceilings?|windows?)\b/i;

/**
 * Whether a sentence says something only the plan's own sentences say: a
 * number (a phone number or a date aside) or a room. Such a sentence is
 * never dropped as an ask or fine print, whatever else it says: "the
 * perfect place to call home, with 4 bedrooms and a home office", "Don't
 * miss the oversized lanai" and "Learn how the flex room converts to a 5th
 * bedroom" describe the plan, and a change in them is a change. Pure;
 * exported for tests.
 */
export function carriesPlanFacts(sentence: string): boolean {
  const rest = NOT_THE_PLAN.reduce((text, pattern) => text.replace(pattern, " "), sentence);
  return /\d/.test(rest) || ROOMS.test(sentence);
}

/**
 * What a description says about the plan: its sentences without the asks
 * and the fine print (asksOrFinePrint) that name no number and no room
 * (carriesPlanFacts), its entities as characters. Every other sentence is
 * kept as it is, so a change anywhere in what the plan is still reads as a
 * change. "" for a text that is all asks. Pure; exported for tests.
 */
export function aboutThePlan(text: string | null | undefined): string {
  return withEntities(String(text ?? ""))
    .split(/\s*[\r\n]+\s*|(?<=[.!?]["')\]]?)\s+(?=["'(\[*]?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !(asksOrFinePrint(sentence) && !carriesPlanFacts(sentence)))
    .join(" ");
}

/** What the builder wrote: the text before it was reworded in the third person (description.ts), where it was. */
const builderText = (plan: NormalizedPlan): string => {
  const original = plan.raw?.descriptionOriginal;
  return typeof original === "string" && original.trim() ? original : plan.description ?? "";
};

/**
 * Whether a plan's description is one we wrote (description.ts,
 * describePlan): marked so since 2026-09-25, and known by its words on
 * records written before.
 */
const OUR_SENTENCE = /\bis available to be built in\b[\s\S]*?\bThe price shown is the base price\./;
const weWrote = (plan: NormalizedPlan): boolean =>
  plan.raw?.descriptionGenerated === true || OUR_SENTENCE.test(plan.description ?? "");

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
  // One we wrote because this run read none never replaces the builder's:
  // KB's Creekside pages give their text on one read and only a list of
  // features on the next, and the queue proposed our stock sentence over
  // the builder's own (Jeff, 2026-09-25).
  if (weWrote(plan) && current.description?.trim() && !weWrote(current)) return false;
  // Nor ours over ours: it says only what the plan's own fields say, and
  // those are proposed as themselves (Kolter's baths, 2026-09-26). An
  // approval writes the run's, so it says what the record then does
  // (mergeForUpdate).
  if (weWrote(plan) && weWrote(current)) return false;
  const next = plan.description?.trim() ?? "";
  const before = current.description?.trim() ?? "";
  if (!next || next === before) return false;
  // A card's spec line is no description, whatever stands (Kolter's,
  // 2026-09-28); a run that reads one gives the plan ours instead.
  if (looksLikeSpecList(next)) return false;
  if (!before) return true;
  if (readsAsProse(before) && !readsAsProse(next)) return false;
  // The same words without the entities the site shows as typed
  // ("today&rsquo;s") put them right: a change, once (withPlainDescription).
  // Reworded, the builder's words are the same ones.
  if (showsEntities(before) && !showsEntities(next) && (sameDescription(before, next) || sameDescription(builderText(current), builderText(plan)))) {
    return !speaksAsOwner(next);
  }
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
  // A tour that did not come back may only not have been found, and a
  // working one is kept, unless the page said it has none (tourStated).
  if (!next) return Boolean(before) && (!asTour(before) || plan.tourStated === true);
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

/**
 * The same pictures in the same order, however their addresses are
 * spelled: Neal's "…Elevation-FH1.jpg?auto=format%2Ccompress&fit=max&w=1000"
 * one night and "…Elevation-FH1.jpg" the next is one photo, and the queue
 * showed it as a new one (Jeff, 2026-09-25). A photo that truly changed is
 * still a change, and so is one `b` has sharp where `a` has only a
 * thumbnail of it (sharperCopy: Kolter's Sarah, 2026-09-30). Pure;
 * exported for tests.
 */
export function samePictures(a: string[], b: string[]): boolean {
  // Each photo once: a gallery that carried one at two sizes is the same
  // gallery once it carries it at one.
  const pa = onePerPicture(a).photos;
  const pb = onePerPicture(b).photos;
  const ka = pa.map(pictureKey);
  const kb = pb.map(pictureKey);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]) && !pb.some((u, i) => sharperCopy(u, pa[i]));
}

/** A picture CPS's plan viewer drew, or the Hub drew from it (planviewer.ts). */
const FROM_VIEWER = /planviewer\.cpsusa\.com\/|\/api\/floorplans\/planviewer\//i;

/**
 * Whether a run read enough of a gallery to speak for it. It did not when
 * it could not read the plan's own page, when it found none of the plan's
 * pictures, or when it found only a part of what the record already has
 * and nothing new: Richmond's Fraser came back with its one rendering and
 * none of its thirteen interiors, whose tab the browser pressed before the
 * page answered, and the queue proposed taking the thirteen down (Jeff,
 * 2026-09-25). A builder that replaces its pictures shows new ones; one
 * that only drops a few is still read as a change. Pure; exported for tests.
 */
export function galleryRead(current: CanonicalRecord, plan: NormalizedPlan, field: GalleryField): boolean {
  if (plan.pageUnread === true) return false;
  // The plan viewer's pictures are not the builder's page's: a run that
  // leaves them out where the page draws its own (claude-extract.ts,
  // viewerFills) has not read the page only in part.
  const before = onePerPicture(galleryOf(current, field)).photos.filter((u) => !FROM_VIEWER.test(u));
  const after = onePerPicture(galleryOf(plan, field)).photos;
  if (!before.length) return true;
  if (!after.length) return false;
  const had = new Set(before.map(pictureKey));
  const lost = before.length - after.length;
  const onlyPart = after.every((u) => had.has(pictureKey(u))) && lost >= 3 && after.length * 2 <= before.length;
  return !onlyPart;
}

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
  // Nor a home's base plan, which a run may not read (baseUnread).
  if (baseUnread(current, plan) && !overrides.has("relatedPlanName")) merged.relatedPlanName = current.relatedPlanName;
  // Nor a description or a tour the run read differently, or not at all,
  // when that is not a change (descriptionChanged, tourChanged): the record
  // keeps its own, and the site is not rewritten with a variant of it.
  // A description kept as it stands (a person's edit, a rejection, or one
  // waiting for a second reading, confirm-reads.ts) keeps the builder's
  // words it was read from with it: written with the run's, the next run
  // would compare the builder's words with themselves and never propose
  // the description it was holding.
  if (overrides.has("description") || (!(weWrote(current) && weWrote(plan)) && !descriptionChanged(current, plan))) {
    merged.description = current.description ?? null;
    const original = current.raw?.descriptionOriginal;
    const raw = { ...((merged.raw as Record<string, unknown> | undefined) ?? {}) };
    if (typeof original === "string") raw.descriptionOriginal = original;
    else delete raw.descriptionOriginal;
    if (weWrote(current)) raw.descriptionGenerated = true;
    else delete raw.descriptionGenerated;
    merged.raw = raw;
  }
  if (!overrides.has("virtualTourUrl") && !tourChanged(current, plan)) {
    merged.virtualTourUrl = current.virtualTourUrl ?? null;
    if ("virtualTourImage" in source) merged.virtualTourImage = current.virtualTourImage ?? null;
  }
  // Nor what the run could not speak for (fieldChanges skips the same):
  // a page it never read, or a gallery it read only part of. Approving
  // another change wrote the list page's one picture over the gallery.
  if (plan.pageUnread === true) {
    for (const field of PAGE_ONLY_FIELDS) if (field in source && !overrides.has(field)) merged[field] = source[field];
  }
  let photosFromRun = false;
  for (const [field] of GALLERY_FIELDS) {
    if (overrides.has(field)) continue;
    // The same pictures under other addresses: the record's addresses stay,
    // so an approval of something else does not bring them in again.
    const same = samePictures(galleryOf(current, field), galleryOf(plan, field));
    if (galleryRead(current, plan, field) && !same) {
      if (field === "galleryImages") {
        // The run's photos are not the ones the record's were checked and
        // sorted as: checked again for copies and sorted again (sort-queue.ts).
        // Carried over, they let every copy a run read reach the queue
        // (Jeff, 2026-09-28).
        for (const f of ["photosSorted", "copiesChecked"]) if (!(f in plan)) delete merged[f];
        photosFromRun = true;
      }
      continue;
    }
    // Each photo once, at the largest copy the record has of it.
    merged[field] = same ? onePerPicture(galleryOf(current, field)).photos : galleryOf(current, field);
    if (field === "galleryImages") {
      for (const f of ["galleryMeta", "photosSorted", "copiesChecked"]) {
        if (f in source) merged[f] = source[f];
        else delete merged[f];
      }
    }
  }
  // A picture the run now reads as a photo is no longer a drawing: D.R.
  // Horton's elevations and bonus rooms moved to the photos (2026-09-26),
  // but a run that read no drawings left the record's in place, and an
  // approval would have shown each twice (Jeff, 2026-09-28).
  if (photosFromRun && !overrides.has("blueprintImages")) {
    const photos = new Set(galleryOf(merged as unknown as CanonicalRecord, "galleryImages").map(pictureKey));
    const drawings = galleryOf(merged as unknown as CanonicalRecord, "blueprintImages");
    const only = drawings.filter((url) => !photos.has(pictureKey(url)));
    if (only.length !== drawings.length) merged.blueprintImages = only;
  }
  // Whether it has quick move-ins is what Wix holds under it, kept by the
  // flag check (qmi-flags.ts), not what this run counted.
  if (typeof current.hasQuickMoveIns === "boolean") merged.hasQuickMoveIns = current.hasQuickMoveIns;
  merged.userEditedFields = current.userEditedFields;
  return merged as unknown as NormalizedPlan;
}

/**
 * The record with only its description taken from the run: what an
 * automatically approved quick move-in description writes, whatever else
 * about the home is waiting for review (Jeff, 2026-09-25). Pure.
 */
export function withDescriptionFrom(current: CanonicalRecord, plan: NormalizedPlan): NormalizedPlan {
  const raw = { ...(current.raw ?? {}) };
  const original = plan.raw?.descriptionOriginal;
  if (typeof original === "string") raw.descriptionOriginal = original;
  else delete raw.descriptionOriginal;
  return { ...current, description: plan.description ?? null, raw } as NormalizedPlan;
}

/** How far a price may move and be approved without a review: a fifth of what it was (Jeff, 2026-09-26). */
export const PRICE_SHARE_ON_ITS_OWN = 0.2;

/**
 * Whether a price change is small enough to approve without a review:
 * both prices known, and the new one within a fifth of the old, up or
 * down. A price first given, or taken away, is still for a person. Pure.
 */
export function priceWithin(current: NormalizedPlan, plan: NormalizedPlan, share = PRICE_SHARE_ON_ITS_OWN): boolean {
  const before = current.price;
  const next = plan.price;
  if (typeof before !== "number" || typeof next !== "number" || before <= 0 || next <= 0) return false;
  return Math.abs(next - before) / before <= share + 1e-9;
}

/**
 * The changes a run approves without a review, and the ones it puts to a
 * person. A quick move-in's description is approved on its own whatever
 * else changed (the site does not show it; Jeff, 2026-09-25). A price that
 * moved by a fifth or less is approved on its own only when it is all that
 * changed: with anything else, the plan is put to a person whole (Jeff,
 * 2026-09-26). Nothing is approved on its own for a plan not yet on the
 * site. Pure; exported for tests.
 */
export function splitOnItsOwn(
  current: NormalizedPlan,
  plan: NormalizedPlan,
  changes: FieldChange[],
  published: boolean
): { onItsOwn: FieldChange[]; reviewed: FieldChange[] } {
  if (!published) return { onItsOwn: [], reviewed: changes };
  const described = plan.quickMoveIn === true ? changes.find((c) => c.field === "description") : undefined;
  const price = changes.find((c) => c.field === "priceDisplay" && priceWithin(current, plan));
  const others = changes.filter((c) => c !== described && c !== price);
  const onItsOwn = [described, others.length === 0 ? price : undefined].filter((c): c is FieldChange => Boolean(c));
  return { onItsOwn, reviewed: changes.filter((c) => !onItsOwn.includes(c)) };
}

/** The record with only its price taken from the run: what a small price change approved without a review writes. Pure. */
export function withPriceFrom(current: CanonicalRecord, plan: NormalizedPlan): NormalizedPlan {
  return { ...current, price: plan.price ?? null, priceDisplay: plan.priceDisplay ?? null } as NormalizedPlan;
}

/**
 * What a change approved without a review writes, onto the record as it
 * stands when it is written rather than as it stood when the run queued
 * it: a change a person approved in between (the photos, say) stays.
 * Only the change's own field is taken from the queued record. Pure.
 */
export function ownFieldOnto(latest: NormalizedPlan | null, queued: NormalizedPlan, label: string | null): NormalizedPlan {
  if (!latest) return queued;
  if (label === "price") return { ...latest, price: queued.price ?? null, priceDisplay: queued.priceDisplay ?? null };
  if (label === "description") {
    const raw = { ...(latest.raw ?? {}) };
    const original = queued.raw?.descriptionOriginal;
    if (typeof original === "string") raw.descriptionOriginal = original;
    else delete raw.descriptionOriginal;
    return { ...latest, description: queued.description ?? null, raw };
  }
  // A tour the weekly review put to a person: only the tour comes off.
  if (label === TOUR_REVIEW_LABEL) return { ...latest, virtualTourUrl: null, virtualTourImage: null };
  return queued;
}

/**
 * Whether a run read no base plan for a home that has one. That is the
 * reading, not the builder: Medallion's River Preserve Estates page gives
 * each home's plan on one read and not the next, and the queue proposed
 * taking "Belize" off 12422 Stonegate Trail (Jeff, 2026-09-26). A base
 * plan the run reads differently is still a change.
 */
const baseUnread = (current: CanonicalRecord, plan: NormalizedPlan): boolean =>
  !plan.relatedPlanName?.trim() && Boolean(current.relatedPlanName?.trim());

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
    if (field === "relatedPlanName" && baseUnread(current, plan)) continue;
    labels.push(label);
  }
  for (const [field, label] of GALLERY_FIELDS) {
    if (overrides.has(field) || !galleryRead(current, plan, field) || (quickMoveIn && field === "blueprintImages")) continue;
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
    if (field === "relatedPlanName" && baseUnread(current, plan)) continue;
    const oldVal = BOOLEAN_FIELDS.has(field) ? current[field] === true : current[field];
    const newVal = BOOLEAN_FIELDS.has(field) ? plan[field] === true : plan[field];
    if (String(oldVal ?? "") === String(newVal ?? "")) continue;
    if (field === "description" && !descriptionChanged(current, plan)) continue;
    if (field === "virtualTourUrl" && !tourChanged(current, plan)) continue;
    // The same words are no change, unless they put right entities the site shows as typed (descriptionChanged).
    if (LONG_TEXT_FIELDS.has(field) && wordsOf(oldVal) === wordsOf(newVal) && !(showsEntities(String(oldVal ?? "")) && !showsEntities(String(newVal ?? "")))) continue;
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
    if (!galleryRead(current, plan, field)) continue;
    // A quick move-in shows one picture and no drawings.
    if (quickMoveIn && field === "blueprintImages") continue;
    const before = quickMoveIn ? galleryOf(current, field).slice(0, 1) : galleryOf(current, field);
    const after = quickMoveIn ? galleryOf(plan, field).slice(0, 1) : galleryOf(plan, field);
    if (samePictures(before, after)) continue;
    changes.push({ field, label, oldValue: describeGallery(before, label), newValue: describeGallery(after, label) });
  }
  return changes;
}
