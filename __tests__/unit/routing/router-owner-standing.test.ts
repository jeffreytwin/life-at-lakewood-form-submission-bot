import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, Lead } from "@/lib/supabase/types";

vi.mock("@/lib/supabase/queries/leads", () => ({
  createLead: vi.fn(),
  checkDuplicateLead: vi.fn().mockResolvedValue(false),
  updateLeadStatus: vi.fn(),
  findAssignedLeadForRecord: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/supabase/queries/agents", () => ({
  getFrontlinesAgent: vi.fn(),
  getAgentBySalesforceUserId: vi.fn().mockResolvedValue(null),
  getAgentById: vi.fn(),
  getAgentByName: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/supabase/queries/audit-log", () => ({
  logAuditEvent: vi.fn(),
}));
vi.mock("@/lib/twilio/send-sms", () => ({
  sendOwnedByNotification: vi.fn(),
  sendExistingOwnerNotification: vi.fn(),
  sendUnavailableOwnerNotification: vi.fn(),
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
import {
  getAgentById,
  getAgentBySalesforceUserId,
  getAgentByName,
  getFrontlinesAgent,
} from "@/lib/supabase/queries/agents";
import {
  sendExistingOwnerNotification,
  sendOwnedByNotification,
  sendUnavailableOwnerNotification,
} from "@/lib/twilio/send-sms";
import { startRouting } from "@/lib/routing/state-machine";

const SF_RECORD = "00QUp00000c0GGcMAM";

const frontlines = {
  id: "agent-frontlines",
  name: "Frontlines",
  phone: "+15550000009",
  is_active: true,
  is_frontlines: true,
} as Agent;

const activeAgent = {
  id: "agent-chris",
  name: "Chris Kern",
  phone: "+15550000001",
  is_active: true,
  is_frontlines: false,
} as Agent;

/** Left the company; still in the table, still has a phone on file. */
const departedAgent = {
  id: "agent-kathryn",
  name: "Kathryn W. Plosica",
  phone: "+15550000002",
  is_active: false,
  is_frontlines: false,
} as Agent;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    location: "Life At Lakewood",
    form_name: "Lot Availability (Build)",
    first_name: "Peter",
    last_name: "Matlosz",
    salesforce_record_id: SF_RECORD,
    salesforce_owner_id: "0058b00000G8FKnAAN",
    is_master_agent_owned: true,
    webhook_secret: "secret",
    ...overrides,
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

/** Give the prior-assignment lookup an earlier lead held by `owner`. */
function priorAssignmentBy(owner: Agent) {
  vi.mocked(findAssignedLeadForRecord).mockResolvedValue(
    leadRow({ id: "lead-first", routing_status: "accepted", final_agent_id: owner.id })
  );
  vi.mocked(getAgentById).mockResolvedValue(owner);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkDuplicateLead).mockResolvedValue(false);
  vi.mocked(createLead).mockResolvedValue(leadRow());
  vi.mocked(findAssignedLeadForRecord).mockResolvedValue(null);
  vi.mocked(getFrontlinesAgent).mockResolvedValue(frontlines);
  vi.mocked(getAgentBySalesforceUserId).mockResolvedValue(null);
  vi.mocked(getAgentByName).mockResolvedValue(null);
});

describe("routeLead — an owner who is off the active roster", () => {
  describe("when Salesforce names the owner", () => {
    it("does not auction the lead to anyone else", async () => {
      vi.mocked(getAgentBySalesforceUserId).mockResolvedValue(departedAgent);

      const result = await routeLead(payload({ is_master_agent_owned: false }));

      expect(startRouting).not.toHaveBeenCalled();
      expect(result.status).toBe("unavailable_owner");
    });

    it("leaves it as manual work for frontlines", async () => {
      vi.mocked(getAgentBySalesforceUserId).mockResolvedValue(departedAgent);

      await routeLead(payload({ is_master_agent_owned: false }));

      expect(updateLeadStatus).toHaveBeenCalledWith("lead-new", "manual", departedAgent.id);
      expect(sendUnavailableOwnerNotification).toHaveBeenCalledWith(
        frontlines.phone,
        expect.anything(),
        "Life At Lakewood",
        departedAgent.name
      );
    });

    it("never texts the departed agent on its own", async () => {
      // Reaching a former agent is frontlines' call, made from the dashboard.
      vi.mocked(getAgentBySalesforceUserId).mockResolvedValue(departedAgent);

      await routeLead(payload({ is_master_agent_owned: false }));

      expect(sendExistingOwnerNotification).not.toHaveBeenCalled();
    });

    it("treats an owner it cannot resolve the same way, with no name", async () => {
      // A Salesforce owner who matches nobody in the roster: still owned,
      // still not ours to auction, but there is no one to offer to notify.
      vi.mocked(getAgentBySalesforceUserId).mockResolvedValue(null);

      const result = await routeLead(payload({ is_master_agent_owned: false }));

      expect(result.status).toBe("unavailable_owner");
      expect(startRouting).not.toHaveBeenCalled();
      expect(updateLeadStatus).toHaveBeenCalledWith("lead-new", "manual", undefined);
      expect(sendUnavailableOwnerNotification).toHaveBeenCalledWith(
        frontlines.phone,
        expect.anything(),
        "Life At Lakewood",
        null
      );
    });

    it("still routes normally to an owner who is on the roster", async () => {
      vi.mocked(getAgentBySalesforceUserId).mockResolvedValue(activeAgent);

      const result = await routeLead(payload({ is_master_agent_owned: false }));

      expect(result.status).toBe("owned_by_other");
      expect(sendExistingOwnerNotification).toHaveBeenCalled();
      expect(sendUnavailableOwnerNotification).not.toHaveBeenCalled();
    });
  });

  describe("when the owner comes from our own earlier assignment", () => {
    it("sends a repeat submission to frontlines, not to a new agent", async () => {
      priorAssignmentBy(departedAgent);

      const result = await routeLead(payload());

      expect(startRouting).not.toHaveBeenCalled();
      expect(result.status).toBe("unavailable_owner");
      expect(updateLeadStatus).toHaveBeenCalledWith("lead-new", "manual", departedAgent.id);
      expect(sendExistingOwnerNotification).not.toHaveBeenCalled();
    });

    it("keeps routing to an owner who is still active", async () => {
      priorAssignmentBy(activeAgent);

      const result = await routeLead(payload());

      expect(result.status).toBe("owned_by_other");
      expect(sendExistingOwnerNotification).toHaveBeenCalled();
    });

    it("auctions again when frontlines was holding it", async () => {
      // Frontlines takes a lead via the dashboard "Done" button. That is the
      // pool holding it, not an agent owning the relationship, so a new
      // submission is free to go out to agents.
      priorAssignmentBy(frontlines);

      await routeLead(payload());

      expect(startRouting).toHaveBeenCalled();
      expect(sendUnavailableOwnerNotification).not.toHaveBeenCalled();
      expect(sendOwnedByNotification).not.toHaveBeenCalled();
    });
  });

  describe("when Salesforce marks the owner as offboarded", () => {
    // Offboarding hands the leads to frontlines, so is_master_agent_owned
    // stays true and only the marker says the relationship was someone's.
    const offboarded = { previous_agent_offboarded: "Kathryn W. Plosica" };

    it("does not auction a lead a former agent was working", async () => {
      const result = await routeLead(payload(offboarded));

      expect(startRouting).not.toHaveBeenCalled();
      expect(result.status).toBe("unavailable_owner");
    });

    it("names the former agent to frontlines even when unresolvable", async () => {
      // Nobody by that name is in the roster — frontlines can still act on it.
      vi.mocked(getAgentByName).mockResolvedValue(null);

      await routeLead(payload(offboarded));

      expect(sendUnavailableOwnerNotification).toHaveBeenCalledWith(
        frontlines.phone,
        expect.anything(),
        "Life At Lakewood",
        "Kathryn W. Plosica"
      );
      expect(updateLeadStatus).toHaveBeenCalledWith("lead-new", "manual", undefined);
    });

    it("matches the name against the roster to find the former agent", async () => {
      // Salesforce carries no user ID for them, so the name is the only way
      // to reach a phone number for the dashboard's Notify button.
      vi.mocked(getAgentByName).mockResolvedValue(departedAgent);

      await routeLead(payload(offboarded));

      expect(getAgentByName).toHaveBeenCalledWith("Kathryn W. Plosica");
      expect(updateLeadStatus).toHaveBeenCalledWith("lead-new", "manual", departedAgent.id);
    });

    it("does not record an owner when the marker names someone still active", async () => {
      // The two signals disagree. Trust the marker and send it to frontlines,
      // but don't record an active agent as owner or the next submission
      // would text them as though they had accepted it.
      vi.mocked(getAgentByName).mockResolvedValue(activeAgent);

      const result = await routeLead(payload(offboarded));

      expect(result.status).toBe("unavailable_owner");
      expect(updateLeadStatus).toHaveBeenCalledWith("lead-new", "manual", undefined);
    });

    it("auctions normally when the marker is blank", async () => {
      await routeLead(payload({ previous_agent_offboarded: "" }));

      expect(startRouting).toHaveBeenCalled();
      expect(sendUnavailableOwnerNotification).not.toHaveBeenCalled();
    });

    it("leaves the lead with an active agent who took it after the offboarding", async () => {
      // Chris accepted a submission for this record since the offboarding, so
      // the relationship is his now — the stale marker must not undo that.
      priorAssignmentBy(activeAgent);

      const result = await routeLead(payload(offboarded));

      expect(result.status).toBe("owned_by_other");
      expect(sendExistingOwnerNotification).toHaveBeenCalled();
      expect(sendUnavailableOwnerNotification).not.toHaveBeenCalled();
    });
  });
});
