// The builder's own picture sets ride along on every queued record, so a
// picture removed in the overlay by mistake can be brought back (Jeff,
// 2026-09-21: a per-plan "restore" in the edit overlay), and a run's
// pictures are spelled as the record spells them. No IO here.

import type { NormalizedPlan } from "@/lib/floorplans/types";
import { onePerPicture, pictureKey } from "@/lib/floorplans/extractors/plan-page";

/** The record with the builder's current pictures remembered beside whatever the record shows. */
export function withScrapedPictures<T extends NormalizedPlan>(record: T, scraped: NormalizedPlan): T {
  return {
    ...record,
    scrapedGalleryImages: [...scraped.galleryImages],
    scrapedBlueprintImages: [...(scraped.blueprintImages ?? [])],
  };
}

/**
 * The run's pictures under the addresses the record already has for them.
 * A builder's page can name one photo by several addresses — Neal leads a
 * home with a 300-pixel copy one night and the full photo the next — and
 * what was learned about a photo (photo-rooms.ts) is filed under the
 * address it was seen at. Spelled as the record spells it, a photo keeps
 * its room and its place, and nothing is proposed for it (Jeff,
 * 2026-09-25). A photo taken out as a copy of another is filed under that
 * other. A photo the record does not have keeps its own address. Pure.
 */
export function withKnownSpellings(plan: NormalizedPlan, current: Partial<NormalizedPlan> | null | undefined): NormalizedPlan {
  if (!current) return plan;
  // Each photo under the largest copy the record has of it.
  const respeller = (known: unknown) => {
    const urls = (Array.isArray(known) ? known : []).filter((u): u is string => typeof u === "string");
    const byKey = new Map(onePerPicture(urls).photos.map((u) => [pictureKey(u), u] as const));
    return (url: string) => byKey.get(pictureKey(url)) ?? url;
  };
  // Each once: two addresses of one photo become one.
  const once = (urls: string[], respell: (url: string) => string) => [...new Set(urls.map(respell))];
  // A photo taken out as a copy of another is that other (sort-queue.ts):
  // WestBay's page gives the feed's cover photo again under a new upload,
  // and each night it came back as one photo added (Jeff, 2026-09-28).
  const copies = current.copiesOf ?? {};
  const original = (url: string) => {
    let at = url;
    for (let hops = 0; hops < 5 && copies[at] && copies[at] !== at; hops += 1) at = copies[at];
    return at;
  };
  const known = respeller(current.galleryImages);
  const photo = (url: string) => known(original(url));
  const drawing = respeller(current.blueprintImages);
  const meta: NonNullable<NormalizedPlan["galleryMeta"]> = {};
  for (const [url, m] of Object.entries(plan.galleryMeta ?? {})) {
    const known = photo(url);
    if (!(known in meta)) meta[known] = m;
  }
  return {
    ...plan,
    galleryImages: once(plan.galleryImages, photo),
    blueprintImages: once(plan.blueprintImages ?? [], drawing),
    ...(plan.galleryMeta ? { galleryMeta: meta } : {}),
  };
}

/**
 * The pictures a waiting change shows that the live plan does not, however
 * either spells them (pictureKey) and counting a copy the record has
 * already taken out (copiesOf) as the photo kept in its place: what the
 * edit overlay marks as new, so a reviewer sees what the change adds
 * (Jeff, 2026-09-28). Pure.
 */
export function picturesAdded(live: Partial<NormalizedPlan> | null | undefined, proposed: Partial<NormalizedPlan> | null | undefined): string[] {
  if (!live || !proposed) return [];
  const strings = (v: unknown) => (Array.isArray(v) ? v : []).filter((u): u is string => typeof u === "string" && u !== "");
  const copies = { ...(live.copiesOf ?? {}), ...(proposed.copiesOf ?? {}) };
  const known = new Set(
    [...strings(live.galleryImages), ...strings(live.blueprintImages), ...strings([(live as { primaryImage?: unknown }).primaryImage])].map(pictureKey)
  );
  const isKnown = (url: string) => known.has(pictureKey(url)) || (copies[url] !== undefined && known.has(pictureKey(copies[url])));
  return [...strings(proposed.galleryImages), ...strings(proposed.blueprintImages)].filter((url) => !isKnown(url));
}

/**
 * The run's photos in the order the record shows them, each photo the
 * record does not have kept just after the one the page put before it.
 * Sorting by room keeps the order it is given within a room, and that was
 * the page's order that night: D.R. Horton's Jordyn II listed its bedrooms
 * 14, 10, 11, 12 one night and 10, 11, 12, 14 another, and each change of
 * mind was proposed as the photos changed, the same photos in the same
 * rooms (Jeff, 2026-09-28). Given the record's order, the rooms decide and
 * nothing else moves. Pure.
 */
export function inKnownOrder(plan: NormalizedPlan, current: Partial<NormalizedPlan> | null | undefined): NormalizedPlan {
  const known = (Array.isArray(current?.galleryImages) ? current.galleryImages : []).filter((u): u is string => typeof u === "string");
  if (!known.length || plan.galleryImages.length < 2) return plan;
  const at = new Map(known.map((url, i) => [url, i] as const));
  let before = -1;
  let step = 0;
  const keyed = plan.galleryImages.map((url, i) => {
    const place = at.get(url);
    if (place !== undefined) {
      before = place;
      step = 0;
      return { url, key: place, i };
    }
    step += 1;
    return { url, key: before + step / (plan.galleryImages.length + 1), i };
  });
  const ordered = [...keyed].sort((a, b) => a.key - b.key || a.i - b.i).map((k) => k.url);
  return ordered.every((url, i) => url === plan.galleryImages[i]) ? plan : { ...plan, galleryImages: ordered };
}