import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Lead, RoutingAttempt } from "@/lib/supabase/types";

vi.mock("@/lib/supabase/queries/leads", () => ({
  getLeadsInAuction: vi.fn(),
}));
vi.mock("@/lib/supabase/queries/routing-attempts", () => ({
  getAttemptsForLeads: vi.fn(),
}));
vi.mock("@/lib/supabase/queries/locations", () => ({
  getLocationName: vi.fn(),
}));
vi.mock("@/lib/supabase/queries/audit-log", () => ({
  logAuditEvent: vi.fn(),
}));
vi.mock("@/lib/routing/state-machine", () => ({
  startRouting: vi.fn(),
}));

import {
  findStrandedLeads,
  recoverStrandedLeads,
} from "@/lib/routing/recover-stranded";
import { getLeadsInAuction } from "@/lib/supabase/queries/leads";
import { getAttemptsForLeads } from "@/lib/supabase/queries/routing-attempts";
import { getLocationName } from "@/lib/supabase/queries/locations";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { startRouting } from "@/lib/routing/state-machine";
import { STRANDED_LEAD_GRACE_MS } from "@/lib/shared/constants";

// The cron tick a few minutes after the real incident: the lead's only
// attempt was resolved at 11:50:16 and the hand-off that should have
// followed never happened.
const NOW = new Date("2026-09-14T11:54:16Z");

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}
const MINUTE = 60_000;

function lead(id: string, overrides: Partial<Lead> = {}): Lead {
  return {
    id,
    routing_status: "routing",
    location_id: "loc-lakewood",
    first_name: "Kari",
    last_name: "Buck",
    final_agent_id: null,
    created_at: ago(8 * MINUTE),
    updated_at: ago(8 * MINUTE),
    ...overrides,
  } as Lead;
}

function attempt(
  leadId: string,
  status: RoutingAttempt["status"],
  overrides: Partial<RoutingAttempt> = {}
): RoutingAttempt {
  return {
    id: `attempt-${leadId}-${status}-${overrides.attempt_number ?? 1}`,
    lead_id: leadId,
    agent_id: "agent-chris",
    attempt_number: 1,
    status,
    expires_at: null,
    twilio_message_sid: null,
    agent_response: null,
    score_snapshot: null,
    created_at: ago(8 * MINUTE),
    updated_at: ago(4 * MINUTE),
    ...overrides,
  } as RoutingAttempt;
}

function inAuction(leads: Lead[], attempts: RoutingAttempt[]) {
  vi.mocked(getLeadsInAuction).mockResolvedValue(leads);
  vi.mocked(getAttemptsForLeads).mockResolvedValue(attempts);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLocationName).mockResolvedValue("Life At Lakewood");
  vi.mocked(startRouting).mockResolvedValue(undefined);
});

