// The order the Floor Plans queue shows its plans in, by the column a
// person clicks (Jeff, 2026-09-26). Pure, so it can be tested on its own.

export type ChangeSortKey = "type" | "plan" | "details" | "where" | "detected";

export interface ChangeSort {
  key: ChangeSortKey;
  dir: "asc" | "desc";
}

/** What each column sorts a plan by. */
export interface ChangeSortFacts {
  kind: "add" | "update" | "remove";
  quickMoveIn: boolean;
  name: string;
  price: number | null;
  site: string;
  community: string;
  builder: string;
  /** When the plan's first change was queued (ISO). */
  detected: string;
}

/** The order a column starts in when first clicked: newest first for when it was found, A to Z and cheapest first otherwise. */
export const FIRST_DIRECTION: Record<ChangeSortKey, ChangeSort["dir"]> = {
  type: "asc",
  plan: "asc",
  details: "asc",
  where: "asc",
  detected: "desc",
};

/** A new plan, then an update, then a removal; floor plans before quick move-ins within each. */
const KIND_ORDER = { add: 0, update: 1, remove: 2 } as const;

const words = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

/** A price from the record's number, or from the price it shows ("$459,990"). */
export function priceOf(price: unknown, shown: unknown): number | null {
  if (typeof price === "number" && Number.isFinite(price) && price > 0) return price;
  const digits = String(shown ?? "").replace(/[^\d.]/g, "");
  const n = digits ? Number(digits) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The plans in the order a column says, or as the queue gave them with no
 * column chosen. A plan with nothing to sort by in that column (no price)
 * goes last whichever way the column runs, and plans that tie keep the
 * queue's order among themselves.
 */
export function sortChanges<G>(groups: G[], sort: ChangeSort | null, facts: (g: G) => ChangeSortFacts): G[] {
  if (!sort) return groups;
  const sign = sort.dir === "asc" ? 1 : -1;
  const compare = (a: ChangeSortFacts, b: ChangeSortFacts): number => {
    switch (sort.key) {
      case "type":
        return sign * (KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Number(a.quickMoveIn) - Number(b.quickMoveIn));
      case "plan":
        return sign * words.compare(a.name, b.name);
      case "details":
        if (a.price == null || b.price == null) return a.price == null ? (b.price == null ? 0 : 1) : -1;
        return sign * (a.price - b.price);
      case "where":
        return sign * (words.compare(a.site, b.site) || words.compare(a.community, b.community) || words.compare(a.builder, b.builder));
      case "detected":
        return sign * a.detected.localeCompare(b.detected);
    }
  };
  return groups
    .map((g, i) => ({ g, i, f: facts(g) }))
    .sort((a, b) => compare(a.f, b.f) || a.i - b.i)
    .map((x) => x.g);
}
