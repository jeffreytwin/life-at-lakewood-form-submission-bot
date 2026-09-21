// The builder's own picture sets ride along on every queued record, so a
// picture removed in the overlay by mistake can be brought back (Jeff,
// 2026-09-21: a per-plan "restore" in the edit overlay). No IO here.

import type { NormalizedPlan } from "@/lib/floorplans/types";

/** The record with the builder's current pictures remembered beside whatever the record shows. */
export function withScrapedPictures<T extends NormalizedPlan>(record: T, scraped: NormalizedPlan): T {
  return {
    ...record,
    scrapedGalleryImages: [...scraped.galleryImages],
    scrapedBlueprintImages: [...(scraped.blueprintImages ?? [])],
  };
}
