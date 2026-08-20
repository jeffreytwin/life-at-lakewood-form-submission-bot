import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleAcceptance,
  handleDecline,
  handleFirstTimeout,
  handleSecondTimeout,
} from "@/lib/routing/state-machine";
import type { Agent, Lead, RoutingAttempt } from "@/lib/supabase/types";

vi.mock("@/lib/supabase/queries/routing-attempts", () => ({
  claimRoutingAttemptTransition: vi.fn(),
  createRoutingAttempt: vi.fn(),
  getMaxAttemptNumber: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/lib/supabase/queries/leads", () => ({
  updateLeadStatus: vi.fn(),
}));
vi.mock("@/lib/supabase/queries/agents", () => ({
  getAgentById: vi.fn(),
  getFrontlinesAgent: vi.fn().mockResolvedValue(null),
  updateAgent: vi.fn(),
}));
vi.mock("@/lib/supabase/queries/audit-log", () => ({
  logAuditEvent: vi.fn(),
}));
vi.mock("@/lib/zapier/notify-acceptance", () => ({
  notifyAcceptance: vi.fn(),
}));
vi.mock("@/lib/twilio/send-sms", () => ({
  sendLeadNotification: vi.fn().mockResolvedValue("SM_test"),
  sendFollowUp: vi.fn().mockResolvedValue("SM_followup"),
  sendMovedOn: vi.fn(),
  sendDeclineAck: vi.fn(),
  sendAcceptAck: vi.fn(),
  sendAcceptedNotification: vi.fn(),
  sendManualFallbackNotification: vi.fn(),
  sendUnclearResponseNotification: vi.fn(),
}));
vi.mock("@/lib/routing/select-agent", () => ({
  selectNextAgent: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/routing/quiet-hours", () => ({
  getQuietHoursSettings: vi.fn().mockResolvedValue({ quiet_hours_enabled: false }),
  isInQuietHours: vi.fn().mockReturnValue(false),
  getEffectiveQuietHoursEnd: vi.fn().mockReturnValue("08:00"),
  getDeferredExpiresAt: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "insert", "update", "in", "order", "limit"]) {
      c[m] = vi.fn().mockReturnValue(c);
    }
    c.single = vi.fn().mockResolvedValue({ data: null, error: null });
    c.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    return c;
  };
  return { supabase: { from: vi.fn(() => chain()) } };
});

import { claimRoutingAttemptTransition } from "@/lib/supabase/queries/routing-attempts";
import { updateLeadStatus } from "@/lib/supabase/queries/leads";
import { getAgentById } from "@/lib/supabase/queries/agents";
import { logAuditEvent } from "@/lib/supabase/queries/audit-log";
import { notifyAcceptance } from "@/lib/zapier/notify-acceptance";
import {
  sendFollowUp,
  sendMovedOn,
  sendDeclineAck,
  sendAcceptAck,
} from "@/lib/twilio/send-sms";
import { selectNextAgent } from "@/lib/routing/select-agent";

