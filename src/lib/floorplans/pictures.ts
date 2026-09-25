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
 * 2026-09-25). A photo the record does not have keeps its own address.
 * Pure.
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
  const photo = respeller(current.galleryImages);
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
