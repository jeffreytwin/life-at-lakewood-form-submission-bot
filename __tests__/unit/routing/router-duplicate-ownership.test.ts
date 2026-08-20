import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, Lead } from "@/lib/supabase/types";

vi.mock("@/lib/supabase/queries/leads", () => ({
  createLead: vi.fn(),
  checkDuplicateLead: vi.fn().mockResolvedValue(false),
  updateLeadStatus: vi.fn(),
  findAssignedLeadForRecord: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/supabase/queries/agents", () => ({
  getFrontlinesAgent: vi.fn().mockResolvedValue({ id: "agent-frontlines", name: "Frontlines", phone: "+15550000009" }),
  getAgentBySalesforceUserId: vi.fn().mockResolvedValue(null),
  getAgentById: vi.fn(),
}));
vi.mock("@/lib/supabase/queries/audit-log", () => ({
  logAuditEvent: vi.fn(),
}));
vi.mock("@/lib/twilio/send-sms", () => ({
  sendOwnedByNotification: vi.fn(),
  sendExistingOwnerNotification: vi.fn(),
}));
vi.mock("@/lib/routing/quiet-hours", () => ({
  getQuietHoursSettings: vi.fn().mockResolvedValue({ quiet_hours_enabled: false }),
  isInQuietHours: vi.fn().mockReturnValue(false),
  getEffectiveQuietHoursEnd: vi.fn().mockReturnValue("08:00"),
}));
vi.mock("@/lib/routing/state-machine", () => ({
  startRouting: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "insert", "update", "in", "order", "limit"]) {
      c[m] = vi.fn().mockReturnValue(c);
    }
    c.single = vi.fn().mockResolvedValue({
      // Serves both the locations lookup and system_settings lookup.
      data: { id: "loc-1", name: "Life At Lakewood", routing_enabled: true },
      error: null,
    });
    c.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    return c;
  };
  return { supabase: { from: vi.fn(() => chain()) } };
});

import { routeLead } from "@/lib/routing/router";
import {
  createLead,
  checkDuplicateLead,
  updateLeadStatus,
  findAssignedLeadForRecord,
} from "@/lib/supabase/queries/leads";
import { getAgentById, getFrontlinesAgent } from "@/lib/supabase/queries/agents";
import {
  sendExistingOwnerNotification,
  sendOwnedByNotification,
} from "@/lib/twilio/send-sms";
import { startRouting } from "@/lib/routing/state-machine";

const SF_RECORD = "00QUp00000c0GGcMAM";

const frontlines: Agent = {
  id: "agent-frontlines",
  name: "Frontlines",
  phone: "+15550000009",
} as Agent;

const chrisKern: Agent = {
  id: "agent-chris",
  name: "Chris Kern",
  phone: "+15550000001",
} as Agent;

function payload(formName: string) {
  return {
    location: "Life At Lakewood",
    form_name: formName,
    first_name: "Peter",
    last_name: "Matlosz",
    email: "petermatlosz@yahoo.com",
    salesforce_record_id: SF_RECORD,
    salesforce_owner_id: "0058b00000G8FKnAAN",
    is_master_agent_owned: true,
    webhook_secret: "secret",
  } as never;
}

function leadRow(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-new",
    salesforce_record_id: SF_RECORD,
    location_id: "loc-1",
    first_name: "Peter",
    last_name: "Matlosz",
    salesforce_owner_id: "0058b00000G8FKnAAN",
    routing_status: "pending",
    final_agent_id: null,
    ...overrides,
  } as Lead;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkDuplicateLead).mockResolvedValue(false);
  vi.mocked(createLead).mockResolvedValue(leadRow());
  vi.mocked(findAssignedLeadForRecord).mockResolvedValue(null);
  vi.mocked(getAgentById).mockResolvedValue(chrisKern);
  vi.mocked(getFrontlinesAgent).mockResolvedValue(frontlines);
});