const agent: Agent = {
  id: "agent-1",
  salesforce_user_id: "sf-agent-1",
  name: "Dina Shogren",
  phone: "+19415550000",
  email: "dina@example.com",
  gender: null,
  is_frontlines: false,
  is_active: true,
  close_rate_trailing_12m: 0.2,
  close_rate_all_time: 0.15,
  location_specialties: [],
  monthly_lead_goal_min: 30,
  monthly_lead_goal_max: 40,
  optimal_load_factor: 1.0,
  daily_lead_max: 5,
  unavailability_windows: null,
  price_ranges: null,
  is_preferred: false,
  photo_url: null,
  photo_thumb_url: null,
  send_draft_success_texts: false,
  draft_success_phone: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const lead: Lead = {
  id: "lead-1",
  salesforce_record_id: "00Q_test",
  location_id: null,
  form_name: "Contact Form (Buying)",
  first_name: "Kelly",
  last_name: "Sidhom",
  email: "kelly@example.com",
  phone: null,
  floor_plan: null,
  village: null,
  price: null,
  home_type: null,
  property_address: null,
  url: null,
  builder: null,
  timeline: null,
  message: null,
  salesforce_owner_id: null,
  is_master_agent_owned: true,
  previous_agent_offboarded: null,
  raw_payload: null,
  arrived_during_quiet_hours: false,
  routing_status: "routing",
  final_agent_id: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function makeAttempt(status: RoutingAttempt["status"]): RoutingAttempt {
  return {
    id: "attempt-1",
    lead_id: lead.id,
    agent_id: agent.id,
    attempt_number: 5,
    status,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    twilio_message_sid: "SM_original",
    agent_response: null,
    score_snapshot: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAgentById).mockResolvedValue(agent);
});

describe("timeout handlers racing an agent response", () => {
  it("handleFirstTimeout does nothing when the attempt was already resolved", async () => {
    vi.mocked(claimRoutingAttemptTransition).mockResolvedValue(null);

    await handleFirstTimeout(makeAttempt("sms_sent"));

    expect(claimRoutingAttemptTransition).toHaveBeenCalledWith(
      "attempt-1",
      ["sms_sent"],
      "followup_sent",
      expect.objectContaining({ expires_at: expect.any(String) })
    );
    expect(sendFollowUp).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("handleFirstTimeout sends the follow-up when the claim succeeds", async () => {
    vi.mocked(claimRoutingAttemptTransition).mockResolvedValue(
      makeAttempt("followup_sent")
    );

    await handleFirstTimeout(makeAttempt("sms_sent"));

    expect(sendFollowUp).toHaveBeenCalledWith(agent.phone);
    expect(logAuditEvent).toHaveBeenCalledWith(
      "followup_sent",
      expect.anything()
    );
  });

  it("handleSecondTimeout does not text or escalate when the attempt was already resolved", async () => {
    vi.mocked(claimRoutingAttemptTransition).mockResolvedValue(null);

    await handleSecondTimeout(makeAttempt("followup_sent"), lead, "Life At Lakewood");

    expect(sendMovedOn).not.toHaveBeenCalled();
    expect(selectNextAgent).not.toHaveBeenCalled();
    expect(updateLeadStatus).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("handleSecondTimeout escalates when the claim succeeds", async () => {
    vi.mocked(claimRoutingAttemptTransition).mockResolvedValue(
      makeAttempt("timed_out")
    );

    await handleSecondTimeout(makeAttempt("followup_sent"), lead, "Life At Lakewood");

    expect(sendMovedOn).toHaveBeenCalledWith(agent.phone);
    expect(selectNextAgent).toHaveBeenCalled();
    // No agents available -> manual fallback
    expect(updateLeadStatus).toHaveBeenCalledWith(lead.id, "manual");
  });
});

describe("agent responses racing the timeout cron", () => {
  it("handleAcceptance aborts when the attempt was already resolved", async () => {
    vi.mocked(claimRoutingAttemptTransition).mockResolvedValue(null);

    await handleAcceptance(makeAttempt("followup_sent"), lead, "Yes");

    expect(updateLeadStatus).not.toHaveBeenCalled();
    expect(sendAcceptAck).not.toHaveBeenCalled();
    expect(notifyAcceptance).not.toHaveBeenCalled();
  });

  it("handleAcceptance completes when the claim succeeds", async () => {
    vi.mocked(claimRoutingAttemptTransition).mockResolvedValue(
      makeAttempt("accepted")
    );

    await handleAcceptance(makeAttempt("followup_sent"), lead, "Yes");

    expect(claimRoutingAttemptTransition).toHaveBeenCalledWith(
      "attempt-1",
      ["sms_sent", "followup_sent"],
      "accepted",
      { agent_response: "Yes", expires_at: null }
    );
    expect(updateLeadStatus).toHaveBeenCalledWith(lead.id, "accepted", agent.id);
    expect(sendAcceptAck).toHaveBeenCalledWith(agent.phone, "Kelly", "Sidhom");
    expect(notifyAcceptance).toHaveBeenCalled();
  });

  it("handleDecline aborts without escalating when the attempt was already resolved", async () => {
    vi.mocked(claimRoutingAttemptTransition).mockResolvedValue(null);

    await handleDecline(makeAttempt("sms_sent"), lead, "Life At Lakewood", "No");

    expect(sendDeclineAck).not.toHaveBeenCalled();
    expect(selectNextAgent).not.toHaveBeenCalled();
  });
});