describe("findStrandedLeads", () => {
  it("finds a lead whose second timeout was never handed off", async () => {
    const kari = lead("lead-kari");
    const timedOut = attempt("lead-kari", "timed_out", {
      updated_at: ago(4 * MINUTE),
    });
    inAuction([kari], [timedOut]);

    const stranded = await findStrandedLeads(NOW);

    expect(stranded).toHaveLength(1);
    expect(stranded[0].lead.id).toBe("lead-kari");
    expect(stranded[0].lastAttempt.id).toBe(timedOut.id);
    expect(stranded[0].strandedForMs).toBe(4 * MINUTE);
    expect(getAttemptsForLeads).toHaveBeenCalledWith(["lead-kari"]);
  });

  it("leaves a hand-off that resolved seconds ago alone", async () => {
    // A decline came in 20s ago and its escalation may still be running.
    inAuction(
      [lead("lead-fresh")],
      [attempt("lead-fresh", "declined", { updated_at: ago(20_000) })]
    );

    expect(await findStrandedLeads(NOW)).toEqual([]);
  });

  it("treats the grace period as the boundary", async () => {
    inAuction(
      [lead("lead-edge")],
      [attempt("lead-edge", "timed_out", { updated_at: ago(STRANDED_LEAD_GRACE_MS) })]
    );

    expect(await findStrandedLeads(NOW)).toHaveLength(1);
  });

  it("ignores a lead that still has a live attempt", async () => {
    inAuction(
      [lead("lead-live")],
      [
        attempt("lead-live", "timed_out", { updated_at: ago(10 * MINUTE) }),
        attempt("lead-live", "sms_sent", {
          attempt_number: 2,
          created_at: ago(10 * MINUTE),
          expires_at: ago(-MINUTE),
        }),
      ]
    );

    expect(await findStrandedLeads(NOW)).toEqual([]);
  });

  it("never re-auctions a lead whose latest attempt was accepted", async () => {
    // The acceptance's lead-status write failed, so the lead still reads
    // "routing" even though an agent owns it.
    inAuction(
      [lead("lead-owned")],
      [
        attempt("lead-owned", "timed_out", {
          created_at: ago(20 * MINUTE),
          updated_at: ago(16 * MINUTE),
        }),
        attempt("lead-owned", "accepted", {
          attempt_number: 2,
          created_at: ago(15 * MINUTE),
          updated_at: ago(12 * MINUTE),
        }),
      ]
    );

    expect(await findStrandedLeads(NOW)).toEqual([]);
  });

  it("does not touch pending leads that were never offered to anyone", async () => {
    inAuction(
      [lead("lead-parked", { routing_status: "pending", created_at: ago(60 * MINUTE) })],
      []
    );

    expect(await findStrandedLeads(NOW)).toEqual([]);
  });

  it("finds a retried lead whose fresh offer never went out", async () => {
    // Retry reset the lead to pending and then died before creating the new
    // cycle's first attempt. The old cycle's attempts are all resolved.
    const retried = lead("lead-retry", {
      routing_status: "pending",
      created_at: ago(3 * 60 * MINUTE),
      updated_at: ago(10 * MINUTE),
    });
    const oldCycle = [
      attempt("lead-retry", "timed_out", {
        attempt_number: 1,
        created_at: ago(180 * MINUTE),
        updated_at: ago(176 * MINUTE),
      }),
      attempt("lead-retry", "declined", {
        attempt_number: 3,
        created_at: ago(170 * MINUTE),
        updated_at: ago(169 * MINUTE),
      }),
      attempt("lead-retry", "timed_out", {
        attempt_number: 2,
        created_at: ago(175 * MINUTE),
        updated_at: ago(171 * MINUTE),
      }),
    ];
    inAuction([retried], oldCycle);

    const stranded = await findStrandedLeads(NOW);

    expect(stranded).toHaveLength(1);
    expect(stranded[0].lastAttempt.attempt_number).toBe(3);
  });

  it("skips the attempts query when nothing is in the auction", async () => {
    inAuction([], []);

    expect(await findStrandedLeads(NOW)).toEqual([]);
    expect(getAttemptsForLeads).not.toHaveBeenCalled();
  });
});

describe("recoverStrandedLeads", () => {
  it("resumes the auction and records why", async () => {
    const kari = lead("lead-kari");
    const timedOut = attempt("lead-kari", "timed_out", { updated_at: ago(4 * MINUTE) });
    inAuction([kari], [timedOut]);

    const recovered = await recoverStrandedLeads(NOW);

    expect(recovered).toBe(1);
    expect(getLocationName).toHaveBeenCalledWith("loc-lakewood");
    expect(startRouting).toHaveBeenCalledTimes(1);
    expect(startRouting).toHaveBeenCalledWith(kari, "Life At Lakewood");
    expect(logAuditEvent).toHaveBeenCalledWith("error", {
      leadId: "lead-kari",
      routingAttemptId: timedOut.id,
      details: expect.objectContaining({
        reason: "routing_resumed",
        last_attempt_status: "timed_out",
        stranded_for_seconds: 240,
      }),
    });
  });

  it("falls back to the default community when the location is unknown", async () => {
    vi.mocked(getLocationName).mockResolvedValue(null);
    inAuction(
      [lead("lead-noloc", { location_id: null })],
      [attempt("lead-noloc", "timed_out", { updated_at: ago(5 * MINUTE) })]
    );

    await recoverStrandedLeads(NOW);

    expect(startRouting).toHaveBeenCalledWith(
      expect.objectContaining({ id: "lead-noloc" }),
      "Life At Lakewood"
    );
  });

  it("keeps going when one lead fails to resume", async () => {
    inAuction(
      [lead("lead-a"), lead("lead-b")],
      [
        attempt("lead-a", "timed_out", { updated_at: ago(5 * MINUTE) }),
        attempt("lead-b", "declined", { updated_at: ago(5 * MINUTE) }),
      ]
    );
    vi.mocked(startRouting)
      .mockRejectedValueOnce({ message: "Gateway Timeout" })
      .mockResolvedValueOnce(undefined);

    const recovered = await recoverStrandedLeads(NOW);

    expect(recovered).toBe(1);
    expect(startRouting).toHaveBeenCalledTimes(2);
    expect(startRouting).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "lead-b" }),
      "Life At Lakewood"
    );
  });

  it("does nothing when no lead is stranded", async () => {
    inAuction(
      [lead("lead-fresh")],
      [attempt("lead-fresh", "declined", { updated_at: ago(30_000) })]
    );

    expect(await recoverStrandedLeads(NOW)).toBe(0);
    expect(startRouting).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
