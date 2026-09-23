// A picture that shows on most of a community's plans, and shows neither a
// room nor the outside of a home, is the community's and not the plan's.
// Mattamy files the pictures of the place — the amenity center from the
// air, the fishing pier at sunset, Siesta Key — in every plan's own
// gallery at Lakespur, beside the plan's kitchen and bedrooms (2026-09-23);
// Pulte's carousels once did the same. Each plan keeps its first picture,
// whatever it is: a condominium's plans may all lead with the building.

import type { NormalizedPlan, GalleryMeta } from "@/lib/floorplans/types";

/** A picture the builder or the sorter has placed: a room, an exterior, the headshot. */
const placed = (meta: GalleryMeta | undefined) =>
  Boolean(meta && (meta.room || meta.kind === "primary" || meta.kind === "exterior"));

/**
 * The plans and homes without the community's pictures. Needs three plans
 * with pictures to tell a community's picture from a plan's; fewer are
 * left as they are. Pure.
 */
export function withoutCommunityPictures(plans: NormalizedPlan[]): NormalizedPlan[] {
  const base = plans.filter((p) => !p.quickMoveIn && p.galleryImages.length > 1);
  if (base.length < 3) return plans;
  const seenOn = new Map<string, number>();
  for (const plan of base) {
    for (const src of new Set(plan.galleryImages)) seenOn.set(src, (seenOn.get(src) ?? 0) + 1);
  }
  const most = Math.max(3, Math.ceil(base.length / 2));
  const shared = new Set([...seenOn].filter(([, n]) => n >= most).map(([src]) => src));
  if (!shared.size) return plans;
  return plans.map((plan) => {
    const communal = (src: string, i: number) => i > 0 && shared.has(src) && !placed(plan.galleryMeta?.[src]);
    if (!plan.galleryImages.some(communal)) return plan;
    const galleryImages = plan.galleryImages.filter((src, i) => !communal(src, i));
    const galleryMeta = plan.galleryMeta
      ? Object.fromEntries(Object.entries(plan.galleryMeta).filter(([src]) => galleryImages.includes(src)))
      : plan.galleryMeta;
    return { ...plan, galleryImages, galleryMeta };
  });
}
