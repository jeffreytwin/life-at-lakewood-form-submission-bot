import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// The two tables the approval worker touches, in memory, behind as much of
// the Supabase query builder as approvals.ts uses.
const db: Record<string, Row[]> = { fp_pending_changes: [], system_settings: [] };

function matches(row: Row, filters: ((r: Row) => boolean)[]) {
  return filters.every((f) => f(row));
}

/** One PostgREST condition of an or() string: "column.op.value". */
function condition(text: string): (r: Row) => boolean {
  const [column, op, ...rest] = text.split(".");
  const value = rest.join(".");
  if (op === "is" && value === "null") return (r) => r[column] == null;
  if (op === "lt") return (r) => r[column] != null && String(r[column]) < value;
  if (op === "lte") return (r) => r[column] != null && String(r[column]) <= value;
  throw new Error(`unsupported or() condition ${text}`);
}

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  let limit = Infinity;
  let update: Row | null = null;
  let one = false;
  const builder = {
    select: () => builder,
    update: (values: Row) => {
      update = values;
      return builder;
    },
    eq: (column: string, value: unknown) => (filters.push((r) => r[column] === value), builder),
    in: (column: string, values: unknown[]) => (filters.push((r) => values.includes(r[column])), builder),
    lt: (column: string, value: string) => (filters.push((r) => r[column] != null && String(r[column]) < value), builder),
    not: (column: string, op: string, value: unknown) => {
      if (op !== "is" || value !== null) throw new Error("unsupported not()");
      filters.push((r) => r[column] != null);
      return builder;
    },
    match: (values: Row) => (filters.push((r) => Object.entries(values).every(([k, v]) => r[k] === v)), builder),
    or: (text: string) => {
      const any = text.split(",").map(condition);
      filters.push((r) => any.some((c) => c(r)));
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
      orders.push({ column, ascending: options?.ascending ?? true, nullsFirst: options?.nullsFirst ?? false });
      return builder;
    },
    limit: (n: number) => ((limit = n), builder),
    single: () => ((one = true), builder),
    then: (resolve: (v: unknown) => unknown) => {
      const rows = db[table].filter((r) => matches(r, filters));
      if (update) {
        for (const r of rows) Object.assign(r, update);
        return resolve({ data: rows.map((r) => ({ ...r })), error: null });
      }
      rows.sort((a, b) => {
        for (const o of orders) {
          const x = a[o.column] as string | null;
          const y = b[o.column] as string | null;
          if (x === y) continue;
          if (x == null) return o.nullsFirst ? -1 : 1;
          if (y == null) return o.nullsFirst ? 1 : -1;
          return (x < y ? -1 : 1) * (o.ascending ? 1 : -1);
        }
        return 0;
      });
      const data = rows.slice(0, limit).map((r) => ({ ...r }));
      return resolve({ data: one ? data[0] ?? null : data, error: null });
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/client", () => ({ supabase: { from: (table: string) => query(table) } }));

// What Wix does with each plan's write, by plan key; written unless said.
let wix: Record<string, "throttled" | "fetching" | "failed"> = {};
const written: string[] = [];
vi.mock("@/lib/floorplans/writeback", () => ({
  STILL_FETCHING_RETRY_MS: 60_000,
  applyPendingChange: vi.fn(async (id: string) => {
    const row = db.fp_pending_changes.find((r) => r.id === id)!;
    if (row.status !== "approved") return { status: String(row.status), error: "change is not approved" };
    const says = wix[row.plan_key as string];
    if (says === "throttled") return { status: "deferred", throttled: true };
    if (says === "fetching") return { status: "deferred", fetching: true };
    written.push(row.plan_key as string);
    row.status = says === "failed" ? "failed" : "synced";
    row.wix_record_id = says === "failed" ? null : `wix-${row.plan_key}`;
    return { status: row.status };
  }),
}));
vi.mock("@/lib/wix/client", () => ({ wixThrottleWaitMs: () => 30_000 }));
vi.mock("@/lib/floorplans/approval", () => ({
  approvalBlocker: (_type: string, record: { blocked?: string } | null) => record?.blocked ?? null,
}));

import { drainApprovals, INTERRUPTED_MS, queueApprovals } from "@/lib/floorplans/approvals";

let seq = 0;
/** One queued row: one changed field of one plan. */
function change(plan_key: string, extra: Row = {}): Row {
  seq += 1;
  return {
    id: `${plan_key}-${seq}`,
    site_id: "s1",
    community_id: "c1",
    builder_id: "b1",
    plan_key,
    change_type: "update",
    field_changed: `field-${seq}`,
    status: "pending",
    created_at: new Date(Date.UTC(2026, 9, 10, 12, 0, seq)).toISOString(),
    updated_at: null,
    proposed_record: { name: plan_key },
    approval_requested_at: null,
    approve_after: null,
    ...extra,
  };
}
const rowsOf = (plan: string) => db.fp_pending_changes.filter((r) => r.plan_key === plan);
const statusOf = (plan: string) => [...new Set(rowsOf(plan).map((r) => r.status))];
const lock = () => db.system_settings[0].fp_approve_lock_until as string | null;

/**
 * Jeff, 2026-10-10: Approve All should be over for the person the moment
 * they click, and the server should finish the run itself. These are the
 * rules the worker keeps to do that without dropping or doubling a plan.
 */
describe("the approval queue", () => {
  beforeEach(() => {
    db.fp_pending_changes = [];
    db.system_settings = [{ id: 1, fp_approve_lock_until: null }];
    wix = {};
    written.length = 0;
  });

  it("hands every row of an approvable plan to the worker, and leaves a blocked one pending", async () => {
    db.fp_pending_changes.push(change("aria"), change("aria"), change("bella", { proposed_record: { blocked: "needs a score" } }));
    const { queued, blocked } = await queueApprovals(db.fp_pending_changes.map((r) => r.id as string));
    expect(queued.sort()).toEqual(rowsOf("aria").map((r) => r.id).sort());
    expect(statusOf("aria")).toEqual(["approving"]);
    expect(rowsOf("aria").every((r) => r.approval_requested_at)).toBe(true);
    expect(blocked).toEqual([{ planKey: "bella", rows: 1, status: "blocked", error: "needs a score" }]);
    expect(statusOf("bella")).toEqual(["pending"]);
  });

  it("never takes a row that is no longer pending", async () => {
    db.fp_pending_changes.push(change("aria", { status: "rejected" }));
    expect(await queueApprovals([db.fp_pending_changes[0].id as string])).toEqual({ queued: [], blocked: [] });
    expect(statusOf("aria")).toEqual(["rejected"]);
  });

  it("writes each plan once, in the order asked, and gives all its rows the outcome", async () => {
    db.fp_pending_changes.push(change("aria"), change("aria"), change("bella"), change("cora"));
    await queueApprovals(rowsOf("cora").map((r) => r.id as string));
    await new Promise((r) => setTimeout(r, 2));
    await queueApprovals([...rowsOf("aria"), ...rowsOf("bella")].map((r) => r.id as string));
    wix = { bella: "failed" };
    expect(await drainApprovals()).toEqual({ written: 2, failed: 1, waiting: 0 });
    expect(written).toEqual(["cora", "aria", "bella"]);
    expect(statusOf("aria")).toEqual(["synced"]);
    expect(rowsOf("aria").every((r) => r.wix_record_id === "wix-aria")).toBe(true);
    expect(statusOf("bella")).toEqual(["failed"]);
    expect(lock()).toBeNull();
  });

  it("stops when Wix asks for a wait, keeps the plan first in line, and holds the lock until then", async () => {
    db.fp_pending_changes.push(change("aria"), change("bella"));
    await queueApprovals(db.fp_pending_changes.map((r) => r.id as string));
    wix = { aria: "throttled" };
    const before = Date.now();
    expect(await drainApprovals()).toEqual({ written: 0, failed: 0, waiting: 1 });
    expect(statusOf("aria")).toEqual(["approving"]);
    expect(rowsOf("aria")[0].approve_after).toBeNull();
    expect(statusOf("bella")).toEqual(["approving"]);
    expect(Date.parse(lock()!)).toBeGreaterThanOrEqual(before + 30_000);
    // The next worker leaves it until Wix's wait is over.
    wix = {};
    expect((await drainApprovals()).skipped).toBeTruthy();
    expect(written).toEqual([]);
    db.system_settings[0].fp_approve_lock_until = new Date(Date.now() - 1).toISOString();
    expect(await drainApprovals()).toEqual({ written: 2, failed: 0, waiting: 0 });
  });

  it("lets a plan whose pictures Wix is still fetching wait a minute, and writes the rest", async () => {
    db.fp_pending_changes.push(change("aria"), change("bella"));
    await queueApprovals(db.fp_pending_changes.map((r) => r.id as string));
    wix = { aria: "fetching" };
    expect(await drainApprovals()).toEqual({ written: 1, failed: 0, waiting: 1 });
    expect(statusOf("aria")).toEqual(["approving"]);
    expect(Date.parse(rowsOf("aria")[0].approve_after as string)).toBeGreaterThan(Date.now() + 50_000);
    expect(statusOf("bella")).toEqual(["synced"]);
    // Not tried again before its minute is up.
    expect(await drainApprovals()).toEqual({ written: 0, failed: 0, waiting: 0 });
    expect(lock()).toBeNull();
  });

  it("writes nothing while another worker holds the lock", async () => {
    db.fp_pending_changes.push(change("aria"));
    await queueApprovals([db.fp_pending_changes[0].id as string]);
    db.system_settings[0].fp_approve_lock_until = new Date(Date.now() + 60_000).toISOString();
    expect((await drainApprovals()).skipped).toBeTruthy();
    expect(statusOf("aria")).toEqual(["approving"]);
  });

  it("takes no lock when nothing is waiting", async () => {
    db.fp_pending_changes.push(change("aria"));
    expect(await drainApprovals()).toEqual({ written: 0, failed: 0, waiting: 0 });
    expect(lock()).toBeNull();
    expect(statusOf("aria")).toEqual(["pending"]);
  });

  it("finishes a plan a cut-off worker had claimed, but not one approved without a review", async () => {
    const old = new Date(Date.now() - INTERRUPTED_MS - 1000).toISOString();
    db.fp_pending_changes.push(
      change("aria", { status: "approved", approval_requested_at: old, updated_at: old }),
      change("auto", { status: "approved", updated_at: old }),
      change("busy", { status: "approved", approval_requested_at: old, updated_at: new Date().toISOString() })
    );
    expect(await drainApprovals()).toEqual({ written: 1, failed: 0, waiting: 0 });
    expect(statusOf("aria")).toEqual(["synced"]);
    expect(statusOf("auto")).toEqual(["approved"]);
    expect(statusOf("busy")).toEqual(["approved"]);
  });

  it("writes a plan approved before the queue knew when it was asked for", async () => {
    db.fp_pending_changes.push(change("aria", { status: "approving" }));
    expect(await drainApprovals()).toEqual({ written: 1, failed: 0, waiting: 0 });
    expect(statusOf("aria")).toEqual(["synced"]);
  });
});
