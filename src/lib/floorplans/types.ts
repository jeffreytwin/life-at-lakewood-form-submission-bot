/**
 * Where a gallery image sits in the order the sites show a plan's photos
 * (Jeff, 2026-09-18): the primary picture, then kitchen, living room,
 * dining room, pool and lanai, office, hallways, stairs, then anything with
 * a loft (right after the stairs, Jeff, 2026-09-19), bedrooms, bathrooms,
 * laundry, closets, anything unplaced, and the extra exterior options last.
 */
export const ROOM_ORDER = [
  "primary",
  "kitchen",
  "living",
  "dining",
  "outdoor",
  "office",
  "hallway",
  "stairs",
  "loft",
  "bedroom",
  "bathroom",
  "laundry",
  "closet",
  "other",
  "exterior",
] as const;
export type Room = (typeof ROOM_ORDER)[number];

/** What is known about one gallery image beyond its URL. */
export interface GalleryMeta {
  /** The builder's caption or title for the photo, when it gave one. */
  caption?: string | null;
  /** The room the photo shows, when known: named by the builder or read off the caption. Null when nothing said. */
  room?: Room | null;
  /** Where the image came from: the builder's headshot, a showcase photo, or an alternative exterior design. */
  kind?: "primary" | "photo" | "exterior";
}

// Canonical normalized plan shape produced by every extractor engine.
export type RelatedPlanMatch = "extractor" | "plan-id" | "plan-name" | "unmatched";

export interface NormalizedPlan {
  planKey: string;
  name: string;
  price: number | null;
  priceDisplay: string | null;
  beds: string;
  baths: string;
  sqft: number | null;
  garages: string | null;
  homeType: string | null;
  quickMoveIn: boolean;
  comingSoon: boolean;
  sourceUrl: string | null;
  /** Ordered photo gallery; position 0 is the main image. */
  galleryImages: string[];
  /** Ordered blueprint/floor-plan drawings, kept separate from photos. */
  blueprintImages: string[];
  /** Caption, room and origin of each gallery image, keyed by URL. */
  galleryMeta?: Record<string, GalleryMeta>;
  /** The builder's own description of the plan, when the page gives one. */
  description?: string | null;
  /** Virtual tour link: a Matterport share link, an InsideMaps walkthrough, whatever the builder offers. */
  virtualTourUrl?: string | null;
  /** A still for the virtual tour button, when the builder gives one. */
  virtualTourImage?: string | null;
  /**
   * Quick move-ins only: the base plan this home is built from, as the site
   * files it (Wellen Park and Parrish keep the base plan's name on the
   * quick move-in row, relatedFloorPlanQuickMoveInOnly). planKey is the
   * base plan's key in the same run; name is what the row carries.
   */
  relatedPlanKey?: string | null;
  relatedPlanName?: string | null;
  /** How the base plan was found: by the engine, the builder's plan id, the plan name, or not at all. */
  relatedPlanMatch?: RelatedPlanMatch;
  /** Base plans only: at least one quick move-in of this plan is on offer in this community. */
  hasQuickMoveIns?: boolean;
  userEditedFields?: string[];
  raw?: Record<string, unknown>;
}

export const normKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
