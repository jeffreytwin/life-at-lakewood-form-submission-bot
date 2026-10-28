// The to-do list each Community Alert carries (Jeff, 2026-10-17). An alert
// is a job for the frontlines person, not a notice: once every item is
// done or marked not applicable they mark it complete, or they dismiss it
// with a reason. It never closes on its own.
//
// The wording lives here and only the item keys are stored, so rewording
// an item reaches every alert, open or closed. Pure.

export type AlertKind = "sold_out" | "new_neighborhood" | "announcement";

export interface ChecklistChoice {
  value: string;
  label: string;
}

export interface ChecklistItem {
  key: string;
  label: string;
  hint?: string;
  /** The Hub checks this one for itself while the alert is open; a person can still check it by hand. */
  auto?: boolean;
  /** Answers to pick from; picking one completes the item. */
  choices?: ChecklistChoice[];
}

/** What an item's row says was done about it. */
export interface ItemState {
  item_key: string;
  done_at: string | null;
  by_hand: boolean;
  not_applicable: boolean;
  choice: string | null;
  note: string | null;
}

/** Facts about the alert that change what its items say. */
export interface ChecklistContext {
  /** The neighborhood is on Life At Lakewood, whose pages are sometimes built one by one rather than from the dynamic page. */
  legacySite: boolean;
}

export const LEGACY_DOMAIN = "lifeatlakewood.com";

const LEGACY_PAGES =
  "Life At Lakewood's neighborhood pages are sometimes built one by one: if this one is, edit the page itself in the Wix editor.";

/**
 * A sold-out neighborhood: its new-build inventory reached zero, so the
 * website has to stop selling new builds there and start showing the
 * homes for sale. Both landing pages: the neighborhood page, which leads
 * with what the neighborhood is like, and the homes-for-sale page, which
 * leads with the inventory.
 */
export function soldOutItems(ctx: ChecklistContext): ChecklistItem[] {
  const pageHint = ctx.legacySite ? LEGACY_PAGES : undefined;
  return [
    {
      key: "confirm",
      label: "Confirm it's sold out: the builder's pages list no homes",
      hint: "The builder pages are linked above. If one still lists homes, the reading went wrong: dismiss this alert and check Floor Plans → Builder Connections.",
    },
    {
      key: "landing_language",
      label: "Landing page language no longer sells new builds (neighborhood page and homes-for-sale page)",
      hint: pageHint,
    },
    {
      key: "landing_images",
      label: "Landing page images no longer new-build specific (both pages)",
      hint: pageHint,
    },
    {
      key: "new_build_section",
      label: "The new-build section collapses, or is gone, on both pages",
      hint: pageHint,
    },
    {
      key: "listings_engine",
      label: "Set up in the listings engine with search terms",
      hint: "Listings → Neighborhoods. Checks itself once the neighborhood is there with a search term.",
      auto: true,
    },
    {
      key: "listings_section",
      label: "Both landing pages have a listings section ready to populate",
      hint: pageHint,
    },
    { key: "ad_language", label: "Advertising language is no longer new-build specific" },
    { key: "ad_images", label: "Advertising images are no longer new-build specific" },
    {
      key: "connections",
      label: "The builder connections: retire them, or keep them running to catch a new phase",
      hint: "Retiring is Floor Plans → Builder Connections → Remove. Checks itself once no connection is left running.",
      auto: true,
      choices: [
        { value: "retire", label: "Retire" },
        { value: "keep", label: "Keep running for a new phase" },
      ],
    },
  ];
}

/**
 * A neighborhood with homes for sale in a place we cover that is in
 * neither engine yet. Adding it to the engines is left to the person on
 * purpose: they choose the listings search terms, and set the new-build
 * connection up with Claude. The Hub ticks those two once it sees them.
 */
export function newNeighborhoodItems(ctx: ChecklistContext): ChecklistItem[] {
  const pageHint = ctx.legacySite ? LEGACY_PAGES : undefined;
  return [
    {
      key: "pages",
      label: "Neighborhood page and homes-for-sale page created on the website",
      hint: pageHint,
    },
    {
      key: "landing_content",
      label: "Landing page language and images",
      hint: pageHint,
    },
    {
      key: "listings_engine",
      label: "Added to the listings engine with search terms",
      hint: "Listings → Neighborhoods, with whatever terms you want. Checks itself once the neighborhood is there with a search term.",
      auto: true,
    },
    {
      key: "new_build_engine",
      label: "Added to the new-build engine with a builder connection",
      hint: "Set the connection up with Claude. Checks itself once the community has a connection running.",
      auto: true,
    },
    { key: "advertising", label: "Advertising set up" },
    { key: "live_check", label: "Listings and new builds are showing on the live pages" },
  ];
}

export function checklistFor(kind: AlertKind, ctx: ChecklistContext): ChecklistItem[] {
  switch (kind) {
    case "sold_out":
      return soldOutItems(ctx);
    case "new_neighborhood":
      return newNeighborhoodItems(ctx);
    // An announcement asks for a decision, not a list: watch it, ignore it
    // or dismiss it (watch-list.ts).
    case "announcement":
      return [];
  }
}

/** Done, or marked not applicable. */
export function isSettled(state: Pick<ItemState, "done_at" | "not_applicable"> | undefined): boolean {
  return Boolean(state && (state.done_at || state.not_applicable));
}

/** How far along an alert's list is; complete when every item is settled. */
export function progressOf(items: ChecklistItem[], states: Pick<ItemState, "item_key" | "done_at" | "not_applicable">[]) {
  const byKey = new Map(states.map((s) => [s.item_key, s]));
  const settled = items.filter((i) => isSettled(byKey.get(i.key))).length;
  return { settled, total: items.length, complete: items.length > 0 && settled === items.length };
}
