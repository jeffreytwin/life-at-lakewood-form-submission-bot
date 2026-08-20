import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Lead } from "@/lib/supabase/types";

/**
 * Rows the fake client hands back, set per test. `leads` is returned
 * newest-first, matching the real query's ordering; `roster` is the subset of
 * agent IDs that survive the active-roster filter.
 */
const rows: { leads: Partial<Lead>[]; roster: { id: string }[] } = {
  leads: [],
  roster: [],
};

vi.mock("@/lib/supabase/client", () => {
  // Every builder method returns the chain, and the chain is thenable, so it
  // resolves whether the query ends on .limit() or on a trailing .eq().
  const chain = (getData: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "not", "order", "limit"]) {
      c[m] = vi.fn(() => c);
    }
    c.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: getData(), error: null });
    return c;
  };
  return {
    supabase: {
      from: vi.fn((table: string) =>
        chain(() => (table === "leads" ? rows.leads : rows.roster))
      ),
    },
  };
});

import { findAssignedLeadForRecord } from "@/lib/supabase/queries/leads";

const SF_RECORD = "00QUp00000c0GGcMAM";

beforeEach(() => {
  rows.leads = [];
  rows.roster = [];
});

describe("findAssignedLeadForRecord — who counts as an owner", () => {
  it("returns the assignment when the owner is on the active roster", async () => {
    rows.leads = [{ id: "lead-1", final_agent_id: "agent-chris" }];
    rows.roster = [{ id: "agent-chris" }];

    const found = await findAssignedLeadForRecord(SF_RECORD);

    expect(found?.id).toBe("lead-1");
  });

  it("treats an assignment held by a departed agent as unowned", async () => {
    // The agent row still exists but is_active is false, so the roster filter
    // drops it and the lead becomes re-routable.
    rows.leads = [{ id: "lead-1", final_agent_id: "agent-departed" }];
    rows.roster = [];

    expect(await findAssignedLeadForRecord(SF_RECORD)).toBeNull();
  });

  it("treats an assignment held by frontlines as unowned", async () => {
    // The dashboard "Done" button parks a lead on frontlines. That is the
    // pool holding it, not a sales agent, so it stays re-routable.
    rows.leads = [{ id: "lead-1", final_agent_id: "agent-frontlines" }];
    rows.roster = [];

    expect(await findAssignedLeadForRecord(SF_RECORD)).toBeNull();
  });

  it("falls back to an older assignment when the newest owner has left", async () => {
    rows.leads = [
      { id: "lead-newer", final_agent_id: "agent-departed" },
      { id: "lead-older", final_agent_id: "agent-chris" },
    ];
    rows.roster = [{ id: "agent-chris" }];

    const found = await findAssignedLeadForRecord(SF_RECORD);

    expect(found?.id).toBe("lead-older");
  });

  it("returns null when the record has no assignments at all", async () => {
    rows.leads = [];
    rows.roster = [{ id: "agent-chris" }];

    expect(await findAssignedLeadForRecord(SF_RECORD)).toBeNull();
  });
});
