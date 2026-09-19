// Grouping queued changes by plan for the review queue. The sync core queues
// one row per changed field, so that a rejection can stick to one exact
// change and a re-run can update one row in place. A person reviews plans,
// not fields (Jeff, 2026-09-19: "why are there multiple floor plans of the
// same name?"), so the Hub shows one row per plan with every field change
// listed, and approves or rejects the plan's rows together.

export interface GroupableChange {
  id: string;
  site_id: string;
  community_id: string;
  builder_id: string;
  plan_key: string;
  change_type: "add" | "update" | "remove";
  status: string;
  created_at: string;
  updated_at?: string | null;
}

export interface ChangeGroup<T extends GroupableChange> {
  key: string;
  rows: T[];
  /** The row whose proposed record the group shows: the add or remove row when there is one, else the newest update. */
  lead: T;
  kind: "add" | "update" | "remove";
  /** The rows' shared status, or "mixed" when they differ. */
  status: string;
  /** When the earliest of the rows was queued. */
  createdAt: string;
}

/** One plan in one community for one builder on one site. */
export const groupKeyOf = (c: GroupableChange): string =>
  `${c.site_id}|${c.community_id}|${c.builder_id}|${c.plan_key}`;

export function groupChanges<T extends GroupableChange>(changes: T[]): ChangeGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const c of changes) {
    const key = groupKeyOf(c);
    const rows = byKey.get(key);
    if (rows) rows.push(c);
    else byKey.set(key, [c]);
  }
  return [...byKey.entries()].map(([key, rows]) => {
    const structural = rows.find((r) => r.change_type === "add") ?? rows.find((r) => r.change_type === "remove");
    const newest = [...rows].sort((a, b) =>
      (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at)
    )[0];
    const lead = structural ?? newest;
    const statuses = new Set(rows.map((r) => r.status));
    return {
      key,
      rows,
      lead,
      kind: lead.change_type,
      status: statuses.size === 1 ? rows[0].status : "mixed",
      createdAt: rows.map((r) => r.created_at).sort()[0],
    };
  });
}
