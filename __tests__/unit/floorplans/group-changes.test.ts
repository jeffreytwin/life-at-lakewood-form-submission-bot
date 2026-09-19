import { describe, expect, it } from "vitest";
import { groupChanges, groupKeyOf } from "@/lib/floorplans/group-changes";

/**
 * Jeff, 2026-09-19: "Why are there multiple floor plans of the same name in
 * this run?" Because the queue holds one row per changed field. The Hub now
 * shows one row per plan; these are the rules it groups by.
 */
const row = (over: Partial<Parameters<typeof groupKeyOf>[0]> & { id: string }) => ({
  site_id: "s1",
  community_id: "c1",
  builder_id: "b1",
  plan_key: "bianca",
  change_type: "update" as const,
  status: "pending",
  created_at: "2026-09-19T18:10:00Z",
  updated_at: "2026-09-19T18:10:00Z",
  ...over,
});

describe("groupChanges", () => {
  it("folds a plan's field rows into one group, in first-seen order", () => {
    const rows = [
      row({ id: "1" }),
      row({ id: "2", plan_key: "carver" }),
      row({ id: "3" }),
      row({ id: "4" }),
    ];
    const groups = groupChanges(rows);
    expect(groups.map((g) => g.lead.plan_key)).toEqual(["bianca", "carver"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["1", "3", "4"]);
    expect(groups[0].kind).toBe("update");
    expect(groups[0].status).toBe("pending");
  });

  it("keeps the same plan name apart across builders and communities", () => {
    const rows = [row({ id: "1" }), row({ id: "2", builder_id: "b2" }), row({ id: "3", community_id: "c2" })];
    expect(groupChanges(rows)).toHaveLength(3);
  });

  it("leads with the add or remove row, else the newest update", () => {
    const add = groupChanges([row({ id: "1", updated_at: "2026-09-19T19:00:00Z" }), row({ id: "2", change_type: "add" })]);
    expect(add[0].lead.id).toBe("2");
    expect(add[0].kind).toBe("add");
    const upd = groupChanges([row({ id: "1", updated_at: "2026-09-19T18:00:00Z" }), row({ id: "2", updated_at: "2026-09-19T19:00:00Z" })]);
    expect(upd[0].lead.id).toBe("2");
  });

  it("reports a mixed status and the earliest queue time", () => {
    const g = groupChanges([
      row({ id: "1", status: "failed", created_at: "2026-09-19T18:20:00Z" }),
      row({ id: "2", created_at: "2026-09-19T18:10:00Z" }),
    ])[0];
    expect(g.status).toBe("mixed");
    expect(g.createdAt).toBe("2026-09-19T18:10:00Z");
  });
});