describe("routeLead — repeat submissions for an already-assigned lead", () => {
  it("does not re-auction a record this bot already assigned", async () => {
    // Chris accepted the first submission moments ago. Salesforce has not
    // caught up, so this second form still arrives master-agent-owned.
    vi.mocked(findAssignedLeadForRecord).mockResolvedValue(
      leadRow({ id: "lead-first", routing_status: "accepted", final_agent_id: "agent-chris" })
    );

    const result = await routeLead(payload("Lot Availability (Build)"));

    expect(startRouting).not.toHaveBeenCalled();
    expect(result.status).toBe("owned_by_other");
  });

  it("notifies the existing owner and frontlines instead", async () => {
    vi.mocked(findAssignedLeadForRecord).mockResolvedValue(
      leadRow({ id: "lead-first", routing_status: "accepted", final_agent_id: "agent-chris" })
    );

    await routeLead(payload("Lot Availability (Build)"));

    expect(sendExistingOwnerNotification).toHaveBeenCalledWith(
      chrisKern.phone,
      expect.anything(),
      "Life At Lakewood"
    );
    expect(sendOwnedByNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "Life At Lakewood",
      "Chris Kern"
    );
  });

  it("assigns the repeat submission to the same owning agent", async () => {
    vi.mocked(findAssignedLeadForRecord).mockResolvedValue(
      leadRow({ id: "lead-first", routing_status: "accepted", final_agent_id: "agent-chris" })
    );

    await routeLead(payload("Lot Availability (Build)"));

    expect(updateLeadStatus).toHaveBeenCalledWith("lead-new", "owned_by_other", "agent-chris");
  });

  it("still routes normally when no prior assignment exists", async () => {
    const result = await routeLead(payload("Join the Interest List (Build)"));

    expect(startRouting).toHaveBeenCalled();
    expect(result.status).toBe("routing");
  });

  it("keeps the owner when Salesforce later marked the lead bad_data", async () => {
    // The bad_data webhook flips routing_status without clearing
    // final_agent_id, so the agent who accepted still owns the person.
    vi.mocked(findAssignedLeadForRecord).mockResolvedValue(
      leadRow({ id: "lead-first", routing_status: "bad_data", final_agent_id: "agent-chris" })
    );

    const result = await routeLead(payload("Lot Availability (Build)"));

    expect(startRouting).not.toHaveBeenCalled();
    expect(result.status).toBe("owned_by_other");
    expect(updateLeadStatus).toHaveBeenCalledWith("lead-new", "owned_by_other", "agent-chris");
  });

  it("routes to the Salesforce owner without consulting prior leads", async () => {
    // Salesforce naming an owner wins outright — this path runs before the
    // prior-assignment lookup, whatever the earlier leads look like.
    const result = await routeLead({
      ...(payload("Lot Availability (Build)") as object),
      is_master_agent_owned: false,
    } as never);

    expect(findAssignedLeadForRecord).not.toHaveBeenCalled();
    expect(startRouting).not.toHaveBeenCalled();
    expect(result.status).toBe("owned_by_other");
  });

  it("re-routes a record whose prior lead ended unowned", async () => {
    // manual / failed leads carry no final_agent_id, so a fresh submission
    // is a legitimate re-route rather than a second auction.
    vi.mocked(findAssignedLeadForRecord).mockResolvedValue(null);

    const result = await routeLead(payload("Join the Interest List (Build)"));

    expect(startRouting).toHaveBeenCalled();
    expect(result.status).toBe("routing");
  });

  it("treats a lost insert race as a duplicate rather than erroring", async () => {
    vi.mocked(createLead).mockRejectedValue({ code: "23505" });

    const result = await routeLead(payload("Lot Availability (Build)"));

    expect(result.status).toBe("duplicate");
    expect(startRouting).not.toHaveBeenCalled();
  });

  it("suppresses an in-flight duplicate before creating a lead", async () => {
    vi.mocked(checkDuplicateLead).mockResolvedValue(true);

    const result = await routeLead(payload("Lot Availability (Build)"));

    expect(createLead).not.toHaveBeenCalled();
    expect(result.status).toBe("duplicate");
  });
});
