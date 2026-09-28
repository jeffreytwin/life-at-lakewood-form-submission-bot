// Pictures a plan's page carries that are not the plan's (Jeff, 2026-09-28).
//
// A builder's badge: Ashton Woods puts Newsweek's "Most Trustworthy
// Companies in America" on its plan pages, and Duval (Signature) came
// through with it among the photos. Its file names it
// ("cms_Newsweek_US-Trustworthy_2026_Hor-1.png"), as a logo's does.
//
// Another plan's elevations: Ashton Woods' plan pages end with the
// community's other plans, each a picture named for its plan
// ("cms_Plant-Q-Scheme-128.jpg", "cms_Coquina-A-3-Car-Scheme-102.jpg"),
// and Duval (Signature), a two-story plan, came through with four
// one-story homes after its own.
//
// A page's banner: Homes by Towne keeps the slides drawn across the top of
// a community's page in a folder of their own (".../uploads/hero/florida/
// palmera-at-wellen-park/...-tideland-lot281-model-1-1920.jpg"), wide crops
// of photos its plans' galleries also carry at their own shape
// (".../uploads/gallery/...-model-1-900.jpg"). Named for the model they
// show, four came through as new photos of Palmera's Tideland and
// Outrigger (Jeff, 2026-09-28: "they're really widescreen … I don't need
// these"). No IO.

import type { NormalizedPlan } from "@/lib/floorplans/types";

/** Builders whose plan pages show the community's other plans, each picture named for its own. */
export const NAMED_PICTURE_BUILDERS = new Set(["Ashton Woods"]);

/** A file name that is a badge or a logo, never a home. */
const BADGE = /newsweek|trustworthy|\baward|badge|\blogo\b|_logo|-logo/i;

/** The words of a picture's file name: "cms_Plant-Q-Scheme-128.jpg" is cms, plant, q, scheme, 128, jpg. */
function fileWords(url: string): string[] {
  let path = url.replace(/[?#].*$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // left as written
  }
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** A plan's name as words, without the series a page added to it: "Duval (Signature)" is duval. */
const nameWords = (name: string) =>
  name.replace(/\s*\([^()]*\)\s*$/, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && w !== "the" && w !== "plan");

/** Whether every word of a name is in the file's words. */
const names = (words: string[], file: string[]) => words.length > 0 && words.every((w) => file.includes(w));

/** Whether a picture is a badge or a logo. Pure; exported for tests. */
export function isBadge(url: string): boolean {
  return BADGE.test(fileWords(url).join("-"));
}

function withGallery(plan: NormalizedPlan, keep: (src: string, i: number) => boolean): NormalizedPlan {
  if (plan.galleryImages.every(keep)) return plan;
  const galleryImages = plan.galleryImages.filter(keep);
  const galleryMeta = plan.galleryMeta
    ? Object.fromEntries(Object.entries(plan.galleryMeta).filter(([src]) => galleryImages.includes(src)))
    : plan.galleryMeta;
  return { ...plan, galleryImages, galleryMeta };
}

/** The plans and homes without a badge among their photos. Pure; exported for tests. */
export function withoutBadges(plans: NormalizedPlan[]): NormalizedPlan[] {
  return plans.map((plan) => withGallery(plan, (src) => !isBadge(src)));
}

/** A folder a site keeps its page banners in: ".../uploads/hero/...", ".../banners/...". */
const BANNER_FOLDER = /\/(?:hero|heroes|banners?)\//i;

/** Whether a picture is kept among a site's page banners. Pure; exported for tests. */
export function isBanner(url: string): boolean {
  return BANNER_FOLDER.test(url.replace(/[?#].*$/, ""));
}

/**
 * The plans and homes without a page's banners among their photos, where
 * they have a photo of their own to show instead; a plan that has only a
 * banner keeps it. Pure; exported for tests.
 */
export function withoutBanners(plans: NormalizedPlan[]): NormalizedPlan[] {
  return plans.map((plan) => (plan.galleryImages.every(isBanner) ? plan : withGallery(plan, (src) => !isBanner(src))));
}

/**
 * Each base plan without the pictures named for another plan of the run
 * and not for itself. A plan whose name holds another's ("Bahia with
 * Bonus" and "Bahia") is not the other plan's, and its pictures stay; a
 * plan's first picture stays whatever it is named. Homes are left as
 * they are. Pure; exported for tests.
 */
export function withoutOtherPlansPictures(plans: NormalizedPlan[]): NormalizedPlan[] {
  const named = plans.filter((p) => !p.quickMoveIn).map((p) => ({ key: p.planKey, words: nameWords(p.name) }));
  return plans.map((plan) => {
    if (plan.quickMoveIn) return plan;
    const own = nameWords(plan.name);
    const others = named.filter((o) => o.key !== plan.planKey && o.words.length && !names(o.words, own) && !names(own, o.words));
    if (!others.length) return plan;
    return withGallery(plan, (src, i) => {
      if (i === 0) return true;
      const file = fileWords(src);
      return names(own, file) || !others.some((o) => names(o.words, file));
    });
  });
}
