// Canonical normalized plan shape produced by every extractor engine.
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
  userEditedFields?: string[];
  raw?: Record<string, unknown>;
}

export const normKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
